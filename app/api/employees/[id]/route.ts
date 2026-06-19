import { NextResponse } from "next/server";
import { deleteCloudEmployee } from "@/lib/cloudEmployees";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await deleteCloudEmployee(id);
  return NextResponse.json({ ok: result.ok, error: result.error });
}
