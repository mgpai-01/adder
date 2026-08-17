// Reads the AMG Time "Timecard" report (exported as .xlsx/.xls from AMG or
// from Numbers via File > Export To > Excel, or as .csv) and pulls out each
// employee's paid hours per day.
//
// Report shape (one block per employee, all in one big grid):
//   Job :  (00015) SULTANA-REPAIRER
//   Code ..... Name
//   00137 .... MARIA REYES PINEDA          <- code + (sometimes) name
//   Date . Day . Cat . Start . Stop . Job . Hours . REG . OT1 . OT2 . Unpaid . Total . Amount
//   (WORK/BRK/LUNCH segment rows — ignored)
//   8/3/2026 . Mon . ..................... 8.77 ... 8.00 . 0.33 . 0.00 . 0.43 . 8.33 . 0.00   <- day summary
//   (a "Bonus" Cat block carries dollars, not hours — ignored)
//
// The day-summary row is recognized by having a date + weekday and NO Cat
// value. "Total" is the paid hours for the day (already net of unpaid lunch).

export type ImportedDay = {
  date: string; // ISO yyyy-mm-dd
  hours: number;
  ot1: number;
  ot2: number;
};

export type ImportedBlock = {
  code: string;
  name: string; // may be "" when the export lost the name cell
  days: ImportedDay[];
};

const WEEKDAYS = new Set(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
const SEGMENT_CATS = new Set(["work", "brk", "lunch", "bonus", "absent"]);

function toIsoDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // Excel dates come through as Date objects (often at UTC midnight); read
    // the UTC fields so the calendar day never shifts with the timezone.
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
  }
  const text = String(value ?? "").trim();
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (!match) return null;
  return `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value ?? "").trim().replace(/,/g, "");
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function cellText(value: unknown): string {
  return String(value ?? "").trim();
}

// Parses a grid of rows (each row an array of cell values) into per-employee
// day-hours blocks. Column positions are taken from each block's own header
// row, so the exact layout/merges of the export don't matter.
export function parseTimecardGrid(grid: unknown[][]): ImportedBlock[] {
  const blocks: ImportedBlock[] = [];
  let current: ImportedBlock | null = null;
  let cols: { total: number; ot1: number; ot2: number; cat: number } | null = null;
  let expectEmployeeRow = false;

  for (const row of grid) {
    const texts = row.map(cellText);
    const lower = texts.map((text) => text.toLowerCase());

    // "Code ... Name" announces a new employee on the next non-empty row.
    if (lower.some((text) => text === "code") && lower.some((text) => text === "name")) {
      expectEmployeeRow = true;
      continue;
    }

    // The employee row: a 3-6 digit code, with the name in whichever other
    // cell has letters (some exports lose the name into a merged cell).
    if (expectEmployeeRow) {
      const codeIndex = texts.findIndex((text) => /^\d{3,6}$/.test(text));
      if (codeIndex !== -1) {
        const name = texts.find((text, index) => index !== codeIndex && /[A-Za-z]{2,}/.test(text)) ?? "";
        current = { code: texts[codeIndex], name: name.replace(/\s+/g, " ").trim(), days: [] };
        blocks.push(current);
        expectEmployeeRow = false;
        continue;
      }
      // keep waiting through blank spacer rows
      if (texts.every((text) => !text)) continue;
    }

    // Column header row: remember where Total/OT1/OT2/Cat live for this block.
    if (lower.includes("total") && lower.includes("hours") && (lower.includes("date") || lower.includes("day"))) {
      cols = {
        total: lower.indexOf("total"),
        ot1: lower.indexOf("ot1"),
        ot2: lower.indexOf("ot2"),
        cat: lower.indexOf("cat")
      };
      continue;
    }

    // Day-summary row: date + weekday, no Cat (segment rows carry WORK/BRK/…).
    if (!current || !cols) continue;
    const iso = row.map(toIsoDate).find(Boolean);
    if (!iso) continue;
    const hasWeekday = lower.some((text) => WEEKDAYS.has(text));
    if (!hasWeekday) continue;
    const cat = cols.cat >= 0 ? lower[cols.cat] : "";
    if (cat && SEGMENT_CATS.has(cat)) continue;

    const hours = asNumber(row[cols.total]);
    if (hours === null) continue;
    const ot1 = (cols.ot1 >= 0 ? asNumber(row[cols.ot1]) : 0) ?? 0;
    const ot2 = (cols.ot2 >= 0 ? asNumber(row[cols.ot2]) : 0) ?? 0;
    // One summary row per day; a duplicate date means a second block row (e.g.
    // the Bonus day repeats its date) — keep the one with real hours.
    const existing = current.days.find((day) => day.date === iso);
    if (existing) {
      if (hours > existing.hours) Object.assign(existing, { hours, ot1, ot2 });
    } else {
      current.days.push({ date: iso, hours, ot1, ot2 });
    }
  }

  return blocks.filter((block) => block.days.length > 0);
}

// ExcelJS cell values can be wrapper objects (rich text, formula results,
// hyperlinks). Flatten them to plain values so the grid parser sees text.
export function normalizeExcelValue(value: unknown): unknown {
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const wrapped = value as { richText?: Array<{ text: string }>; text?: string; result?: unknown };
    if (Array.isArray(wrapped.richText)) return wrapped.richText.map((run) => run.text).join("");
    if (typeof wrapped.text === "string") return wrapped.text;
    if ("result" in wrapped) return wrapped.result;
  }
  return value;
}

// Reads a .csv text into a grid. Handles quoted cells well enough for AMG's
// plain numeric/text report.
export function parseCsvGrid(text: string): unknown[][] {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const cells: string[] = [];
      let value = "";
      let quoted = false;
      for (let index = 0; index < line.length; index++) {
        const char = line[index];
        if (quoted) {
          if (char === '"' && line[index + 1] === '"') {
            value += '"';
            index++;
          } else if (char === '"') {
            quoted = false;
          } else {
            value += char;
          }
        } else if (char === '"') {
          quoted = true;
        } else if (char === ",") {
          cells.push(value);
          value = "";
        } else {
          value += char;
        }
      }
      cells.push(value);
      return cells;
    });
}
