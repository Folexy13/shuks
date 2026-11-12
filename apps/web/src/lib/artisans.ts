import { ArtisanProfile, GeoCoordinates } from "./types";

export const DEFAULT_BUYER_LOCATION: GeoCoordinates = {
  lat: 30.2672,
  lng: -97.7431,
};

export function findArtisanInCatalog(
  artisanId: string,
  catalog: readonly ArtisanProfile[]
): ArtisanProfile | null {
  return catalog.find((item) => item.id === artisanId) ?? catalog[0] ?? null;
}
