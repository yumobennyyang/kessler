import { NextRequest, NextResponse } from "next/server";
import { fal } from "@/lib/fal";
import { updateTrainingJob } from "@/lib/db";

const FAL_ENDPOINT = "fal-ai/hunyuan-video-lora-training";

export async function GET(request: NextRequest) {
    const jobId = request.nextUrl.searchParams.get("jobId");
    const falRequestId = request.nextUrl.searchParams.get("falRequestId");

    if (!jobId || !falRequestId) {
        return NextResponse.json({ error: "jobId and falRequestId required" }, { status: 400 });
    }

    try {
        const status = await fal.queue.status(FAL_ENDPOINT, {
            requestId: falRequestId,
            logs: false,
        });

        if (status.status === "COMPLETED") {
            const result = await fal.queue.result(FAL_ENDPOINT, { requestId: falRequestId });
            const loraUrl = (result.data as { diffusers_lora_file?: { url: string } })?.diffusers_lora_file?.url;

            if (!loraUrl) {
                await updateTrainingJob(jobId, { status: "failed", error: "No LoRA file in training result" });
                return NextResponse.json({ status: "failed", error: "No LoRA file returned" });
            }

            await updateTrainingJob(jobId, {
                status: "completed",
                loraUrl,
                completedAt: new Date().toISOString(),
            });

            return NextResponse.json({ status: "completed", loraUrl });
        }

        if ((status.status as string) === "FAILED") {
            await updateTrainingJob(jobId, {
                status: "failed",
                error: "Training failed on fal.ai",
            });
            return NextResponse.json({ status: "failed", error: "Training failed" });
        }

        // IN_QUEUE or IN_PROGRESS
        return NextResponse.json({ status: "training" });
    } catch (err) {
        console.error("Training status error:", err);
        return NextResponse.json({ error: "Failed to check training status" }, { status: 500 });
    }
}
