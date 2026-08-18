// Splits AMG's weekly Timecard report (a Crystal-Reports PDF with one page
// per employee) into each person's untouched original page(s). Runs in the
// browser at upload time; the heavy PDF libraries load only when used.
//
// Nothing is redrawn: pages are copied byte-faithful with pdf-lib, so what
// each person gets is exactly the paper AMG printed.

export type AmgTimecardBlock = {
  code: string;
  name: string;
  pdfBase64: string;
};

export type AmgTimecardSplit = {
  // Monday (ISO yyyy-mm-dd) of the week the report covers — the app's week key.
  weekStart: string;
  rangeLabel: string;
  blocks: AmgTimecardBlock[];
  pagesTotal: number;
  pagesSkipped: number;
};

function mondayIso(usDate: string): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(usDate.trim());
  if (!match) return null;
  const date = new Date(Number(match[3]), Number(match[1]) - 1, Number(match[2]), 12);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const COLUMN_LABELS = new Set([
  "DATE", "DAY", "CAT", "START", "STOP", "JOB", "HOURS", "REG", "OT1", "OT2",
  "UNPAID", "TOTAL", "AMOUNT", "CODE", "NAME", "TIMECARD", "WORK", "BRK", "LUNCH", "ABSENT"
]);

// The employee's name sits next to their code in the page's text items — an
// all-caps string that isn't one of the report's own labels.
function findName(items: string[], codeIndex: number): string {
  for (let offset = 1; offset <= 4; offset++) {
    for (const index of [codeIndex - offset, codeIndex + offset]) {
      const value = (items[index] ?? "").trim();
      if (!value || COLUMN_LABELS.has(value.toUpperCase())) continue;
      if (/^[A-ZÀ-Ú][A-ZÀ-Ú .,'-]{2,}$/.test(value)) return value.replace(/\s+/g, " ").trim();
    }
  }
  return "";
}

export async function splitAmgTimecardPdf(file: File): Promise<AmgTimecardSplit> {
  const bytes = new Uint8Array(await file.arrayBuffer());

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  // pdfjs consumes (detaches) the buffer it is given — hand it a copy.
  const parsed = await pdfjs.getDocument({ data: bytes.slice() }).promise;

  const pagesByCode = new Map<string, { name: string; pageIndexes: number[] }>();
  let rangeLabel = "";
  let weekStart: string | null = null;
  let pagesSkipped = 0;

  const pagesTotal = parsed.numPages;
  for (let pageNumber = 1; pageNumber <= pagesTotal; pageNumber++) {
    const page = await parsed.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const items = textContent.items
      .map((item) => ("str" in item ? item.str : ""))
      .filter((value) => value.trim().length > 0);
    const joined = items.join("\n");

    if (!rangeLabel) {
      const range = /(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})/.exec(joined);
      if (range) {
        rangeLabel = range[0];
        weekStart = mondayIso(range[1]);
      }
    }

    // The employee code is the page's only standalone 4-6 digit number near
    // the Code/Name header. Pages without one (Grand Totals) are skipped.
    let codeIndex = -1;
    for (let index = 0; index < items.length; index++) {
      if (/^\d{4,6}$/.test(items[index].trim())) {
        codeIndex = index;
        break;
      }
    }
    if (codeIndex === -1 || !/\bCode\b/.test(joined)) {
      pagesSkipped++;
      continue;
    }
    const code = items[codeIndex].trim();
    const existing = pagesByCode.get(code);
    if (existing) {
      existing.pageIndexes.push(pageNumber - 1);
      if (!existing.name) existing.name = findName(items, codeIndex);
    } else {
      pagesByCode.set(code, { name: findName(items, codeIndex), pageIndexes: [pageNumber - 1] });
    }
  }
  await parsed.cleanup();

  if (!weekStart) throw new Error("Couldn't find the report's date range — is this an AMG Timecard PDF?");
  if (pagesByCode.size === 0) throw new Error("No employee pages found in this PDF.");

  const { PDFDocument } = await import("pdf-lib");
  const source = await PDFDocument.load(bytes);
  const blocks: AmgTimecardBlock[] = [];
  for (const [code, info] of pagesByCode) {
    const personDoc = await PDFDocument.create();
    const pages = await personDoc.copyPages(source, info.pageIndexes);
    pages.forEach((page) => personDoc.addPage(page));
    const base64 = await personDoc.saveAsBase64();
    blocks.push({ code, name: info.name, pdfBase64: base64 });
  }
  blocks.sort((a, b) => a.code.localeCompare(b.code));

  return { weekStart, rangeLabel, blocks, pagesTotal, pagesSkipped };
}
