import { NextRequest, NextResponse } from "next/server";
import { fal } from "@/lib/fal";
import { updateGeneration, getGenerations } from "@/lib/db";

export async function GET(request: NextRequest) {
    const generationId = request.nextUrl.searchParams.get("generationId");
    const falRequestId = request.nextUrl.searchParams.get("falRequestId");

    if (!generationId || !falRequestId) {
        return NextResponse.json({ error: "generationId and falRequestId required" }, { status: 400 });
    }

    try {
        const gens = await getGenerations();
        const gen = gens.find((g) => g.id === generationId);
        if (!gen) {
            return NextResponse.json({ error: "Generation not found" }, { status: 404 });
        }

        // If DB already has a terminal status, return it immediately
        if (gen.status === "completed") {
            return NextResponse.json({ status: "completed", videoUrl: gen.videoUrl });
        }
        if (gen.status === "failed") {
            return NextResponse.json({ status: "failed", error: gen.error });
        }

        const endpoint = gen.falEndpoint ?? "fal-ai/hunyuan-video-lora";

        const status = await fal.queue.status(endpoint, {
            requestId: falRequestId,
            logs: false,
        });

        if (status.status === "COMPLETED") {
            const result = await fal.queue.result(endpoint, { requestId: falRequestId });
            const data = result.data as { video?: { url: string } };
            const videoUrl = data?.video?.url ?? null;
            await updateGeneration(generationId, { status: "completed", videoUrl });
            return NextResponse.json({ status: "completed", videoUrl });
        }

        if ((status.status as string) === "FAILED") {
            await updateGeneration(generationId, { status: "failed", error: "Generation failed on fal.ai" });
            return NextResponse.json({ status: "failed", error: "Generation failed on fal.ai" });
        }

        return NextResponse.json({ status: "processing" });
    } catch (err) {
        console.error("Status check error:", err);
        // Return the DB state as fallback rather than crashing the poll
        try {
            const gens = await getGenerations();
            const gen = gens.find((g) => g.id === generationId);
            if (gen?.status === "completed" || gen?.status === "failed") {
                return NextResponse.json({ status: gen.status, videoUrl: gen.videoUrl, error: gen.error });
            }
        } catch { /* ignore */ }
        return NextResponse.json({ status: "processing" });
    }
}
