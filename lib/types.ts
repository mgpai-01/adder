export type Role = "admin" | "supervisor" | "employee" | "counter";

export type Location = {
  id: string;
  name: string;
  active: boolean;
};

export type Shift = "AM" | "PM" | "Swing";

export type Employee = {
  id: string;
  name: string;
  locationId: string;
  shift: Shift;
  active: boolean;
  role?: Role;
  notes?: string;
  photoDataUrl?: string;
  photoPath?: string;
  // Station assignment, remembered per repairer until changed: which station
  // (sorter or repair line) and which of that station's 5 spots.
  station?: "sorter" | "repair";
  stationSpot?: number;
};

export type PalletCategory = "Stacker" | "Repair" | "Extend" | "Cut" | "Outside" | "QC Deductions";

export type PalletType = {
  id: string;
  code: string;
  description: string;
  category: PalletCategory;
  rate: number;
  active: boolean;
  photoUrl?: string;
  bilingualLabel?: string;
  customerRateNote?: string;
  locationRateNote?: string;
};

export type BreakProfile = "standard" | "paidLunch" | "noLunch";

export type ProductionLine = {
  palletTypeId: string;
  quantity: number;
  // When a count is entered as several numbers added together (e.g. "13 7 14"),
  // the individual numbers are kept here so the breakdown can be shown. `quantity`
  // is always their sum. Omitted for a plain single-number entry.
  parts?: number[];
};

// A repairer's day is tracked in three phases. Each phase records its own
// pallet quantities (`lines`), an auto-computed non-QC pallet count (`amount`),
// an optional photo, and can be bypassed when it does not apply.
export type EntryPhase = {
  amount: number;
  bypassed: boolean;
  // `photoDataUrl` is the legacy single photo; `photoDataUrls` holds one or more
  // photos. Helpers read both so older saved entries keep working.
  photoDataUrl?: string;
  photoDataUrls?: string[];
  lines?: ProductionLine[];
};

export type DailyEntry = {
  id: string;
  date: string;
  employeeId: string;
  yardManagerId?: string;
  locationId: string;
  shift: Shift;
  lines: ProductionLine[];
  phases?: EntryPhase[];
  // Ad-hoc pallets a manager adds on the entry screen for one-off custom
  // pallets that aren't in the pallet-type catalog. Quantities are stored in
  // the phase `lines` keyed by these ids; the name lives here so it persists.
  customPallets?: { id: string; name: string }[];
  clockIn?: string;
  clockOut?: string;
  manualHours: number;
  breakProfile: BreakProfile;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
  updatedBy?: string;
  submittedBy?: string;
  submittedById?: string;
};

export type PayrollSettings = {
  minimumWage: number;
  overtimeMultiplier: number;
  dailyOvertimeThreshold: number;
  dailyProductionGoal: number;
};

export type EntryCalculation = {
  pieceEarnings: number;
  quantity: number;
  regularHours: number;
  overtimeHours: number;
  weeklyOvertimeHours: number;
  paidHours: number;
  workedHours: number;
  minimumWageRequired: number;
  additionalOwed: number;
  totalPay: number;
  hourlyEquivalent: number;
};

export type CountSheetStatus = "Pending" | "Approved" | "Rejected";

export type CountSheetPhoto = {
  id: string;
  fileName: string;
  url: string;
  storagePath?: string;
  uploadedAt: string;
  size?: number;
  contentType?: string;
};

export type CountSheet = {
  id: string;
  date: string;
  locationId: string;
  shift: Shift;
  uploadedBy: string;
  uploadTime: string;
  notes?: string;
  status: CountSheetStatus;
  comments?: string;
  photos: CountSheetPhoto[];
  approvedBy?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
  updatedAt?: string;
  updatedBy?: string;
};
