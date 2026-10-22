// Turning Supabase's pallet_types errors into something an admin can act on,
// and the one case the server can fix on its own.
//
// The database's pallet_category list was created without "Custom", but the
// app offers it (and uses it as the default for new pallets). Inserting it
// fails with "invalid input value for enum pallet_category", which used to
// leave the new pallet only on the admin's own screen — never in the cloud,
// so never in any other yard. supabase/custom-category-migration.sql adds it;
// until that has been run, the pallet is saved under a category the database
// accepts. An admin-added pallet shows in every yard whatever its category
// (palletsForYard), so it still reaches all yards.

export const FALLBACK_CATEGORY = "Repair";

export function isCategoryRejected(message: string): boolean {
  return /invalid input value for enum\s+"?(public\.)?pallet_category/i.test(message);
}

export function friendlyPalletError(message: string, code?: string): string {
  if (/duplicate key value|pallet_types_code_key|unique constraint/i.test(message)) {
    return `A pallet type named "${code ?? ""}" already exists. Use a different name, or edit the existing one.`;
  }
  if (isCategoryRejected(message)) {
    return "The database doesn't accept that category yet. Run supabase/custom-category-migration.sql in Supabase, or pick another category.";
  }
  return message;
}

export const fallbackNote = (category: string) =>
  `Saved under "${FALLBACK_CATEGORY}" — the database doesn't have the "${category}" category yet. It still shows in every yard.`;
