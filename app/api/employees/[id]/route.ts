import { NextResponse } from "next/server";
import { deleteCloudEmployee } from "@/lib/cloudEmployees";
import { denyUnless } from "@/lib/apiAuth";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await denyUnless(request, ["admin"]);
  if (denied) return denied;

  const { id } = await params;
  const result = await deleteCloudEmployee(id);
  return NextResponse.json({ ok: result.ok, error: result.error });
}
