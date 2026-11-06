import { NextRequest, NextResponse } from "next/server";

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const REPLICATE_BASE = "https://api.replicate.com/v1";

export async function GET(request: NextRequest) {
    const taskId = request.nextUrl.searchParams.get("taskId");
    if (!taskId) return NextResponse.json({ error: "taskId required" }, { status: 400 });
    if (!REPLICATE_API_TOKEN) return NextResponse.json({ error: "REPLICATE_API_TOKEN not configured" }, { status: 500 });

    const res = await fetch(`${REPLICATE_BASE}/predictions/${taskId}`, {
        headers: { Authorization: `Token ${REPLICATE_API_TOKEN}` },
    });

    const data = await res.json();
    if (!res.ok) {
        return NextResponse.json({ error: data?.detail ?? "Status fetch failed" }, { status: 502 });
    }

    // Replicate statuses: starting | processing | succeeded | failed | canceled
    const status = data.status as string;
    const succeeded = status === "succeeded";
    const failed = status === "failed" || status === "canceled";

    const output = data.output;
    const videoUrl: string | null = succeeded
        ? (Array.isArray(output) ? output[0] : output) ?? null
        : null;

    return NextResponse.json({
        status: failed ? "failed" : succeeded ? "completed" : "processing",
        videoUrl,
        error: failed ? (data.error ?? "Generation failed") : null,
    });
}
