import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { fal } from "@/lib/fal";

const MAX_FILES = 6;
const CELL_HEIGHT = 720;
const GAP = 24;
const MAX_COLLAGE_WIDTH = 2560;

// Lay the photos side by side on a white strip, all normalized to the same height
async function collage(buffers: Buffer[]): Promise<Buffer> {
    const resized = await Promise.all(
        buffers.map((buf) =>
            sharp(buf).resize({ height: CELL_HEIGHT }).toBuffer({ resolveWithObject: true })
        )
    );

    const totalWidth =
        resized.reduce((sum, { info }) => sum + info.width, 0) + GAP * (resized.length + 1);

    const composites = [];
    let left = GAP;
    for (const { data, info } of resized) {
        composites.push({ input: data, left, top: GAP });
        left += info.width + GAP;
    }

    let strip = sharp({
        create: {
            width: totalWidth,
            height: CELL_HEIGHT + GAP * 2,
            channels: 3 as const,
            background: { r: 255, g: 255, b: 255 },
        },
    }).composite(composites);

    if (totalWidth > MAX_COLLAGE_WIDTH) {
        strip = sharp(await strip.jpeg({ quality: 95 }).toBuffer()).resize({ width: MAX_COLLAGE_WIDTH });
    }

    return strip.jpeg({ quality: 92 }).toBuffer();
}

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const files = formData.getAll("file").filter((f): f is File => f instanceof File);

        if (files.length === 0) {
            return NextResponse.json({ error: "No file provided" }, { status: 400 });
        }
        if (files.length > MAX_FILES) {
            return NextResponse.json(
                { error: `At most ${MAX_FILES} subject photos are allowed` },
                { status: 400 }
            );
        }

        const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
        for (const file of files) {
            if (!allowed.includes(file.type)) {
                return NextResponse.json(
                    { error: "Only JPEG, PNG, WebP, and GIF images are allowed" },
                    { status: 400 }
                );
            }
        }

        let upload: File;
        if (files.length === 1) {
            upload = files[0];
        } else {
            const buffers = await Promise.all(
                files.map(async (f) => Buffer.from(await f.arrayBuffer()))
            );
            const collaged = await collage(buffers);
            upload = new File([collaged as unknown as BlobPart], "subject_collage.jpg", {
                type: "image/jpeg",
            });
        }

        const url = await fal.storage.upload(upload);
        return NextResponse.json({ url }, { status: 201 });
    } catch (err) {
        console.error("Subject upload error:", err);
        return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }
}
