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
  // Fontana (Fontana Main)
  { id: "adrian-baeza", name: "Adrian Baeza", locationId: "fontana", shift: "AM", active: true, role: "supervisor", photoDataUrl: "/avatars/adrian-baeza.jpg" },
  { id: "juan-mendez", name: "Juan Mendez", locationId: "fontana", shift: "AM", active: true, role: "supervisor", photoDataUrl: "/avatars/juan-mendez.jpg" },
  { id: "maria-reyes", name: "Maria Reyes", locationId: "fontana", shift: "AM", active: true, role: "employee", photoDataUrl: "/avatars/maria-reyes.jpg" },
  { id: "jovany-gomez", name: "Jovany Gomez", locationId: "fontana", shift: "AM", active: true, role: "employee", photoDataUrl: "/avatars/jovany-gomez.jpg" },
  { id: "axel-vallego", name: "Axel Vallego", locationId: "fontana", shift: "AM", active: true, role: "employee", photoDataUrl: "/avatars/axel-vallego.jpg" },
  // Citrus (Riverside Citrus)
  { id: "ernesto-fernandez", name: "Ernesto Fernandez", locationId: "citrus", shift: "AM", active: true, role: "supervisor", photoDataUrl: "/avatars/ernesto-fernandez.jpg" },
  { id: "javier-vela", name: "Javier Vela", locationId: "citrus", shift: "AM", active: true, role: "employee", photoDataUrl: "/avatars/javier-vela.jpg" },
  { id: "daniel-t", name: "Daniel T.", locationId: "citrus", shift: "AM", active: true, role: "employee", photoDataUrl: "/avatars/daniel-t.jpg" },
  { id: "juan-barron", name: "Juan Barron", locationId: "citrus", shift: "AM", active: true, role: "employee", photoDataUrl: "/avatars/juan-barron.jpg" },
  { id: "rodrigo-lopez", name: "Rodrigo Lopez", locationId: "citrus", shift: "AM", active: true, role: "employee", photoDataUrl: "/avatars/rodrigo-lopez.jpg" },
  { id: "eleazar-monroy", name: "Eleazar Monroy", locationId: "citrus", shift: "AM", active: true, role: "employee", photoDataUrl: "/avatars/eleazar-monroy.jpg" },
  { id: "edwin-bonilla", name: "Edwin Bonilla", locationId: "citrus", shift: "AM", active: true, role: "employee", photoDataUrl: "/avatars/edwin-bonilla.jpg" },
  { id: "jose-ramirez", name: "Jose Ramirez", locationId: "citrus", shift: "AM", active: true, role: "employee", photoDataUrl: "/avatars/jose-ramirez.jpg" },
  // Mesa (Mesa Fontana)
  { id: "luis-soriano", name: "Luis Soriano", locationId: "mesa", shift: "AM", active: true, role: "supervisor", photoDataUrl: "/avatars/luis-soriano.jpg" },
  { id: "rodolfo", name: "Rodolfo", locationId: "mesa", shift: "AM", active: true, role: "employee" },
  { id: "marco-martinez", name: "Marco Martinez", locationId: "mesa", shift: "AM", active: true, role: "employee" },
  { id: "alberto-arroyo-gomez", name: "Alberto Arroyo Gomez", locationId: "mesa", shift: "AM", active: true, role: "employee", photoDataUrl: "/avatars/alberto-arroyo-gomez.jpg" },
  { id: "jose-resendiz", name: "Jose Resendiz", locationId: "fontana", shift: "AM", active: true, role: "employee", photoDataUrl: "/avatars/jose-resendiz.jpg" },
  { id: "joel-manzo", name: "Joel Manzo", locationId: "fontana", shift: "AM", active: true, role: "employee", photoDataUrl: "/avatars/joel-manzo.jpg" },
  { id: "alejandro-salazar", name: "Alejandro Salazar", locationId: "fontana", shift: "AM", active: true, role: "employee", photoDataUrl: "/avatars/alejandro-salazar.jpg" }
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
