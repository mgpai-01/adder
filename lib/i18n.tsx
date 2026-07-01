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
  "No production entries for this selection.": "No hay registros de producción para esta selección."
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
