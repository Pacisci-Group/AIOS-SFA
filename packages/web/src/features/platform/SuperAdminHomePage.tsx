import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { PANEL_AREAS } from "./panel-areas";
import { SuperAdminLayout } from "./SuperAdminLayout";

/**
 * The panel's landing page: one large tile per area (PAC-73).
 *
 * Disabled tiles are shown, not hidden — see the note on `PANEL_AREAS`. They
 * are rendered as plain `div`s rather than disabled `Button`s so they are not
 * focusable and cannot be activated by keyboard: a "Coming soon" tile that
 * takes focus and does nothing reads as broken.
 */
export default function SuperAdminHomePage() {
  return (
    <SuperAdminLayout>
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-card-foreground">
          Platform operations
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Tools that sit above the tenant boundary. Greyed-out areas are not
          built yet.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {PANEL_AREAS.map((area) => {
          const body = (
            <CardContent className="flex h-full flex-col gap-2 px-5 py-4">
              <div className="flex items-center gap-2">
                <area.icon
                  className={cn(
                    "size-5",
                    area.to ? "text-primary" : "text-muted-foreground/60",
                  )}
                />
                <h3
                  className={cn(
                    "text-sm font-semibold",
                    area.to ? "text-card-foreground" : "text-muted-foreground",
                  )}
                >
                  {area.label}
                </h3>
                {!area.to && (
                  <Badge size="sm" variant="secondary" className="ml-auto">
                    Coming soon
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {area.description}
              </p>
            </CardContent>
          );

          return area.to ? (
            <Link
              key={area.key}
              to={area.to}
              className="rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <Card className="h-full transition-colors hover:bg-accent">
                {body}
              </Card>
            </Link>
          ) : (
            <Card key={area.key} aria-disabled className="h-full opacity-60">
              {body}
            </Card>
          );
        })}
      </div>
    </SuperAdminLayout>
  );
}
