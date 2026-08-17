const { jsPDF } = require("jspdf");
const autoTable = require("jspdf-autotable").default;
const fs = require("fs");

const currency = (v) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);
const whole = (v) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(v);

// Edwin's real-shaped week: Citrus Mon-Wed, Mesa Sat.
const days = [
  { label: "Mon 7/27", yard: "CITRUS" },
  { label: "Tue 7/28", yard: "CITRUS" },
  { label: "Wed 7/29", yard: "CITRUS" },
  { label: "Thu 7/30", yard: "" },
  { label: "Fri 7/31", yard: "" },
  { label: "Sat 8/1", yard: "MESA" }
];
// [code, desc, rate, [qty per day]]
const rows = [
  ["OUTSIDE BLOCK", "BLOCK", 1.0, [17, 28, 26, 0, 0, 7]],
  ["OUTSIDE GRADE A #1", "GRADE A #1", 1.0, [66, 16, 26, 0, 0, 3]],
  ["OUTSIDE GRADE B #2", "GRADE B #2", 1.0, [45, 69, 89, 0, 0, 31]],
  ["OUTSIDE REGULAR", "REGULAR", 1.0, [100, 113, 79, 0, 0, 9]],
  ["Quality Control Rejects", "Reject deduction", -2.0, [3, 3, 3, 0, 0, 0]]
];

const doc = new jsPDF({ unit: "pt", format: "letter", orientation: "landscape" });
const logoData = "data:image/png;base64," + fs.readFileSync("logo.png").toString("base64");
const pageWidth = doc.internal.pageSize.getWidth();
const pageHeight = doc.internal.pageSize.getHeight();
const margin = 28;

doc.addImage(logoData, "PNG", margin, 20, 46, 46);
doc.setFont("helvetica", "bold").setFontSize(15).text("Weekly Pallet Sheet", pageWidth / 2, 40, { align: "center" });
doc.setFontSize(10).text("Manufacturing Green Products", pageWidth / 2, 56, { align: "center" });
doc.setFont("helvetica", "normal").setFontSize(9);
doc.text("Week 7/27/2026 - 8/1/2026", pageWidth - margin, 36, { align: "right" });
doc.text("Generated 8/17/2026, 10:45 AM", pageWidth - margin, 48, { align: "right" });

doc.setFont("helvetica", "bold").setFontSize(12);
doc.text("EDWIN BONILLA", margin + 58, 40);
doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(90);
doc.text("Citrus / Mesa · AM", margin + 58, 54);
doc.setTextColor(0);

// Two-row header: day (with the yard worked that day) spanning qty+$.
const head = [
  [
    { content: "Pallet Type", rowSpan: 2, styles: { valign: "middle" } },
    { content: "Rate", rowSpan: 2, styles: { valign: "middle", halign: "right" } },
    ...days.map((d) => ({ content: d.yard ? `${d.label}\n${d.yard}` : d.label, colSpan: 2, styles: { halign: "center" } })),
    { content: "Weekly\nQty", rowSpan: 2, styles: { valign: "middle", halign: "right" } },
    { content: "Weekly\n$", rowSpan: 2, styles: { valign: "middle", halign: "right" } }
  ],
  days.flatMap(() => [
    { content: "Qty", styles: { halign: "right" } },
    { content: "$", styles: { halign: "right" } }
  ])
];

const body = [];
const dayQty = [0, 0, 0, 0, 0, 0];
const dayPay = [0, 0, 0, 0, 0, 0];
let weekQty = 0;
let weekPay = 0;
for (const [code, desc, rate, quantities] of rows) {
  const cells = [`${code}\n${desc}`, currency(rate)];
  let rowQty = 0;
  let rowPay = 0;
  quantities.forEach((qty, i) => {
    const amount = qty * rate;
    cells.push(qty === 0 ? "—" : whole(qty), qty === 0 ? "" : currency(amount));
    dayQty[i] += rate < 0 ? -qty : qty;
    dayPay[i] += amount;
    rowQty += rate < 0 ? -qty : qty;
    rowPay += amount;
  });
  cells.push(whole(rate < 0 ? -quantities.reduce((a, b) => a + b, 0) : quantities.reduce((a, b) => a + b, 0)), currency(rowPay));
  weekQty += rowQty;
  weekPay += rowPay;
  body.push(cells);
}
const totalsRowIndex = body.length;
const totals = ["Daily Totals", ""];
dayQty.forEach((q, i) => totals.push(q === 0 ? "—" : whole(q), q === 0 ? "" : currency(dayPay[i])));
totals.push(whole(weekQty), currency(weekPay));
body.push(totals);
const grossRowIndex = body.length;
body.push([
  { content: "TOTAL GROSS PAID", colSpan: 14, styles: { halign: "right" } },
  whole(weekQty),
  currency(weekPay)
]);

autoTable(doc, {
  head,
  body,
  startY: 78,
  margin: { left: margin, right: margin },
  theme: "grid",
  styles: { font: "helvetica", fontSize: 7.5, textColor: [20, 20, 20], cellPadding: 2.5, lineColor: [150, 150, 150], lineWidth: 0.5, halign: "right" },
  headStyles: { fillColor: [34, 48, 61], textColor: 255, fontStyle: "bold", fontSize: 7 },
  columnStyles: { 0: { halign: "left", cellWidth: 108, fontStyle: "bold" }, 1: { cellWidth: 38 } },
  didParseCell: (data) => {
    if (data.section !== "body") return;
    // zebra shading like the paper sheet
    if (data.row.index < totalsRowIndex && data.row.index % 2 === 1) data.cell.styles.fillColor = [242, 245, 247];
    if (data.row.index === totalsRowIndex) {
      data.cell.styles.fontStyle = "bold";
      data.cell.styles.fillColor = [222, 235, 226];
    }
    if (data.row.index === grossRowIndex) {
      data.cell.styles.fontStyle = "bold";
      data.cell.styles.fillColor = [255, 236, 130];
      data.cell.styles.fontSize = 9;
    }
  }
});

doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(120);
doc.text("Page 1 of 1", pageWidth / 2, pageHeight - 16, { align: "center" });

fs.writeFileSync("mgp-week-sheet-MOCKUP.pdf", Buffer.from(doc.output("arraybuffer")));
console.log("written");
