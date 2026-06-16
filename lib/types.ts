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
};

export type DailyEntry = {
  id: string;
  date: string;
  employeeId: string;
  yardManagerId?: string;
  locationId: string;
  shift: Shift;
  lines: ProductionLine[];
  clockIn?: string;
  clockOut?: string;
  manualHours: number;
  breakProfile: BreakProfile;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
  updatedBy?: string;
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
