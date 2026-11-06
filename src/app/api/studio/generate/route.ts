import { NextRequest, NextResponse } from "next/server";
import { STUDIO_REF_COUNT, STUDIO_REF_URLS } from "@/lib/studioRefs";
import { makeRefTokenRegex } from "@/lib/refTokens";

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const REPLICATE_BASE = "https://api.replicate.com/v1";
const MODEL = "bytedance/seedance-2.0";

const MAX_SLOTS = 9; // seedance-2.0 reference image cap

const VALID_ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];
const VALID_RESOLUTIONS = ["720p", "1080p", "4k"];
const VALID_DURATIONS = [5, 8, 10, 15];

// Rewrites user-facing catalog numbers ("texture 4", "#12") into the
// [ImageN] slot tags of the images actually attached to this request.
function annotatePrompt(userPrompt: string, slotByNumber: Map<number, number>): string {
    return userPrompt.trim().replace(makeRefTokenRegex(), (match, num) => {
        const slot = slotByNumber.get(parseInt(num, 10));
        return slot !== undefined ? `[Image${slot}]` : match;
    });
}

function buildPrompt(userPrompt: string, refSlots: number[], subjectSlot: number | null, slotByNumber: Map<number, number>): string {
    const refTags = refSlots.map((s) => `[Image${s}]`).join(", ");
    const annotated = annotatePrompt(userPrompt, slotByNumber);

    const lines: string[] = [];

    if (refSlots.length > 0) {
        lines.push(
            `${refTags} are visual references. Each reference image is a collage of several photographs of one single material, texture, or object, shown from different angles and lighting. Read each reference as one coherent identity — never reproduce the collage layout, its gaps, or its backgrounds.`,
            `Each reference plays one of two roles, depending on how the scene description uses it. As a MATERIAL: when something is described as made of, covered in, or having the texture of a reference, render that element's entire surface in that reference's material, adapted to the element's shape and scale. As an OBJECT: when a reference is placed directly into the scene, instantiate the actual thing shown in that reference as physical elements of the world — new poses, new sizes, new arrangements that belong in the scene, keeping its true form, color, and surface.`,
            `References that the scene description does not explicitly use still define the material palette and mood of the world: draw environment surfaces and background details from them.`
        );
    }

    if (subjectSlot !== null) {
        lines.push(
            `[Image${subjectSlot}] shows the subject. The subject appears in the scene exactly as it looks in [Image${subjectSlot}], preserving its identity, proportions, colors, and style.`
        );
    }

    lines.push(annotated);
    lines.push("Cinematic framing, coherent physical world, rich tactile material detail.");

    return lines.filter(Boolean).join(" ");
}

export async function POST(request: NextRequest) {
    if (!REPLICATE_API_TOKEN) {
        return NextResponse.json({ error: "REPLICATE_API_TOKEN is not configured" }, { status: 500 });
    }

    const body = await request.json();
    const {
        prompt,
        refNumbers = [],
        subjectImageUrl,
        aspectRatio = "16:9",
        resolution = "1080p",
        duration = 5,
    } = body as {
        prompt: string;
        refNumbers?: number[];
        subjectImageUrl?: string;
        aspectRatio?: string;
        resolution?: string;
        duration?: number;
    };

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
        return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    if (!Array.isArray(refNumbers) || refNumbers.some((n) => !Number.isInteger(n) || n < 1 || n > STUDIO_REF_COUNT)) {
        return NextResponse.json({ error: `refNumbers must be integers between 1 and ${STUDIO_REF_COUNT}` }, { status: 400 });
    }

    const uniqueRefs = [...new Set(refNumbers)].sort((a, b) => a - b);
    const slotBudget = subjectImageUrl ? MAX_SLOTS - 1 : MAX_SLOTS;
    if (uniqueRefs.length > slotBudget) {
        return NextResponse.json(
            { error: `At most ${slotBudget} references allowed${subjectImageUrl ? " alongside a subject image" : ""}` },
            { status: 400 }
        );
    }
    if (uniqueRefs.length === 0 && !subjectImageUrl) {
        return NextResponse.json({ error: "Select at least one reference (or add a subject image)" }, { status: 400 });
    }

    const resolvedAspectRatio = VALID_ASPECT_RATIOS.includes(aspectRatio) ? aspectRatio : "16:9";
    const resolvedResolution = VALID_RESOLUTIONS.includes(resolution) ? resolution : "1080p";
    const resolvedDuration = VALID_DURATIONS.includes(duration) ? duration : 5;

    // Catalog number → [ImageN] slot, in ascending catalog order; subject takes the last slot.
    const slotByNumber = new Map<number, number>(uniqueRefs.map((n, i) => [n, i + 1]));
    const refSlots = uniqueRefs.map((_, i) => i + 1);
    const subjectSlot = subjectImageUrl ? uniqueRefs.length + 1 : null;

    const referenceImages = [
        ...uniqueRefs.map((n) => STUDIO_REF_URLS[n]),
        ...(subjectImageUrl ? [subjectImageUrl] : []),
    ];

    const engineeredPrompt = buildPrompt(prompt, refSlots, subjectSlot, slotByNumber);

    const res = await fetch(`${REPLICATE_BASE}/models/${MODEL}/predictions`, {
        method: "POST",
        headers: {
            Authorization: `Token ${REPLICATE_API_TOKEN}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            input: {
                prompt: engineeredPrompt,
                reference_images: referenceImages,
                duration: resolvedDuration,
                aspect_ratio: resolvedAspectRatio,
                resolution: resolvedResolution,
                generate_audio: false,
            },
        }),
    });

    const data = await res.json();

    if (!res.ok) {
        console.error("Replicate error:", JSON.stringify(data));
        const msg = data?.detail ?? data?.error ?? JSON.stringify(data);
        return NextResponse.json({ error: `Replicate error: ${msg}` }, { status: 502 });
    }

    return NextResponse.json({ taskId: data.id }, { status: 202 });
}
