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
  // True only when an admin manually turned this repairer off. The automatic
  // roster sync never sets it, and never reactivates anyone who has it set —
  // so a manual Inactive choice sticks on every device, forever.
  deactivatedByAdmin?: boolean;
  // True only when an admin deleted this repairer. The record is kept as a
  // tombstone rather than dropped, because the roster reconcile re-seeds
  // anyone from lib/data.ts who isn't present — a removed row would simply be
  // re-created by the next device that runs it. Like deactivatedByAdmin, this
  // is a manual choice that sticks on every device.
  deletedByAdmin?: boolean;
  role?: Role;
  notes?: string;
  photoDataUrl?: string;
  photoPath?: string;
  // Station assignment, remembered per repairer until changed: which station
  // (sorter or repair line) and which of that station's 5 spots.
  station?: "sorter" | "repair";
  stationSpot?: number;
  // The employee's code in the AMG Time clock system (e.g. "00137"), remembered
  // after the first hours import so later imports match automatically.
  timeclockCode?: string;
};

export type PalletCategory = "Stacker" | "Repair" | "Extend" | "Cut" | "Outside" | "Custom" | "QC Deductions";

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

// A consumable a repairer goes through — blades, nail rolls. Kept as a list
// rather than fixed fields so adding banding or staples later is a settings
// change, the same way pallet types work.
export type SupplyType = {
  id: string;
  name: string;
  // One of these, shown under the name: "blade", "roll".
  unit: string;
  active: boolean;
  // What one of these costs. Only ever rendered for admins.
  unitCost?: number;
  // How many pieces come in one unit — a nail roll holds 300 nails. Recorded
  // for later: nothing reads it yet, but a nails-per-pallet figure or a
  // box-level reorder point would both need it, and it's the kind of number
  // that's a nuisance to track down twice.
  piecesPerUnit?: number;
  pieceUnit?: string;
  // How many units come in a purchase box, where they're bought that way.
  unitsPerBox?: number;
};

// How many of one supply a repairer used on a day. No line means none used:
// blank counts as zero, so nothing has to be filled in on a quiet day.
export type SupplyLine = {
  supplyTypeId: string;
  quantity: number;
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
  // Free-text note for this phase, kept per repairer per phase (not shared
  // across the whole day or across repairers).
  notes?: string;
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
  clockIn?: string;
  clockOut?: string;
  manualHours: number;
  breakProfile: BreakProfile;
  notes?: string;
  createdAt: string;
  // Set on load when the UTC date-rollover bug was corrected for this entry:
  // the (wrong) date that was stored. Lets the admin panel offer to persist the
  // correction, and records what was changed once it is.
  dateCorrectedFrom?: string;
  // Photos of the repairer's physical time card, uploaded from the Production
  // Grid. Stored as small storage URLs (same pipeline as phase photos).
  timeCardPhotoUrls?: string[];
  // Consumables this repairer used on this day. Counted once for the day, not
  // per phase, so a manager logs blades one time instead of in every phase.
  // Zero-quantity lines are dropped on save — absent means none.
  supplies?: SupplyLine[];
  // Hours imported from the AMG Time timecard report (the day's paid total,
  // already net of unpaid lunch). Presence of this field is what makes the
  // Pay PDF print real hours instead of a dash.
  importedHours?: number;
  // Tombstone: the entry was deleted. The row is kept (with this flag) so every
  // device knows to drop its copy — a hard-deleted row looked identical to a
  // not-yet-synced one, and other devices' offline safety nets pushed it back.
  deleted?: boolean;
  updatedAt?: string;
  updatedBy?: string;
  submittedBy?: string;
  submittedById?: string;
};

export type PayrollSettings = {
  // Master switch for the minimum-wage make-up pay. Off means everyone is paid
  // straight piece rate; the wage figure is kept so it can be switched back on.
  minimumWageMakeupEnabled: boolean;
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
