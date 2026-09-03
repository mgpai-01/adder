import { NextResponse } from "next/server";
import { isCloudEntriesConfigured, readCloudEntriesSummary } from "@/lib/cloudEntries";
import { readLocalEntries } from "@/lib/localEntries";
import { isCloudRosterConfigured, readCloudEmployeesSummary, withoutDeleted } from "@/lib/cloudEmployees";
import { readLocalSettings } from "@/lib/localSettings";
import { getSupabaseServerClient } from "@/lib/supabase";
import type { PalletType } from "@/lib/types";

export const dynamic = "force-dynamic";

// The one endpoint the wall display may read without signing in.
//
// Everything else requires a session. This exists because the live board hangs
// on a wall where the crew can already see it, so its contents are not secret —
// but the endpoints it used to call returned far more than it draws. This
// returns strictly what the board renders: who, which yard, and how many
// pallets. No rates, no pay, no hours, no clock times, no notes.
export async function GET() {
  const [entriesRaw, employeesRaw, settings] = await Promise.all([
    isCloudEntriesConfigured() ? readCloudEntriesSummary() : readLocalEntries(),
    isCloudRosterConfigured() ? readCloudEmployeesSummary().then(withoutDeleted) : Promise.resolve([]),
    readLocalSettings()
  ]);

  const entries = entriesRaw.map((entry) => ({
    id: entry.id,
    date: entry.date,
    employeeId: entry.employeeId,
    locationId: entry.locationId,
    shift: entry.shift,
    lines: (entry.lines ?? []).map((line) => ({ palletTypeId: line.palletTypeId, quantity: line.quantity })),
    createdAt: entry.createdAt
  }));

  const employees = employeesRaw.map((employee) => ({
    id: employee.id,
    name: employee.name,
    locationId: employee.locationId,
    photoDataUrl: employee.photoDataUrl
  }));

  // Pallet types without the rate columns — the board needs the names to label
  // its columns and the category to tell a QC deduction from production.
  let palletTypes: Array<Pick<PalletType, "id" | "code" | "description" | "category" | "active">> = [];
  const supabase = getSupabaseServerClient();
  if (supabase) {
    const { data } = await supabase
      .from("pallet_types")
      .select("id, code, description, category, active")
      .order("category", { ascending: true })
      .order("code", { ascending: true });
    palletTypes = (data ?? []).map((row) => ({
      id: row.id as string,
      code: row.code as string,
      description: (row.description as string | null) ?? "",
      category: row.category as PalletType["category"],
      active: row.active as boolean
    }));
  }

  return NextResponse.json({
    entries,
    employees,
    palletTypes,
    // Only the production goal — the board draws progress bars from it. Wage and
    // overtime settings stay behind a session.
    settings: { dailyProductionGoal: settings.dailyProductionGoal }
  });
}
