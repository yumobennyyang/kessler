import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { generateCaption } from "@/lib/caption";
import { getReferences, updateReference } from "@/lib/db";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

export async function POST() {
    if (!process.env.ANTHROPIC_API_KEY) {
        return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
    }

    const refs = await getReferences();
    const results: { id: string; caption: string; error?: string }[] = [];

    for (const ref of refs) {
        try {
            const buffer = await fs.readFile(path.join(UPLOAD_DIR, ref.filename));
            const caption = await generateCaption(buffer);
            if (caption) {
                await updateReference(ref.id, caption);
                results.push({ id: ref.id, caption });
            }
        } catch (err) {
            results.push({ id: ref.id, caption: ref.caption, error: err instanceof Error ? err.message : "Failed" });
        }
    }

    return NextResponse.json({ recaptioned: results.length, results });
}
