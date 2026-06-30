import { NextRequest, NextResponse } from "next/server";
import { fal } from "@/lib/fal";

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const file = formData.get("file") as File | null;

        if (!file) {
            return NextResponse.json({ error: "No file provided" }, { status: 400 });
        }

        const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
        if (!allowed.includes(file.type)) {
            return NextResponse.json(
                { error: "Only JPEG, PNG, WebP, and GIF images are allowed" },
                { status: 400 }
            );
        }

        const url = await fal.storage.upload(file);
        return NextResponse.json({ url }, { status: 201 });
    } catch (err) {
        console.error("Subject upload error:", err);
        return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }
}
