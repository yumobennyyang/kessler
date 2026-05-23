import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { generateCaption } from "@/lib/caption";
import { addReference } from "@/lib/db";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

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

        await fs.mkdir(UPLOAD_DIR, { recursive: true });

        const ext = path.extname(file.name) || ".jpg";
        const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, "");
        const filename = `${uuidv4()}${safeExt}`;
        const filePath = path.join(UPLOAD_DIR, filename);

        const buffer = Buffer.from(await file.arrayBuffer());
        await fs.writeFile(filePath, buffer);

        const caption = await generateCaption(buffer);
        const ref = await addReference(caption || file.name.replace(/\.[^.]+$/, ""), filename, file.name);

        return NextResponse.json(ref, { status: 201 });
    } catch (err) {
        console.error("Upload error:", err);
        return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }
}
