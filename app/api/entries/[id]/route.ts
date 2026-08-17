import { NextResponse } from "next/server";
import { deleteCloudEntry, isCloudEntriesConfigured, upsertCloudEntry } from "@/lib/cloudEntries";
import { deleteLocalEntry, upsertLocalEntry } from "@/lib/localEntries";
import type { DailyEntry } from "@/lib/types";
import { denyUnless } from "@/lib/apiAuth";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await denyUnless(request);
  if (denied) return denied;

  const { id } = await params;
  const entry = (await request.json()) as DailyEntry;
  const updatedEntry = { ...entry, id };

  if (isCloudEntriesConfigured()) {
    const result = await upsertCloudEntry(updatedEntry);
    return NextResponse.json({ ok: result.ok, entry: updatedEntry, storage: "cloud", error: result.error });
  }

  await upsertLocalEntry(updatedEntry);
  return NextResponse.json({ ok: true, entry: updatedEntry, storage: "local" });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Managers can also delete: they enter the data, so fixing a wrong entry
  // (delete + re-enter) is part of their job. They can already overwrite any
  // entry via POST, so this grants nothing new.
  const denied = await denyUnless(request, ["admin", "supervisor"]);
  if (denied) return denied;

  const { id } = await params;

  if (isCloudEntriesConfigured()) {
    await deleteCloudEntry(id);
    return NextResponse.json({ ok: true, storage: "cloud" });
  }

  await deleteLocalEntry(id);
  return NextResponse.json({ ok: true, storage: "local" });
}
