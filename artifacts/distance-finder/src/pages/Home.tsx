import { useState, useRef, useEffect } from "react";
import { Compass, MapPin, Navigation, Search, X, Loader2, AlertCircle, Circle, LocateFixed } from "lucide-react";
import { haversineKm, getBearing, getCompassDirection } from "@/lib/geo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import DistanceMap from "@/components/GlobeMap";

type AppState = "idle" | "locating" | "searching" | "success" | "error";
type Unit = "miles" | "km";

interface LocResult { lat: number; lon: number; name: string }

async function geocode(query: string): Promise<LocResult> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`
  );
  if (!res.ok) throw new Error("Failed to reach geocoding service.");
  const data = await res.json();
  if (!data || data.length === 0) throw new Error(`Could not find "${query}".`);
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), name: data[0].display_name };
}

export default function Home() {
  const [status, setStatus] = useState<AppState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [unit, setUnit] = useState<Unit>("miles");

  // Start location: GPS (default) or custom typed place
  const [fromInput, setFromInput] = useState("");
  const [gpsLoc, setGpsLoc] = useState<{ lat: number; lon: number } | null>(null);
  const [gpsLocating, setGpsLocating] = useState(false);
  const [customStart, setCustomStart] = useState<LocResult | null>(null);

  // Destination
  const [toInput, setToInput] = useState("");
  const [destLoc, setDestLoc] = useState<LocResult | null>(null);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [bearing, setBearing] = useState<number | null>(null);

  // Radius
  const [radiusInput, setRadiusInput] = useState("");

  const toInputRef = useRef<HTMLInputElement>(null);

  // Silently acquire GPS on mount (used when fromInput is empty)
  useEffect(() => {
    if (!navigator.geolocation) return;
    setGpsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsLoc({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setGpsLocating(false);
      },
      () => setGpsLocating(false),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, []);

  // Active start = custom typed place (if provided) or GPS
  const usingCustomStart = fromInput.trim() !== "";
  const activeLoc = usingCustomStart ? customStart : gpsLoc;
  const activeLocLat = activeLoc?.lat;
  const activeLocLon = activeLoc?.lon;
  const userLabel = usingCustomStart && customStart
    ? customStart.name.split(",")[0].trim()
    : "You are here";

  const handleSearch = async () => {
    setStatus("locating");
    setErrorMsg("");

    try {
      let startLat: number;
      let startLon: number;

      if (usingCustomStart) {
        setStatus("searching");
        const from = await geocode(fromInput.trim());
        setCustomStart(from);
        startLat = from.lat;
        startLon = from.lon;
      } else if (gpsLoc) {
        startLat = gpsLoc.lat;
        startLon = gpsLoc.lon;
        setStatus("searching");
      } else {
        // GPS not yet acquired — request it now
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          if (!navigator.geolocation) reject(new Error("Geolocation not supported."));
          else navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true, timeout: 10000, maximumAge: 0,
          });
        });
        startLat = pos.coords.latitude;
        startLon = pos.coords.longitude;
        setGpsLoc({ lat: startLat, lon: startLon });
        setStatus("searching");
      }

      // Geocode destination only if one was entered
      if (toInput.trim()) {
        const dest = await geocode(toInput.trim());
        setDestLoc(dest);
        setDistanceKm(haversineKm(startLat, startLon, dest.lat, dest.lon));
        setBearing(getBearing(startLat, startLon, dest.lat, dest.lon));
      } else {
        setDestLoc(null);
        setDistanceKm(null);
        setBearing(null);
      }

      setStatus("success");
    } catch (err: any) {
      console.error(err);
      setErrorMsg(
        err instanceof GeolocationPositionError
          ? "Could not get your location. Please check location permissions."
          : err.message || "An unknown error occurred."
      );
      setStatus("error");
    }
  };

  const handleClear = () => {
    setToInput("");
    setDestLoc(null);
    setDistanceKm(null);
    setBearing(null);
    setStatus("idle");
    setErrorMsg("");
    toInputRef.current?.focus();
  };

  const handleClearFrom = () => {
    setFromInput("");
    setCustomStart(null);
    setDestLoc(null);
    setDistanceKm(null);
    setBearing(null);
    setStatus("idle");
  };

  // Radius → always convert to miles for the map
  const parsedRadiusRaw =
    radiusInput !== "" && !isNaN(parseFloat(radiusInput)) && parseFloat(radiusInput) > 0
      ? parseFloat(radiusInput) : undefined;
  const radiusMilesForMap = parsedRadiusRaw
    ? (unit === "miles" ? parsedRadiusRaw : parsedRadiusRaw / 1.60934)
    : undefined;

  // Distance display
  const distanceMiles = distanceKm != null ? distanceKm * 0.621371 : null;
  const primaryValue  = distanceKm != null ? (unit === "miles" ? distanceMiles! : distanceKm) : null;
  const primaryLabel  = unit === "miles" ? "miles" : "km";
  const secondaryValue = distanceKm != null ? (unit === "miles" ? distanceKm : distanceMiles!) : null;
  const secondaryLabel = unit === "miles" ? "kilometers" : "miles";

  const busy = status === "locating" || status === "searching";
  // Show map once we know where the start is and we're not mid-search
  const showMap = !busy && activeLocLat !== undefined && activeLocLon !== undefined;

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-2xl mx-auto flex flex-col gap-10">

        {/* Header */}
        <header className="text-center space-y-4">
          <div className="inline-flex items-center justify-center p-4 rounded-full bg-primary/10 text-primary mb-2 shadow-[0_0_40px_rgba(234,179,8,0.15)] ring-1 ring-primary/20">
            <Compass className="w-10 h-10 animate-[spin_10s_linear_infinite]" />
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">Distance Finder</h1>
          <p className="text-muted-foreground font-mono text-sm sm:text-base max-w-md mx-auto">
            Discover the exact distance to anywhere in the world, directly from where you stand.
          </p>
        </header>

        {/* Input Area */}
        <div className="relative z-10 w-full max-w-lg mx-auto flex flex-col gap-3">

          {/* From row */}
          <div className="flex gap-2">
            <div className="relative flex-1 group">
              <Input
                data-testid="input-from"
                type="text"
                placeholder="From: current location"
                value={fromInput}
                onChange={(e) => {
                  setFromInput(e.target.value);
                  if (customStart) { setCustomStart(null); setDestLoc(null); setDistanceKm(null); setBearing(null); setStatus("idle"); }
                }}
                onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
                disabled={busy}
                className="pl-12 pr-10 py-5 text-base rounded-2xl bg-card border-border/50 focus-visible:ring-primary/50 shadow"
              />
              <LocateFixed className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors ${fromInput ? "text-muted-foreground" : "text-primary/60"} group-focus-within:text-primary`} />
              {fromInput && !busy && (
                <button onClick={handleClearFrom} className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <Button
              data-testid="button-search-from"
              onClick={handleSearch}
              disabled={busy}
              className="h-auto px-6 sm:px-8 rounded-2xl shadow bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-lg"
            >
              {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
              <span className="hidden sm:inline ml-2">Find</span>
            </Button>
          </div>

          {/* To row */}
          <div className="flex gap-2">
            <div className="relative flex-1 group">
              <Input
                ref={toInputRef}
                data-testid="input-destination"
                type="text"
                placeholder="To: e.g. Tokyo, Eiffel Tower…"
                value={toInput}
                onChange={(e) => setToInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
                disabled={busy}
                className="pl-12 pr-10 py-6 text-lg rounded-2xl bg-card border-border/50 focus-visible:ring-primary/50 shadow-lg"
              />
              <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground group-focus-within:text-primary transition-colors" />
              {toInput && !busy && (
                <button
                  data-testid="button-clear"
                  onClick={handleClear}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>
            <Button
              data-testid="button-search"
              onClick={handleSearch}
              disabled={busy}
              className="h-auto px-6 sm:px-8 rounded-2xl shadow-lg bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-lg"
            >
              {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
              <span className="hidden sm:inline ml-2">Find</span>
            </Button>
          </div>

          {/* Unit toggle — centred, clearly a global setting */}
          <div className="flex justify-center">
            <div className="flex items-center rounded-full border border-border/50 bg-card shadow overflow-hidden text-sm font-semibold">
              {(["miles", "km"] as Unit[]).map((u) => (
                <label
                  key={u}
                  className={`px-5 py-1.5 cursor-pointer transition-colors select-none ${
                    unit === u
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                  }`}
                >
                  <input type="radio" name="unit" value={u} checked={unit === u} onChange={() => setUnit(u)} className="sr-only" />
                  {u}
                </label>
              ))}
            </div>
          </div>

          {/* Radius row */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Circle className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                data-testid="input-radius"
                type="number"
                min="0"
                placeholder={`Radius in ${unit} (optional)`}
                value={radiusInput}
                onChange={(e) => setRadiusInput(e.target.value)}
                className="pl-9 rounded-xl bg-card border-border/50 focus-visible:ring-primary/50 shadow"
              />
            </div>
            {radiusInput && (
              <button data-testid="button-clear-radius" onClick={() => setRadiusInput("")} className="text-muted-foreground hover:text-foreground transition-colors p-1 shrink-0">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Status messages */}
        {status === "locating" && (
          <div className="flex flex-col items-center text-muted-foreground space-y-4 animate-in fade-in zoom-in duration-500">
            <MapPin className="w-8 h-8 animate-bounce text-primary/70" />
            <p className="font-mono text-sm uppercase tracking-widest">Acquiring GPS Signal...</p>
          </div>
        )}
        {status === "searching" && (
          <div className="flex flex-col items-center text-muted-foreground space-y-4 animate-in fade-in zoom-in duration-500">
            <Search className="w-8 h-8 animate-pulse text-primary/70" />
            <p className="font-mono text-sm uppercase tracking-widest">Triangulating Destination...</p>
          </div>
        )}
        {status === "error" && (
          <div className="flex flex-col items-center text-destructive space-y-4 p-8 bg-destructive/10 rounded-3xl border border-destructive/20 w-full max-w-lg mx-auto animate-in slide-in-from-bottom-4 duration-300">
            <AlertCircle className="w-10 h-10" />
            <p className="text-center font-medium text-destructive-foreground/90">{errorMsg}</p>
            <Button data-testid="button-retry" variant="outline" className="mt-4 border-destructive/30 hover:bg-destructive/20" onClick={handleSearch}>
              Try Again
            </Button>
          </div>
        )}

        {/* Distance result */}
        {status === "success" && primaryValue !== null && bearing !== null && destLoc && (
          <div className="text-center space-y-2 animate-in slide-in-from-bottom-8 duration-700 fade-in">
            <div className="flex items-baseline justify-center gap-4">
              <span className="font-display font-bold tabular-nums tracking-tighter text-6xl sm:text-8xl md:text-9xl text-transparent bg-clip-text bg-gradient-to-b from-foreground to-foreground/70">
                {Math.round(primaryValue).toLocaleString()}
              </span>
              <span className="text-2xl sm:text-3xl font-semibold text-muted-foreground">{primaryLabel}</span>
            </div>
            <div className="flex items-center justify-center text-base sm:text-lg text-muted-foreground/60 font-medium">
              <span>{Math.round(secondaryValue!).toLocaleString()} {secondaryLabel}</span>
            </div>
          </div>
        )}

        {/* Location spinner (GPS mode, map not yet ready) */}
        {!usingCustomStart && gpsLocating && !gpsLoc && (
          <div className="flex flex-col items-center text-muted-foreground space-y-3 py-8 animate-in fade-in duration-500">
            <Loader2 className="w-6 h-6 animate-spin text-primary/60" />
            <p className="font-mono text-xs uppercase tracking-widest">Getting your location…</p>
          </div>
        )}

        {/* Map */}
        {showMap && (
          <div className="w-full space-y-6 animate-in fade-in duration-500">
            <DistanceMap
              userLat={activeLocLat!}
              userLon={activeLocLon!}
              destLat={destLoc?.lat}
              destLon={destLoc?.lon}
              radiusMiles={radiusMilesForMap}
              destName={destLoc?.name.split(",")[0].trim()}
              userLabel={userLabel}
            />

            {/* Detail cards */}
            {status === "success" && distanceKm !== null && bearing !== null && destLoc && activeLoc && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-4xl mx-auto animate-in slide-in-from-bottom-4 duration-500">
                <div className="bg-card/50 backdrop-blur-sm border border-border/50 p-6 rounded-3xl space-y-3 flex flex-col items-center text-center">
                  <div className="p-3 rounded-2xl bg-secondary/50">
                    <Navigation className="w-6 h-6 text-primary" style={{ transform: `rotate(${bearing}deg)` }} />
                  </div>
                  <h3 className="font-medium text-foreground">Bearing</h3>
                  <p className="text-sm text-muted-foreground font-mono">
                    {Math.round(bearing)}° {getCompassDirection(bearing)}
                  </p>
                </div>

                <div className="bg-card/50 backdrop-blur-sm border border-border/50 p-6 rounded-3xl space-y-3 flex flex-col items-center text-center sm:col-span-2">
                  <div className="p-3 rounded-2xl bg-secondary/50">
                    <MapPin className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="font-medium text-foreground line-clamp-1 w-full" title={destLoc.name}>
                    {destLoc.name}
                  </h3>
                  <div className="flex gap-4 text-xs text-muted-foreground font-mono mt-1">
                    <span>FROM: {activeLoc.lat.toFixed(4)}, {activeLoc.lon.toFixed(4)}</span>
                    <span className="hidden sm:inline">•</span>
                    <span>TO: {destLoc.lat.toFixed(4)}, {destLoc.lon.toFixed(4)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
