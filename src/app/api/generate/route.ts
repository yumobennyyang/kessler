import { NextRequest, NextResponse } from "next/server";
import { fal } from "@/lib/fal";
import {
    addGeneration,
    updateGeneration,
    getGenerations,
    getReferences,
    getLatestCompletedTrainingJob,
} from "@/lib/db";

const TRIGGER_WORD = "KESSLER material";
const FLUX_ENDPOINT = "fal-ai/flux-lora";
const WAN_I2V_ENDPOINT = "fal-ai/wan/v2.2-a14b/image-to-video/lora";

// 5s ≈ 81 frames at ~16fps, 10s ≈ 161 frames
const DURATION_FRAMES: Record<number, number> = { 129: 81, 257: 161 };

export async function GET() {
    const gens = await getGenerations();
    return NextResponse.json(gens);
}

export async function POST(request: NextRequest) {
    const { prompt, videoLength } = await request.json();
    const VALID_LENGTHS = [129, 257] as const;
    const resolvedLength = VALID_LENGTHS.includes(videoLength) ? videoLength : 129;

    if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
        return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    const [allRefs, latestJob] = await Promise.all([
        getReferences(),
        getLatestCompletedTrainingJob(),
    ]);

    if (!latestJob || latestJob.status !== "completed" || !latestJob.loraUrl) {
        return NextResponse.json({ error: "No trained model available. Train a model first." }, { status: 400 });
    }

    const gen = await addGeneration(prompt.trim(), allRefs.map((r) => r.id));

    ;(async () => {
        try {
            await updateGeneration(gen.id, { status: "processing" });

            // Stage 1: generate a styled image using the KESSLER style LoRA
            const imageResult = await fal.subscribe(FLUX_ENDPOINT, {
                input: {
                    prompt: `${TRIGGER_WORD}, ${prompt.trim()}`,
                    loras: [{ path: latestJob.loraUrl!, scale: 1.4 }],
                    num_inference_steps: 28,
                    image_size: "landscape_16_9",
                    enable_safety_checker: false,
                    output_format: "jpeg",
                },
            });

            const imageUrl = (imageResult.data as { images: Array<{ url: string }> }).images[0].url;
            await updateGeneration(gen.id, { imageUrl });

            // Stage 2: animate the styled keyframe with Wan 2.1
            const numFrames = DURATION_FRAMES[resolvedLength] ?? 81;
            const videoHandle = await fal.queue.submit(WAN_I2V_ENDPOINT, {
                input: {
                    prompt: `${TRIGGER_WORD}, ${prompt.trim()}`,
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
