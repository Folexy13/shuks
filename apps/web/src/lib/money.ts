export function formatUsdFromCents(amountCents: number): string {
  const safeCents = Math.round(amountCents);
  const wholeDollars = Math.trunc(safeCents / 100);
  const remainderCents = Math.abs(safeCents % 100);
  return `$${wholeDollars.toLocaleString("en-US")}.${remainderCents
    .toString()
    .padStart(2, "0")}`;
}

export function formatPayPalDecimalFromCents(amountCents: number): string {
  const safeCents = Math.round(amountCents);
  const wholeDollars = Math.trunc(safeCents / 100);
  const remainderCents = Math.abs(safeCents % 100);
  return `${wholeDollars}.${remainderCents.toString().padStart(2, "0")}`;
}

export function sumMilestoneCents(amountsCents: readonly number[]): number {
  let totalCents = 0;
  for (const itemCents of amountsCents) {
    totalCents += Math.round(itemCents);
  }
  return totalCents;
}

export function calculateDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const earthRadiusKm = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(earthRadiusKm * c * 10) / 10;
}
