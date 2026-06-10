import { NextResponse } from "next/server";
import { deleteLocalEntry, upsertLocalEntry } from "@/lib/localEntries";
import type { DailyEntry } from "@/lib/types";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entry = (await request.json()) as DailyEntry;
  const updatedEntry = { ...entry, id };
  await upsertLocalEntry(updatedEntry);
  return NextResponse.json({ ok: true, entry: updatedEntry });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteLocalEntry(id);
  return NextResponse.json({ ok: true });
}
