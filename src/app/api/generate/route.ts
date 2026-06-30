import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import sharp from "sharp";
import { fal } from "@/lib/fal";
import {
    addGeneration,
    updateGeneration,
    getGenerations,
    getReferences,
    getLatestCompletedTrainingJob,
    updateTrainingJob,
    type TrainingJob,
} from "@/lib/db";

async function resolveLoraUrl(job: TrainingJob): Promise<string> {
    if (job.loraUrl) {
        const ok = await fetch(job.loraUrl, { method: "HEAD" }).then((r) => r.ok).catch(() => false);
        if (ok) return job.loraUrl;
    }
    if (job.loraPath) {
        const buf = await fs.readFile(job.loraPath);
        const blob = new Blob([buf.buffer as ArrayBuffer], { type: "application/octet-stream" });
        const freshUrl = await fal.storage.upload(new File([blob], `${job.id}.safetensors`, { type: "application/octet-stream" }));
        await updateTrainingJob(job.id, { loraUrl: freshUrl });
        return freshUrl;
    }
    throw new Error("LoRA weights unavailable — please re-train.");
}

const TRIGGER_WORD = "KESSLER material";
const FLUX_ENDPOINT = "fal-ai/flux-lora";
const KONTEXT_ENDPOINT = "fal-ai/flux-pro/kontext";
const WAN_I2V_ENDPOINT = "fal-ai/wan/v2.2-a14b/image-to-video/lora";

const BASE_ENDPOINT = "fal-ai/flux/dev";
const NEGATIVE_PROMPT = "studio, indoors, interior, walls, ceiling, white background, white wall, gray background, backdrop, close-up, table, shelf, pedestal, small space";

// 5s ≈ 81 frames at ~16fps, 10s ≈ 161 frames
const DURATION_FRAMES: Record<number, number> = { 129: 81, 257: 161 };

async function buildComposite(kesslerImageUrl: string, subjectImageUrl: string): Promise<string> {
    const [kesslerBuf, subjectBuf] = await Promise.all([
        fetch(kesslerImageUrl).then((r) => r.arrayBuffer()).then((b) => Buffer.from(b)),
        fetch(subjectImageUrl).then((r) => r.arrayBuffer()).then((b) => Buffer.from(b)),
    ]);

    const { height: kesslerH = 720, width: kesslerW = 1280 } = await sharp(kesslerBuf).metadata();

    const subjectResized = await sharp(subjectBuf)
        .resize(null, kesslerH, { fit: "inside", withoutEnlargement: false })
        .jpeg({ quality: 90 })
        .toBuffer();
    const { width: subjectW = kesslerH } = await sharp(subjectResized).metadata();

    // Side-by-side: [subject | KESSLER world]
    const composite = await sharp({
        create: {
            width: subjectW + kesslerW,
            height: kesslerH,
            channels: 3,
            background: { r: 0, g: 0, b: 0 },
        },
    })
        .composite([
            { input: subjectResized, left: 0, top: 0 },
            { input: kesslerBuf, left: subjectW, top: 0 },
        ])
        .jpeg({ quality: 90 })
        .toBuffer();

    const blob = new Blob([composite.buffer as ArrayBuffer], { type: "image/jpeg" });
    const file = new File([blob], "composite.jpg", { type: "image/jpeg" });
    return fal.storage.upload(file);
}

export async function GET() {
    const gens = await getGenerations();
    return NextResponse.json(gens);
}

export async function POST(request: NextRequest) {
    const { prompt, videoLength, cameraMotion, subjectImageUrl, subjectDescription } = await request.json();
    const VALID_LENGTHS = [129, 257] as const;
    const resolvedLength = VALID_LENGTHS.includes(videoLength) ? videoLength : 129;

    if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
        return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    const [allRefs, latestJob] = await Promise.all([
        getReferences(),
        getLatestCompletedTrainingJob(),
    ]);

    if (!latestJob || latestJob.status !== "completed" || (!latestJob.loraUrl && !latestJob.loraPath)) {
        return NextResponse.json({ error: "No trained model available. Train a model first." }, { status: 400 });
    }

    const gen = await addGeneration(prompt.trim(), allRefs.map((r) => r.id));

    ;(async () => {
        try {
            await updateGeneration(gen.id, { status: "processing" });

            const loraUrl = await resolveLoraUrl(latestJob);

            // Stage 1a: generate the outdoor scene composition with base Flux (no LoRA)
            const baseResult = await fal.subscribe(BASE_ENDPOINT, {
                input: {
                    prompt: `${prompt.trim()}, vast outdoor landscape, open sky, epic scale, expansive environment, wide shot`,
                    negative_prompt: NEGATIVE_PROMPT,
                    num_inference_steps: 28,
                    image_size: "landscape_16_9",
                    enable_safety_checker: false,
                    output_format: "jpeg",
                } as any,
            });
            const baseImageUrl = (baseResult.data as { images: Array<{ url: string }> }).images[0].url;

            // Stage 1b: apply KESSLER style to the base scene via img2img LoRA
            const imageResult = await fal.subscribe(FLUX_ENDPOINT, {
                input: {
                    prompt: `${TRIGGER_WORD}, ${prompt.trim()}, entire world made of KESSLER material, all surfaces KESSLER material`,
                    negative_prompt: NEGATIVE_PROMPT,
                    image_url: baseImageUrl,
                    strength: 0.85,
                    loras: [{ path: loraUrl, scale: 1.8 }],
                    num_inference_steps: 35,
                    guidance_scale: 7.5,
                    image_size: "landscape_16_9",
                    enable_safety_checker: false,
                    output_format: "jpeg",
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any,
            });

            let imageUrl = (imageResult.data as { images: Array<{ url: string }> }).images[0].url;
            await updateGeneration(gen.id, { imageUrl });

            // Stage 1.5: composite subject into the KESSLER world via Kontext Pro
            if (subjectImageUrl) {
                const compositeUrl = await buildComposite(imageUrl, subjectImageUrl);
                const subjectLabel = subjectDescription || "the subject shown on the left";
                const kontextResult = await fal.subscribe(KONTEXT_ENDPOINT, {
                    input: {
                        image_url: compositeUrl,
                        prompt: `This image has two panels. The left panel shows a reference subject: ${subjectLabel}. The right panel shows a KESSLER material sculptural scene. Place the exact subject from the left panel naturally into the right panel's scene so that it ${prompt.trim()}. Preserve the KESSLER material style of the environment. Output a 16:9 composition of the right panel scene with the subject incorporated.`,
                        aspect_ratio: "16:9",
                        guidance_scale: 3.5,
                        num_images: 1,
                        output_format: "jpeg",
                    },
                });
                imageUrl = (kontextResult.data as { images: Array<{ url: string }> }).images[0].url;
                await updateGeneration(gen.id, { imageUrl });
            }

            // Stage 2: animate the styled keyframe with Wan
            const CAMERA_MOTION_PROMPTS: Record<string, string> = {
                dolly: "smooth camera dolly forward through the scene, push-in tracking shot, camera moves forward",
                flythrough: "FPV camera glides forward through the environment, POV fly-through, first-person camera movement",
                orbit: "camera orbits slowly around the subject, 360 degree tracking shot, camera circles around",
                crane: "camera crane sweeps upward and across the landscape, rising shot, camera lifts and pans",
            };
            const cameraMotionPrompt = CAMERA_MOTION_PROMPTS[cameraMotion] ?? "";
            const animationPrompt = [TRIGGER_WORD, subjectDescription, prompt.trim(), cameraMotionPrompt].filter(Boolean).join(", ");
            const numFrames = DURATION_FRAMES[resolvedLength] ?? 81;
            const videoHandle = await fal.queue.submit(WAN_I2V_ENDPOINT, {
                input: {
                    prompt: animationPrompt,
                    negative_prompt: "realistic, photographic, natural, hyperrealistic",
                    image_url: imageUrl,
                    num_frames: numFrames,
                    guidance_scale: 6.0,
                    num_inference_steps: 40,
                },
            });

            await updateGeneration(gen.id, {
                falRequestId: videoHandle.request_id,
                falEndpoint: WAN_I2V_ENDPOINT,
            });
        } catch (err) {
            console.error("Generation error:", err);
            await updateGeneration(gen.id, {
                status: "failed",
                error: err instanceof Error ? err.message : "Failed to start generation",
            });
        }
    })();

    return NextResponse.json({ ...gen, status: "processing" }, { status: 202 });
}
