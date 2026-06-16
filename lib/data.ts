import type { Employee, Location, PalletCategory, PalletType, PayrollSettings, Shift } from "./types";

export const payrollSettings: PayrollSettings = {
  minimumWage: 16.9,
  overtimeMultiplier: 1.5,
  dailyOvertimeThreshold: 8,
  dailyProductionGoal: 4500
};

export const locations: Location[] = [
  { id: "fontana", name: "Fontana", active: true },
  { id: "citrus", name: "Citrus", active: true },
  { id: "mesa", name: "Mesa", active: true }
];

export const employees: Employee[] = [
  { id: "lupita-reyes", name: "Lupita Reyes", locationId: "fontana", shift: "AM", active: true, role: "supervisor" },
  { id: "alberto", name: "Alberto", locationId: "fontana", shift: "AM", active: true, role: "employee" },
  { id: "rodolfo", name: "Rodolfo", locationId: "fontana", shift: "AM", active: true, role: "employee" },
  { id: "marco", name: "Marco", locationId: "citrus", shift: "AM", active: true, role: "supervisor" },
  { id: "jovany", name: "Jovany", locationId: "citrus", shift: "AM", active: true, role: "employee" },
  { id: "jose-resendiz", name: "Jose Resendiz", locationId: "citrus", shift: "AM", active: true, role: "employee" },
  { id: "axel", name: "Axel", locationId: "mesa", shift: "AM", active: true, role: "supervisor" },
  { id: "javier", name: "Javier", locationId: "mesa", shift: "AM", active: true, role: "employee" },
  { id: "daniel", name: "Daniel", locationId: "mesa", shift: "AM", active: true, role: "employee" },
  { id: "juan-b", name: "Juan B.", locationId: "fontana", shift: "AM", active: true, role: "employee" },
  { id: "rodrigo", name: "Rodrigo", locationId: "citrus", shift: "AM", active: true, role: "employee" },
  { id: "eleazar", name: "Eleazar", locationId: "mesa", shift: "AM", active: true, role: "employee" },
  { id: "edwin", name: "Edwin", locationId: "fontana", shift: "AM", active: true, role: "employee" },
  { id: "jose-ramirez", name: "Jose Ramirez", locationId: "mesa", shift: "AM", active: true, role: "employee" }
];

export const palletCategories: PalletCategory[] = [
  "Stacker",
  "Repair",
  "Extend",
  "Cut",
  "Outside",
  "QC Deductions"
];

export const shifts: Shift[] = ["AM", "PM", "Swing"];

export const defaultPalletTypes: PalletType[] = [
  { id: "stacker-block", code: "1 STACKER", description: "BLOCK", category: "Stacker", rate: 1, active: true },
  { id: "stacker-grade-b-2", code: "2 STACKER", description: "GRADE B #2", category: "Stacker", rate: 1, active: true },
  { id: "stacker-regular", code: "3 STACKER", description: "REGULAR", category: "Stacker", rate: 1, active: true },
  { id: "stacker-grade-a-1", code: "4 STACKER", description: "GRADE A #1", category: "Stacker", rate: 1, active: true },
  { id: "stacker-grande-fuera", code: "5 STACKER", description: "Pallet Grande que sale para fuera", category: "Stacker", rate: 1, active: true },
  { id: "stack-by-hand-cambiar-barrote", code: "STACK BY HAND", description: "#1 CAMBIAR BARROTE", category: "Stacker", rate: 1.35, active: true },
  { id: "repair-60x40", code: "REPAIR", description: "60x40", category: "Repair", rate: 1.75, active: true },
  { id: "extend-60x40", code: "EXTEND", description: "60x40", category: "Extend", rate: 2, active: true },
  { id: "cut-60x40", code: "CUT", description: "60x40", category: "Cut", rate: 2.25, active: true },
  { id: "outside-block", code: "OUTSIDE", description: "BLOCK", category: "Outside", rate: 1, active: true },
  { id: "outside-grade-b-2", code: "OUTSIDE", description: "GRADE B #2", category: "Outside", rate: 1, active: true },
  { id: "outside-regular", code: "OUTSIDE", description: "REGULAR", category: "Outside", rate: 1, active: true },
  { id: "outside-grade-a-1", code: "OUTSIDE", description: "GRADE A #1", category: "Outside", rate: 1, active: true },
  { id: "quality-control-rejects", code: "Quality Control Rejects", description: "Reject deduction", category: "QC Deductions", rate: -2, active: true }
];

export const palletTypes = defaultPalletTypes;

export const timeOptions = [
  "5:00 AM",
  "5:15 AM",
  "5:30 AM",
  "5:45 AM",
  "6:00 AM",
  "6:15 AM",
  "6:30 AM",
  "6:45 AM",
  "7:00 AM",
  "7:15 AM",
  "7:30 AM",
  "7:45 AM",
  "8:00 AM",
  "8:15 AM",
  "8:30 AM",
  "8:45 AM",
  "9:00 AM",
  "2:00 PM",
  "2:15 PM",
  "2:30 PM",
  "2:45 PM",
  "3:00 PM",
  "3:15 PM",
  "3:30 PM",
  "3:45 PM",
  "4:00 PM",
  "4:15 PM",
  "4:30 PM",
  "4:45 PM",
  "5:00 PM",
  "5:15 PM",
  "5:30 PM",
  "5:45 PM",
  "6:00 PM"
];
