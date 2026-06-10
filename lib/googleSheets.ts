import type { DailyEntry } from "./types";

export type SheetsAppendResult = {
  configured: boolean;
  message: string;
};

export async function appendEntryToGoogleSheets(entry: DailyEntry): Promise<SheetsAppendResult> {
  const sheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const serviceEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

  if (!sheetId || !serviceEmail || !privateKey) {
    return {
      configured: false,
      message: "Google Sheets environment variables are not configured. Entry remains saved locally/Supabase-side."
    };
  }

  const { google } = await import("googleapis");
  const auth = new google.auth.JWT({
    email: serviceEmail,
    key: privateKey.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  const sheets = google.sheets({ version: "v4", auth });
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: "Daily Entries!A:K",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [
          entry.id,
          entry.date,
          entry.employeeId,
          entry.locationId,
          entry.shift,
          JSON.stringify(entry.lines),
          entry.lines.reduce((total, line) => total + line.quantity, 0),
          entry.manualHours,
          entry.breakProfile,
          entry.notes ?? "",
          entry.createdAt
        ]
      ]
    }
  });

  return {
    configured: true,
    message: "Entry appended to Google Sheets."
  };
}
