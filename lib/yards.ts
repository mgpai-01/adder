// MGP's yards: the fleet map's Yard board columns, purple outlines and ETA
// targets. A yard is placed one of two ways:
// - `address`: geocoded (TomTom), then matched to the Samsara geofence drawn
//   around it — addresses match the public website;
// - `samsaraPlace`: taken straight from the Samsara place (geofence) with that
//   name, for yards without a street address of their own (e.g. FedEx #26).
// Moving or adding a yard is a one-line change here.
export type Yard = { id: string; name: string; address?: string; samsaraPlace?: string };

export const YARDS: Yard[] = [
  { id: "sultana", name: "Sultana (Fontana)", address: "8386 Sultana Ave, Fontana, CA 92335" },
  { id: "merrill", name: "Merrill (Fontana)", address: "14619 Merrill Ave, Fontana, CA 92335" },
  { id: "citrus", name: "Citrus (Riverside)", address: "1326 W Citrus St, Riverside, CA 92507" },
  { id: "fedex", name: "FedEx #26", samsaraPlace: "FedEx #26" },
  // Samsara place "US Elogistic 1002 S Carnegie Ave ONTARIO" — named in full
  // because other Samsara places also mention US Elogistic (e.g. Tamarind).
  { id: "uselogistic", name: "US Elogistic (Ontario)", samsaraPlace: "US Elogistic 1002 S Carnegie" }
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
  // The truck route as [lat, lng] points (thinned out), and the yard's spot,
  // for drawing on the map.
  path?: Array<[number, number]>;
  yardLat?: number;
  yardLng?: number;
};

// A yard as the fleet map draws it: its spot plus the area that counts as
// "at the yard" — the matching Samsara geofence when there is one
// (`placeName`), else a circle around the address.
export type YardArea = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  radiusMeters: number | null;
  polygon: Array<[number, number]> | null;
  placeName: string;
  placeId: string;
};
