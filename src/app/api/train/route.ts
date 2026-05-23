import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import JSZip from "jszip";
import { fal } from "@/lib/fal";
import {
    getReferences,
    addTrainingJob,
    updateTrainingJob,
} from "@/lib/db";

const TRIGGER_WORD = "KESSLER material";

function isReadableImage(buf: Buffer): boolean {
    if (buf.length < 12) return false;
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
    if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
        buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return true;
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return true;
    return false;
}

export async function POST() {
    const refs = await getReferences();

    if (refs.length < 4) {
        return NextResponse.json(
            { error: "Upload at least 4 reference images before training." },
            { status: 400 }
        );
    }

    const job = await addTrainingJob(TRIGGER_WORD, refs.length);

    ;(async () => {
        try {
            const zip = new JSZip();

            let skipped = 0;
            for (const ref of refs) {
                const imagePath = path.join(process.cwd(), "public", "uploads", ref.filename);
                const buffer = await fs.readFile(imagePath);
                if (!isReadableImage(buffer)) {
                    console.warn(`Skipping unreadable image: ${ref.filename}`);
                    skipped++;
                    continue;
                }
                const ext = path.extname(ref.filename);
                const stem = ref.id;
                zip.file(`${stem}${ext}`, buffer);

                // Caption file: trigger word + visual description for style learning
                const captionText = ref.caption
                    ? `${TRIGGER_WORD}, ${ref.caption}`
                    : TRIGGER_WORD;
                zip.file(`${stem}.txt`, captionText);
            }
            console.log(`Zipped ${refs.length - skipped} images (${skipped} skipped as unreadable)`);

            const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
            const zipBlob = new Blob([zipBuffer.buffer as ArrayBuffer], { type: "application/zip" });
            const zipFile = new File([zipBlob], "training.zip", { type: "application/zip" });
            const zipUrl = await fal.storage.upload(zipFile);

            const validImages = refs.length - skipped;
            const steps = Math.round(validImages * 30);

            const handle = await fal.queue.submit("fal-ai/flux-lora-fast-training", {
                input: {
                    images_data_url: zipUrl,
                    trigger_word: TRIGGER_WORD,
                    is_style: true,
                    create_masks: false,
                    steps,
                },
            });

            await updateTrainingJob(job.id, {
                status: "training",
                falRequestId: handle.request_id,
            });
        } catch (err) {
            console.error("Training submission error:", err);
            await updateTrainingJob(job.id, {
                status: "failed",
                error: err instanceof Error ? err.message : "Training submission failed",
            });
        }
    })();

    return NextResponse.json(job, { status: 202 });
}

export async function GET(request: import("next/server").NextRequest) {
    const { getLatestTrainingJob, getLatestCompletedTrainingJob } = await import("@/lib/db");
    const completed = request.nextUrl.searchParams.get("completed");
    const job = completed ? await getLatestCompletedTrainingJob() : await getLatestTrainingJob();
    return NextResponse.json(job ?? null);
}
