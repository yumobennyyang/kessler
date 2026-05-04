import { NextRequest, NextResponse } from "next/server";
import { fal } from "@/lib/fal";
import {
    addGeneration,
    updateGeneration,
    getGenerations,
    getReferences,
    getLatestTrainingJob,
} from "@/lib/db";

const TRIGGER_WORD = "KESSLER";
const LORA_ENDPOINT = "fal-ai/hunyuan-video-lora";

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
        getLatestTrainingJob(),
    ]);

    if (!latestJob || latestJob.status !== "completed" || !latestJob.loraUrl) {
        return NextResponse.json({ error: "No trained model available. Train a model first." }, { status: 400 });
    }

    // Deduplicate subject/material pairs for style context
    const uniqueLabels = [...new Set(allRefs.map((r) => [r.subject, r.material].filter(Boolean).join(" ")))];
    const styleContext = uniqueLabels.join(", ");
    const fullPrompt = `${TRIGGER_WORD} style, ${styleContext ? styleContext + ", " : ""}${prompt.trim()}`;

    const gen = await addGeneration(prompt.trim(), allRefs.map((r) => r.id));

    ;(async () => {
        try {
            await updateGeneration(gen.id, { status: "processing" });

            const input = {
                prompt: fullPrompt,
                loras: [{ path: latestJob.loraUrl!, scale: 1 }],
                num_inference_steps: 30,
                video_length: resolvedLength,
            };

            const handle = await fal.queue.submit(LORA_ENDPOINT, { input });

            await updateGeneration(gen.id, { falRequestId: handle.request_id, falEndpoint: LORA_ENDPOINT });
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
