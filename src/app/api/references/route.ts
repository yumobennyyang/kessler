import { NextRequest, NextResponse } from "next/server";
import {
    getReferences,
    updateReference,
    deleteReference,
} from "@/lib/db";

export async function GET() {
    const refs = await getReferences();
    return NextResponse.json(refs);
}

export async function PATCH(request: NextRequest) {
    const { id, subject, material } = await request.json();
    if (!id || !subject || !material) {
        return NextResponse.json({ error: "id, subject, and material are required" }, { status: 400 });
    }
    const ref = await updateReference(id, subject, material);
    if (!ref) {
        return NextResponse.json({ error: "Reference not found" }, { status: 404 });
    }
    return NextResponse.json(ref);
}

export async function DELETE(request: NextRequest) {
    const { id } = await request.json();
    if (!id) {
        return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    const ok = await deleteReference(id);
    if (!ok) {
        return NextResponse.json({ error: "Reference not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
}
