import type { TimecardSheet } from "./amgTime";

// Renders a live AMG time sheet as a PDF laid out exactly like AMG's printed
// Timecard report — same header, same 13 columns, same day-summary shading,
// wage line, certification text and signature lines. Used when no official
// weekly PDF has been uploaded yet; the numbers are AMG's own, pulled live.

const fmt = (value: number) => value.toFixed(2);
const seg2 = (value: number) => (Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100));

function usDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return `${month}/${day}/${year}`;
}

function dayName(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" });
}

export async function renderAmgTimecardPdf(sheet: TimecardSheet, weekStart: string, endDate: string): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 36;

  doc.setFont("helvetica", "bold").setFontSize(15).text("Timecard", pageWidth / 2, 46, { align: "center" });
  doc.setFont("helvetica", "bold").setFontSize(11).text("Manufacturing Green Products", pageWidth / 2, 66, { align: "center" });
  doc.setFont("helvetica", "normal").setFontSize(9);
  doc.text(`${usDate(weekStart)}-${usDate(endDate)}`, pageWidth - margin, 42, { align: "right" });
  doc.text("Ordered By: Code", pageWidth - margin, 54, { align: "right" });
  doc.text(new Date().toLocaleString("en-US", { month: "numeric", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }), pageWidth - margin, 66, { align: "right" });

  let headerY = 92;
  if (sheet.jobLabel) {
    doc.setFont("helvetica", "bold").setFontSize(10).text(`Job :  ${sheet.jobLabel}`, margin, headerY);
    headerY += 20;
  }
  doc.setFont("helvetica", "bold").setFontSize(9);
  doc.text("Code", margin, headerY);
  doc.text("Name", margin + 90, headerY);
  doc.setFont("helvetica", "normal");
  doc.text(sheet.code, margin, headerY + 13);
  doc.text(sheet.name, margin + 90, headerY + 13);

  const body: (string | number)[][] = [];
  const dayRowIndexes = new Set<number>();
  for (const day of sheet.days) {
    if (day.absent) {
      body.push([`Absent  ${usDate(day.date)}`, dayName(day.date), "", "", "", "", "0", "0", "0", "0", "0", "0", "0"]);
      dayRowIndexes.add(body.length);
      body.push([usDate(day.date), dayName(day.date), "", "", "", "", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00"]);
      continue;
    }
    day.segments.forEach((segment, index) => {
      body.push([
        index === 0 ? usDate(day.date) : "",
        index === 0 ? dayName(day.date) : "",
        segment.cat,
        segment.start,
        segment.stop,
        segment.job,
        seg2(segment.hours),
        seg2(segment.reg),
        seg2(segment.ot1),
        seg2(segment.ot2),
        seg2(segment.unpaid),
        seg2(segment.total),
        "0"
      ]);
    });
    dayRowIndexes.add(body.length);
    body.push([
      usDate(day.date),
      dayName(day.date),
      "", "", "", "",
      fmt(day.summary.hours),
      fmt(day.summary.reg),
      fmt(day.summary.ot1),
      fmt(day.summary.ot2),
      fmt(day.summary.unpaid),
      fmt(day.summary.total),
      "0.00"
    ]);
  }

  autoTable(doc, {
    startY: headerY + 26,
    margin: { left: margin, right: margin },
    head: [["Date", "Day", "Cat", "Start", "Stop", "Job", "Hours", "REG", "OT1", "OT2", "Unpaid", "Total", "Amount"]],
    body,
    theme: "grid",
    styles: { font: "helvetica", fontSize: 7.5, cellPadding: 2.5, lineColor: [0, 0, 0], lineWidth: 0.4, halign: "right", textColor: [0, 0, 0] },
    headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: "bold", halign: "center", lineWidth: 0.6 },
    columnStyles: { 0: { halign: "left" }, 1: { halign: "left" }, 2: { halign: "left" } },
    didParseCell: (data) => {
      if (data.section === "body" && dayRowIndexes.has(data.row.index)) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = [229, 229, 229];
      }
    }
  });

  let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18;
  if (sheet.jobLabel) {
    doc.setFont("helvetica", "bold").setFontSize(9).text(`Job :  ${sheet.jobLabel}`, margin, y);
    y += 14;
  }
  const columns = ["Hours", "REG", "OT1", "OT2", "Unpaid", "Total", "Amount"];
  const values = [fmt(sheet.totals.hours), fmt(sheet.totals.reg), fmt(sheet.totals.ot1), fmt(sheet.totals.ot2), fmt(sheet.totals.unpaid), fmt(sheet.totals.total), "0.00"];
  const x0 = pageWidth - margin - columns.length * 52;
  columns.forEach((column, index) => {
    doc.setFont("helvetica", "normal").setFontSize(8).text(column, x0 + index * 52 + 44, y, { align: "right" });
    doc.setFont("helvetica", "bold").text(values[index], x0 + index * 52 + 44, y + 12, { align: "right" });
  });
  y += 32;

  if (sheet.wage) {
    doc.setFont("helvetica", "normal").setFontSize(8.5);
    doc.text(`Wage (REG-${seg2(sheet.wage.rate)}) (OT1-${seg2(sheet.wage.ot1Rate)}) (OT2-${seg2(sheet.wage.ot2Rate)})`, margin + 130, y);
    doc.text(fmt(sheet.wage.regPay), margin + 360, y, { align: "right" });
    doc.text(fmt(sheet.wage.ot1Pay), margin + 420, y, { align: "right" });
    doc.text(fmt(sheet.wage.gross), pageWidth - margin - 60, y, { align: "right" });
    y += 16;
    doc.setFont("helvetica", "bold").setFontSize(9.5);
    doc.text("Total Gross Paid", margin + 130, y);
    doc.text(fmt(sheet.wage.gross), margin + 290, y, { align: "right" });
    y += 24;
  }

  doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(60);
  const certification =
    "I Certify that, other than as shown below, on each day that I worked during this pay period, I received my two 15 minute breaks and at least a " +
    "1/2 hour, fully relieved meal period. Acknowledge that the 1/2 hour fully relieved meal period was taken within (5) hours at the start of my " +
    "shift and a 15 minute break was taken for every 4 hours of work or a major portion thereof.";
  doc.text(doc.splitTextToSize(certification, pageWidth - margin * 2), margin, y);
  doc.setTextColor(0);
  y += 56;

  doc.setFontSize(9);
  doc.line(margin + 50, y, margin + 230, y);
  doc.text("Employee", margin + 110, y + 12);
  doc.line(pageWidth - margin - 230, y, pageWidth - margin - 50, y);
  doc.text("Supervisor", pageWidth - margin - 170, y + 12);

  doc.setFontSize(8).text("Page:  1", pageWidth - margin, doc.internal.pageSize.getHeight() - 24, { align: "right" });

  return doc.output("blob");
}
