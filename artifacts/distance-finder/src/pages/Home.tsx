import { useState, useRef, useEffect } from "react";
import { Compass, MapPin, Navigation, Search, X, Loader2, AlertCircle } from "lucide-react";
import { haversineKm, getBearing, getCompassDirection } from "@/lib/geo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type AppState = "idle" | "locating" | "searching" | "success" | "error";

export default function Home() {
  const [status, setStatus] = useState<AppState>("idle");
  const [query, setQuery] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  
  const [userLoc, setUserLoc] = useState<{ lat: number; lon: number } | null>(null);
  const [destLoc, setDestLoc] = useState<{ lat: number; lon: number; name: string } | null>(null);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [bearing, setBearing] = useState<number | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  const handleSearch = async () => {
    if (!query.trim()) return;

    setStatus("locating");
    setErrorMsg("");

    try {
      // 1. Get User Location
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error("Geolocation is not supported by your browser."));
        } else {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0,
          });
        }
      });

      const userLat = pos.coords.latitude;
      const userLon = pos.coords.longitude;
      setUserLoc({ lat: userLat, lon: userLon });

      // 2. Geocode Destination
      setStatus("searching");
      const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`);
      
      if (!res.ok) {
        throw new Error("Failed to reach geocoding service.");
      }

      const data = await res.json();
      if (!data || data.length === 0) {
        throw new Error(`Could not find a location matching "${query}".`);
      }

      const destLat = parseFloat(data[0].lat);
      const destLon = parseFloat(data[0].lon);
      const destName = data[0].display_name;

      setDestLoc({ lat: destLat, lon: destLon, name: destName });

      // 3. Calculate Math
      const dist = haversineKm(userLat, userLon, destLat, destLon);
      const brng = getBearing(userLat, userLon, destLat, destLon);

      setDistanceKm(dist);
      setBearing(brng);
      setStatus("success");

    } catch (err: any) {
      console.error(err);
      if (err instanceof GeolocationPositionError) {
        setErrorMsg("Could not get your location. Please ensure location permissions are granted.");
      } else {
        setErrorMsg(err.message || "An unknown error occurred.");
      }
      setStatus("error");
    }
  };

  const handleClear = () => {
    setQuery("");
    setStatus("idle");
    setErrorMsg("");
    setDestLoc(null);
    setDistanceKm(null);
    setBearing(null);
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-2xl mx-auto flex flex-col gap-12">
        
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
        <div className="relative z-10 w-full max-w-lg mx-auto flex gap-2">
          <div className="relative flex-1 group">
            <Input
              ref={inputRef}
              data-testid="input-destination"
              type="text"
              placeholder="e.g. Tokyo, Eiffel Tower, Sydney Opera House..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch();
              }}
              disabled={status === "locating" || status === "searching"}
              className="pl-12 pr-10 py-6 text-lg rounded-2xl bg-card border-border/50 focus-visible:ring-primary/50 shadow-lg"
            />
            <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground group-focus-within:text-primary transition-colors" />
            {query && (status === "idle" || status === "success" || status === "error") && (
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
            disabled={!query.trim() || status === "locating" || status === "searching"}
            className="h-auto px-6 sm:px-8 rounded-2xl shadow-lg bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-lg"
          >
            {status === "locating" || status === "searching" ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Search className="w-5 h-5" />
            )}
            <span className="hidden sm:inline ml-2">Find</span>
          </Button>
        </div>

        {/* Status Indicators */}
        <div className="min-h-[300px] flex flex-col items-center w-full">
          {status === "locating" && (
            <div className="flex flex-col items-center justify-center text-muted-foreground space-y-4 animate-in fade-in zoom-in duration-500">
              <MapPin className="w-8 h-8 animate-bounce text-primary/70" />
              <p className="font-mono text-sm uppercase tracking-widest">Acquiring GPS Signal...</p>
            </div>
          )}

          {status === "searching" && (
            <div className="flex flex-col items-center justify-center text-muted-foreground space-y-4 animate-in fade-in zoom-in duration-500">
              <Search className="w-8 h-8 animate-pulse text-primary/70" />
              <p className="font-mono text-sm uppercase tracking-widest">Triangulating Destination...</p>
            </div>
          )}

          {status === "error" && (
            <div className="flex flex-col items-center justify-center text-destructive space-y-4 p-8 bg-destructive/10 rounded-3xl border border-destructive/20 w-full max-w-lg animate-in slide-in-from-bottom-4 duration-300">
              <AlertCircle className="w-10 h-10" />
              <p className="text-center font-medium text-destructive-foreground/90">{errorMsg}</p>
              <Button data-testid="button-retry" variant="outline" className="mt-4 border-destructive/30 hover:bg-destructive/20" onClick={handleSearch}>
                Try Again
              </Button>
            </div>
          )}

          {status === "success" && distanceKm !== null && bearing !== null && destLoc && userLoc && (
            <div className="w-full space-y-8 animate-in slide-in-from-bottom-8 duration-700 fade-in">
              {/* Massive Distance Display */}
              <div className="text-center space-y-2">
                <div className="font-display font-bold tabular-nums tracking-tighter text-6xl sm:text-8xl md:text-9xl text-transparent bg-clip-text bg-gradient-to-b from-foreground to-foreground/70">
                  {Math.round(distanceKm * 0.621371).toLocaleString()}
                </div>
                <div className="flex items-center justify-center gap-6 text-xl sm:text-2xl text-muted-foreground font-medium">
                  <span>Miles</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-primary/50"></span>
                  <span>{Math.round(distanceKm).toLocaleString()} Kilometers</span>
                </div>
              </div>

              {/* Detail Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-4xl mx-auto mt-12">
                <div className="bg-card/50 backdrop-blur-sm border border-border/50 p-6 rounded-3xl space-y-3 flex flex-col items-center text-center">
                  <div className="p-3 rounded-2xl bg-secondary/50 text-muted-foreground">
                    <Navigation 
                      className="w-6 h-6 text-primary" 
                      style={{ transform: `rotate(${bearing}deg)` }} 
                    />
                  </div>
                  <h3 className="font-medium text-foreground">Bearing</h3>
                  <p className="text-sm text-muted-foreground font-mono">
                    {Math.round(bearing)}° {getCompassDirection(bearing)}
                  </p>
                </div>

                <div className="bg-card/50 backdrop-blur-sm border border-border/50 p-6 rounded-3xl space-y-3 flex flex-col items-center text-center sm:col-span-2">
                  <div className="p-3 rounded-2xl bg-secondary/50 text-muted-foreground">
                    <MapPin className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="font-medium text-foreground line-clamp-1 w-full" title={destLoc.name}>
                    {destLoc.name}
                  </h3>
                  <div className="flex gap-4 text-xs text-muted-foreground font-mono mt-1">
                    <span>FROM: {userLoc.lat.toFixed(4)}, {userLoc.lon.toFixed(4)}</span>
                    <span className="hidden sm:inline">•</span>
                    <span>TO: {destLoc.lat.toFixed(4)}, {destLoc.lon.toFixed(4)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
