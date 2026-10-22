// MGP's yards, for drive-time ETAs from the fleet map. Addresses match the
// public website; coordinates are looked up from them (TomTom geocoding) and
// cached, so moving a yard is a one-line address change here.
export type Yard = { id: string; name: string; address: string };

export const YARDS: Yard[] = [
  { id: "sultana", name: "Sultana (Fontana)", address: "8386 Sultana Ave, Fontana, CA 92335" },
  { id: "merrill", name: "Merrill (Fontana)", address: "14619 Merrill Ave, Fontana, CA 92335" },
  { id: "citrus", name: "Citrus (Riverside)", address: "1326 W Citrus St, Riverside, CA 92507" }
];

// One yard's drive time from a truck/trailer (from /api/samsara/eta).
export type YardEta = {
  yardId: string;
  name: string;
  address: string;
  minutes?: number;
  miles?: number;
  trafficDelayMinutes?: number;
  arrival?: string;
  error?: string;
};
