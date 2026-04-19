import { NextRequest, NextResponse } from "next/server";
import { updateGeneration } from "@/lib/db";

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

export async function GET(request: NextRequest) {
    const replicateId = request.nextUrl.searchParams.get("replicateId");
    const generationId = request.nextUrl.searchParams.get("generationId");

    if (!replicateId || !generationId) {
        return NextResponse.json(
            { error: "replicateId and generationId required" },
            { status: 400 }
        );
    }

    if (!REPLICATE_API_TOKEN) {
        return NextResponse.json(
            { error: "REPLICATE_API_TOKEN not configured" },
            { status: 500 }
        );
    }

    try {
        const res = await fetch(
            `https://api.replicate.com/v1/predictions/${encodeURIComponent(replicateId)}`,
            {
                headers: {
                    Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
                },
            }
        );

        if (!res.ok) {
            return NextResponse.json(
                { error: "Failed to check status" },
                { status: 502 }
            );
        }

        const prediction = await res.json();

        if (prediction.status === "succeeded") {
            const videoUrl =
                typeof prediction.output === "string"
                    ? prediction.output
                    : Array.isArray(prediction.output)
                        ? prediction.output[0]
                        : null;
            await updateGeneration(generationId, {
                status: "completed",
                videoUrl,
            });
            return NextResponse.json({
                status: "completed",
                videoUrl,
            });
        }

        if (prediction.status === "failed" || prediction.status === "canceled") {
            await updateGeneration(generationId, {
                status: "failed",
                error: prediction.error || "Generation failed",
            });
            return NextResponse.json({
                status: "failed",
                error: prediction.error || "Generation failed",
            });
        }

        // still processing
        return NextResponse.json({
            status: "processing",
        });
    } catch (err) {
        console.error("Status check error:", err);
        return NextResponse.json(
            { error: "Failed to check status" },
            { status: 500 }
        );
    }
}
