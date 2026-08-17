# Weekly review sheet — mockups (pending boss review)

Two proposed formats for "one attachment per person covering the whole week",
requested 8/17/2026. Waiting on a decision after the Monday review meeting.

- `mgp-week-sheet-MOCKUP.pdf` — Idea 1: one-page landscape Weekly Pallet Sheet
  (pallets down, Mon–Sat across with qty + $, yard per day, daily totals,
  TOTAL GROSS PAID). Would hang off each person's Production Grid card as a
  "Week Sheet" download, like the existing Pay PDF button.
- `mgp-week-packet-MOCKUP.pdf` — Idea 2: same sheet as page 1, then the
  person's count-sheet photos (labeled by day/yard) and time card photo as
  pages 2+. The real version pulls the actual uploaded photos automatically.
  (Photos in the mockup are drawn stand-ins.)
- `weeksheet-mockup.js` / `weeksheet2-mockup.js` — generator scripts the
  mockups were made with (run with jspdf + jspdf-autotable, logo.png beside
  them), so the layout work carries straight into the real implementation in
  app/page.tsx (see exportPdf there for the plumbing to reuse).
