"use client";

import { createContext, useContext } from "react";

export type Language = "en" | "es";

// English source string -> Spanish. Anything without an entry falls back to the
// English text, so partial coverage is always safe. Use {n}-style placeholders
// for interpolation (see `translate`).
export const esDict: Record<string, string> = {
  // Nav / header
  Entry: "Entrada",
  "Count Sheets": "Hojas de Conteo",
  "Production Grid": "Cuadrícula de Producción",
  Dashboard: "Panel",
  Payroll: "Nómina",
  "Live Pallet Tracker →": "Rastreador de Tarimas en Vivo →",
  "Sign out": "Cerrar sesión",

  // Entry screen
  "Daily Production Grid": "Cuadrícula de Producción Diaria",
  Ready: "Listo",
  "Saving…": "Guardando…",
  "Saved to the cloud": "Guardado en la nube",
  "Saved locally; sync pending": "Guardado localmente; sincronización pendiente",
  "Daily grid saved": "Cuadrícula diaria guardada",
  "Save Daily Grid": "Guardar Cuadrícula",
  Pallets: "Tarimas",
  Date: "Fecha",
  Yard: "Patio",
  "Yard Manager": "Gerente de Patio",
  "— No manager —": "— Sin gerente —",
  Repairer: "Reparador",
  "No repairers in this yard": "No hay reparadores en este patio",
  Station: "Estación",
  Sorter: "Clasificador",
  "Repair Line": "Línea de Reparación",
  Spot: "Puesto",
  "— None —": "— Ninguno —",
  "Spot {n}": "Puesto {n}",
  "No station set": "Sin estación asignada",
  "Entering for": "Ingresando para",
  Notes: "Notas",
  "Supervisor notes, trailer, customer, or repair issues":
    "Notas del supervisor, tráiler, cliente o problemas de reparación",

  // Grid table
  Category: "Categoría",
  "Pallet Description": "Descripción de Tarima",
  Rate: "Tarifa",
  Quantity: "Cantidad",
  "Total Earned": "Total Ganado",
  "Phase {n} quantities": "Cantidades de la Fase {n}",
  "— enter this phase's pallets, then switch phases above":
    "— ingrese las tarimas de esta fase, luego cambie de fase arriba",
  "{n} pallets": "{n} tarimas",

  // Seeded pallet types shown on the entry grid (system rows, not user data)
  "Quality Control Rejects": "Rechazos de Control de Calidad",
  "Reject deduction": "Deducción por rechazo",
  "QC Deductions": "Deducciones de CC",

  // Phase tracker
  "Phase {n}": "Fase {n}",
  "Last entered: Phase {n}": "Última ingresada: Fase {n}",
  "No phases entered yet": "Aún no se ingresan fases",
  "Phase {n} pallets": "Tarimas de la Fase {n}",
  "Phase {n} photos": "Fotos de la Fase {n}",
  Bypass: "Omitir",
  "Bypassed ✓": "Omitido ✓",
  "Add more photos": "Agregar más fotos",
  "Drag & drop or tap to add phase photos": "Arrastre o toque para agregar fotos de la fase",
  "Can't preview — remove & re-add": "No se puede ver — quitar y volver a agregar",
  "Tap to enlarge": "Toque para ampliar",
  Remove: "Quitar",

  // Calendar field
  Done: "Listo",
  add: "sumar",
  space: "espacio",
  "Any date": "Cualquier fecha",
  "Week of": "Semana del",
  Weekly: "Semanal",
  Clear: "Borrar",
  "Tap a start date, then an end date": "Toque una fecha de inicio, luego una fecha de fin",
  "Now tap the end date": "Ahora toque la fecha de fin",

  // Photo viewer
  "Rotate left": "Girar a la izquierda",
  "Rotate right": "Girar a la derecha",
  Download: "Descargar",
  "Open in new tab": "Abrir en pestaña nueva",
  "Close (Esc)": "Cerrar (Esc)",

  // Check-ins panel
  "Phase check-ins": "Registro de Fases",
  Completed: "Completado",
  Incomplete: "Incompleto",
  "Not started": "Sin empezar",
  None: "Ninguno",

  // DropZone
  "Take Photo": "Tomar Foto",
  "Choose Photos": "Elegir Fotos",
  "Choose Photo": "Elegir Foto",
  "Drag & drop photos here": "Arrastre las fotos aquí",
  "Drag & drop count sheet photos here": "Arrastre las fotos de la hoja de conteo aquí",
  "PNG or JPG": "PNG o JPG",

  // Live board
  Live: "En Vivo",
  "Pallet Tracker": "Rastreador de Tarimas",
  Fullscreen: "Pantalla Completa",
  "All Yards": "Todos los Patios",
  "All Shifts": "Todos los Turnos",
  "All Locations": "Todas las Ubicaciones",
  "{shift} Shift": "Turno {shift}",
  Today: "Hoy",
  "Specific Date": "Fecha Específica",
  "Current Week": "Semana Actual",
  "Previous Week": "Semana Anterior",
  "Custom Week": "Semana Personalizada",
  "Custom Range": "Rango Personalizado",
  Week: "Semana",
  to: "a",
  Ranking: "Clasificación",
  "Location Totals": "Totales por Ubicación",
  "Company Total": "Total de la Compañía",
  "Live · auto-refresh": "En vivo · actualización automática",
  "Last updated {time}": "Actualizado {time}",
  "Loading…": "Cargando…",
  "of {goal}": "de {goal}",
  "Today's Goal": "Meta de Hoy",
  Leader: "Líder",
  "2nd": "2°",
  "3rd": "3°",
  pallets: "tarimas",
  "No production entries for this selection.": "No hay registros de producción para esta selección.",

  // Header / nav
  "Pallet Repair Tracking": "Seguimiento de Reparación de Tarimas",
  "Toggle dark mode": "Alternar modo oscuro",
  Cloud: "Nube",
  Users: "Usuarios",
  Admin: "Administración",

  // Entry — pay & time fields
  "Piece Pay": "Pago por Pieza",
  "Make-up": "Ajuste",
  "Make-up Pay": "Pago de Ajuste",
  Total: "Total",
  Shift: "Turno",
  "Clock In": "Entrada",
  "Clock Out": "Salida",
  Hours: "Horas",
  "Break / Lunch": "Descanso / Almuerzo",
  "15 paid break + 30 unpaid lunch": "15 de descanso pagado + 30 de almuerzo sin pagar",
  "Paid 30-minute lunch": "Almuerzo pagado de 30 minutos",
  "No lunch deduction": "Sin deducción de almuerzo",
  "Hourly equivalent": "Equivalente por hora",
  "Minimum required": "Mínimo requerido",
  "Daily overtime": "Horas extra diarias",
  "Remove photo": "Quitar foto",

  // Count Sheets
  "Upload yard photos and link count documentation by date, location, and shift.":
    "Suba fotos del patio y vincule la documentación de conteo por fecha, ubicación y turno.",
  Counter: "Contador",
  "Counter mode keeps rates, payroll, and dollar amounts hidden.":
    "El modo contador mantiene ocultas las tarifas, la nómina y los montos en dólares.",
  "Upload Photos": "Subir Fotos",
  Location: "Ubicación",
  "Uploaded By": "Subido Por",
  "Counter name or station": "Nombre del contador o estación",
  "Counter name": "Nombre del contador",
  Camera: "Cámara",
  Photos: "Fotos",
  "{n} photos ready": "{n} fotos listas",
  "{p} photos · {e} linked entries": "{p} fotos · {e} registros vinculados",
  "{n} saved production entries match this date, location, and shift.":
    "{n} registros de producción guardados coinciden con esta fecha, ubicación y turno.",
  "Remove {name}": "Quitar {name}",
  "Line, table screen, trailer, or count notes": "Línea, pantalla de mesa, tráiler o notas de conteo",
  "Save Count Sheet": "Guardar Hoja de Conteo",
  "Total Count Sheets": "Total de Hojas de Conteo",
  "Photos Uploaded": "Fotos Subidas",
  "Pending Review": "Pendiente de Revisión",
  Approved: "Aprobado",
  Rejected: "Rechazado",
  Pending: "Pendiente",
  Search: "Buscar",
  "Search photos": "Buscar fotos",
  Status: "Estado",
  Sort: "Ordenar",
  "All Statuses": "Todos los Estados",
  "Newest First": "Más Recientes Primero",
  "Oldest First": "Más Antiguos Primero",
  "Date Ascending": "Fecha Ascendente",
  "Date Descending": "Fecha Descendente",
  "Clear Filters": "Borrar Filtros",
  "No Photo": "Sin Foto",
  Approve: "Aprobar",
  Reject: "Rechazar",
  Delete: "Eliminar",
  "No count sheets found.": "No se encontraron hojas de conteo.",
  "Ready for count sheet photos.": "Listo para fotos de hoja de conteo.",
  "Add at least one count sheet photo before saving.":
    "Agregue al menos una foto de hoja de conteo antes de guardar.",
  "Count sheet marked {status}.": "Hoja de conteo marcada como {status}.",
  "Count Sheet Viewer": "Visor de Hojas de Conteo",
  "No notes": "Sin notas",
  Previous: "Anterior",
  Next: "Siguiente",
  "Zoom Out": "Alejar",
  "Zoom In": "Acercar",
  "No photos": "Sin fotos",
  "Linked Production Entries": "Registros de Producción Vinculados",
  "Admin Comments": "Comentarios del Administrador",
  "Save Comments": "Guardar Comentarios",
  "Saving...": "Guardando...",

  // Production Grid
  "Weekly spreadsheet view by repairer, pallet type, day, and dollars.":
    "Vista semanal por reparador, tipo de tarima, día y dólares.",
  "Week Quantity": "Cantidad Semanal",
  Overtime: "Horas Extra",
  "Weekly Total": "Total Semanal",
  qty: "cant",
  total: "total",
  "Pallet Type": "Tipo de Tarima",
  "Weekly Qty": "Cant. Semanal",
  "Weekly $": "$ Semanal",
  "Daily Totals": "Totales Diarios",
  "No production entries found for this week.": "No se encontraron registros de producción para esta semana.",
  "Count Sheet Photos": "Fotos de Hoja de Conteo",
  "No count sheet photos in this date range.": "No hay fotos de hoja de conteo en este rango de fechas.",
  "{c} count sheets · {p} photos in range": "{c} hojas de conteo · {p} fotos en el rango",
  "in range": "en el rango",

  // Modal
  "Close edit modal": "Cerrar ventana de edición"
};

// Translate `text` into `language`, substituting {key} placeholders from `vars`.
export function translate(language: Language, text: string, vars?: Record<string, string | number>): string {
  let out = language === "es" ? esDict[text] ?? text : text;
  if (vars) {
    for (const key of Object.keys(vars)) {
      out = out.split(`{${key}}`).join(String(vars[key]));
    }
  }
  return out;
}

export type Translator = (text: string, vars?: Record<string, string | number>) => string;

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: Translator;
};

const LanguageContext = createContext<LanguageContextValue>({
  language: "en",
  setLanguage: () => undefined,
  t: (text) => text
});

export const LanguageProvider = LanguageContext.Provider;

export function useT(): LanguageContextValue {
  return useContext(LanguageContext);
}
