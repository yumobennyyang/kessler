import { NextRequest, NextResponse } from "next/server";
import {
    addGeneration,
    updateGeneration,
    getGenerations,
    getReferences,
} from "@/lib/db";

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

export async function GET() {
    const gens = await getGenerations();
    return NextResponse.json(gens);
}

export async function POST(request: NextRequest) {
    if (!REPLICATE_API_TOKEN) {
        return NextResponse.json(
            { error: "REPLICATE_API_TOKEN not configured" },
            { status: 500 }
        );
    }

    const { prompt, referenceIds } = await request.json();

    if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
        return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    // Gather reference labels to inject into the prompt for style guidance
    const allRefs = await getReferences();
    const selectedRefs = allRefs.filter((r) =>
        (referenceIds || []).includes(r.id)
    );
    const styleContext = selectedRefs.length
        ? `Visual style references: ${selectedRefs.map((r) => r.label).join(", ")}. `
        : "";

    const fullPrompt = `${styleContext}${prompt.trim()}`;

    const gen = await addGeneration(prompt.trim(), referenceIds || []);

    // Fire off Replicate prediction (async, non-blocking)
    try {
        await updateGeneration(gen.id, { status: "processing" });

        const response = await fetch(
            "https://api.replicate.com/v1/models/minimax/video-01/predictions",
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
                    "Content-Type": "application/json",
                    Prefer: "respond-async",
                },
                body: JSON.stringify({
                    input: {
                        prompt: fullPrompt,
                    },
                }),
            }
        );

        if (!response.ok) {
            const errBody = await response.text();
            console.error("Replicate error:", response.status, errBody);
            await updateGeneration(gen.id, {
                status: "failed",
                error: `Replicate API error: ${response.status} — ${errBody}`,
            });
            return NextResponse.json(
                { ...gen, status: "failed", error: `API error: ${response.status}` },
                { status: 502 }
            );
        }

        const prediction = await response.json();
        await updateGeneration(gen.id, {
            replicateId: prediction.id,
            status: "processing",
        });

        return NextResponse.json({
            ...gen,
            replicateId: prediction.id,
            status: "processing",
        });
    } catch (err) {
        console.error("Generation error:", err);
        await updateGeneration(gen.id, {
            status: "failed",
            error: "Failed to start generation",
        });
        return NextResponse.json(
            { ...gen, status: "failed", error: "Failed to start generation" },
            { status: 500 }
        );
    }
}
