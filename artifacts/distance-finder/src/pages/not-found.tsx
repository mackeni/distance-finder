import { Link } from "wouter";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center space-y-4 bg-card/50 border border-border/50 rounded-3xl p-8">
        <Compass className="w-10 h-10 mx-auto text-primary" />
        <h1 className="text-2xl font-bold text-foreground">Page not found</h1>
        <p className="text-sm text-muted-foreground">
          There's nothing at this address. Head back to measure a distance.
        </p>
        <Button asChild className="rounded-2xl">
          <Link href="/">Back to Distance Finder</Link>
        </Button>
      </div>
    </div>
  );
}
