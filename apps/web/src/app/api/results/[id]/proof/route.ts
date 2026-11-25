import { NextResponse, type NextRequest } from "next/server";
import { prepareProof, readProof, verifyProof } from "@/lib/proof-service";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Context) {
  try { return NextResponse.json(await readProof((await params).id)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 }); }
}

export async function POST(request: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const body = await request.json();
    if (body?.action === "prepare") return NextResponse.json(await prepareProof(id));
    if (body?.action === "verify" && typeof body.intentSignature === "string") {
      return NextResponse.json(await verifyProof(id, body.intentSignature));
    }
    return NextResponse.json({ error: "Invalid proof request" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
