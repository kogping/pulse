import { customType } from "drizzle-orm/pg-core";

// PostGIS geography(Point,4326). Drizzle has no native PostGIS column type,
// so we round-trip through WKT text (e.g. "SRID=4326;POINT(lon lat)").
// Callers use ST_MakePoint/ST_AsText via sql`` at the query boundary —
// this custom type only tells drizzle-kit what DDL to emit.
export const geographyPoint = customType<{ data: string }>({
  dataType() {
    return "geography(Point,4326)";
  },
});
