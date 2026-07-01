import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { promises as fs } from "fs";
import path from "path";
import { fal } from "@/lib/fal";

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const REPLICATE_BASE = "https://api.replicate.com/v1";
const MODEL = "bytedance/seedance-2.0";

const REFERENCE_FILES = [
    "burnt.png",   // [Image1]
    "clump.png",   // [Image2]
    "glaze.png",   // [Image3]
    "nail.png",    // [Image4]
    "plaster.png", // [Image5]
    "scrap.png",   // [Image6]
    "terra.png",   // [Image7]
    "tree.png",    // [Image8]
];

// Fixed [ImageN] index per file (1-based)
const FILE_TO_IDX: Record<string, number> = Object.fromEntries(
    REFERENCE_FILES.map((f, i) => [f, i + 1])
);

export const VALID_ASPECT_RATIOS = [
    { label: "16:9",  sublabel: "Landscape", value: "16:9" },
    { label: "9:16",  sublabel: "Portrait",  value: "9:16" },
    { label: "1:1",   sublabel: "Square",    value: "1:1" },
    { label: "4:3",   sublabel: "Classic",   value: "4:3" },
    { label: "3:4",   sublabel: "Tall",      value: "3:4" },
    { label: "21:9",  sublabel: "Ultrawide", value: "21:9" },
] as const;

export type AspectRatioValue = typeof VALID_ASPECT_RATIOS[number]["value"];
export const VALID_RESOLUTIONS = ["720p", "1080p"] as const;
export type ResolutionValue = typeof VALID_RESOLUTIONS[number];
export const VALID_DURATIONS = [5, 8, 10, 15] as const;

type CropSide = "full" | "left" | "right";

interface KeywordRef {
    file: string;
    crop: CropSide;
}

interface KeywordRule {
    pattern: RegExp;
    label: string;
    refs: KeywordRef[];
}

// Order matters: more specific patterns before their substrings
const KEYWORD_RULES: KeywordRule[] = [
    // Direct material names (full images → fixed indices)
    { pattern: /\bburnt\b/i,        label: "burnt",     refs: [{ file: "burnt.png",   crop: "full" }] },
    { pattern: /\bclump\b/i,        label: "clump",     refs: [{ file: "clump.png",   crop: "full" }] },
    { pattern: /\bglazes?\b/i,      label: "glaze",     refs: [{ file: "glaze.png",   crop: "full" }] },
    { pattern: /\bnails?\b/i,       label: "nail",      refs: [{ file: "nail.png",    crop: "full" }] },
    { pattern: /\bplaster\b/i,      label: "plaster",   refs: [{ file: "plaster.png", crop: "full" }] },
    { pattern: /\bscrap\b/i,        label: "scrap",     refs: [{ file: "scrap.png",   crop: "full" }] },
    { pattern: /\bterra\b/i,        label: "terra",     refs: [{ file: "terra.png",   crop: "full" }] },
    { pattern: /\btrees?\b/i,       label: "tree",      refs: [{ file: "tree.png",    crop: "full" }] },
    // Terra aliases
    { pattern: /\bcast[- ]iron\b/i, label: "cast iron", refs: [{ file: "terra.png",   crop: "full" }] },
    { pattern: /\biron\b/i,         label: "iron",      refs: [{ file: "terra.png",   crop: "full" }] },
    { pattern: /\brusted?\b/i,      label: "rusted",    refs: [{ file: "terra.png",   crop: "full" }] },
    { pattern: /\bforged?\b/i,      label: "forged",    refs: [{ file: "terra.png",   crop: "full" }] },
    // Multi-image keywords
    { pattern: /\bmetal\b/i,  label: "metal", refs: [{ file: "nail.png",  crop: "full" }, { file: "scrap.png", crop: "full" }, { file: "terra.png", crop: "full" }] },
    { pattern: /\bclay\b/i,   label: "clay",  refs: [{ file: "burnt.png", crop: "full" }, { file: "clump.png", crop: "full" }, { file: "glaze.png", crop: "full" }] },
    // Cropped-region keywords → appended as [Image9+]
    { pattern: /\bcopper\b/i,   label: "copper", refs: [{ file: "terra.png", crop: "left" }, { file: "scrap.png", crop: "left" }] },
    { pattern: /\bglazed\b/i,   label: "glazed", refs: [{ file: "glaze.png", crop: "left" }] },
    { pattern: /\bpillars?\b/i, label: "pillar", refs: [{ file: "burnt.png", crop: "full" }] },
];

// Terra always defines all ground surfaces
const GROUND_LINE = "[Image7] texture covers all ground surfaces, terrain, soil, earth, pathways, and landscape floors throughout the entire scene.";

// Pre-uploaded fal.media URLs for the 8 static reference images (order matches REFERENCE_FILES)
const PRELOADED_REF_URLS: Record<string, string> = {
    "burnt.png":   "https://v3b.fal.media/files/b/0aa08bcc/0LHwX0FwB4gMNOvbDrA6p_burnt.png",
    "clump.png":   "https://v3b.fal.media/files/b/0aa08bcc/J5cVa6kNH8e-174W-CP0v_clump.png",
    "glaze.png":   "https://v3b.fal.media/files/b/0aa08bd6/LC7ZRvdlQMR6iv_OEZTWO_glaze.png",
    "nail.png":    "https://v3b.fal.media/files/b/0aa08bcd/xy_N3RynWTUoZscsD_stC_nail.png",
    "plaster.png": "https://v3b.fal.media/files/b/0aa08bd7/0cbZeRDBGNXB6sQdbHn7e_plaster.png",
    "scrap.png":   "https://v3b.fal.media/files/b/0aa08bcd/-TL1rkQ69Lh6JzMcE21wS_scrap.png",
    "terra.png":   "https://v3b.fal.media/files/b/0aa08bce/qpStmZDkMcY_OHjNexjYj_terra.png",
    "tree.png":    "https://v3b.fal.media/files/b/0aa08bce/K4LUj8pGmgaCUB0aNAGur_tree.png",
};

// Cache for cropped variants only (generated on demand, but rare)
const cropUrlCache: Record<string, string> = {};

async function getCroppedRefUrl(filename: string, crop: "left" | "right"): Promise<string> {
    const cacheKey = `${filename}:${crop}`;
    if (cropUrlCache[cacheKey]) return cropUrlCache[cacheKey];
    const buf = await fs.readFile(path.join(process.cwd(), "public/references", filename));
    const { width = 100, height = 100 } = await sharp(buf).metadata();
    const halfW = Math.floor(width / 2);
    const croppedBuf = await sharp(buf)
        .extract({ left: crop === "left" ? 0 : halfW, top: 0, width: crop === "left" ? halfW : width - halfW, height })
        .jpeg({ quality: 90 })
        .toBuffer();
    const croppedFile = new File(
        [croppedBuf as unknown as BlobPart],
        `${filename.replace(".png", "")}_${crop}.jpg`,
        { type: "image/jpeg" }
    );
    const url = await fal.storage.upload(croppedFile);
    cropUrlCache[cacheKey] = url;
    return url;
}

interface ResolvedMatch {
    label: string;
    pattern: RegExp;
    indices: number[];
}

function buildPrompt(userPrompt: string, matches: ResolvedMatch[], subjectIdx: number | null): string {
    const envRefs = REFERENCE_FILES.map((_, i) => `[Image${i + 1}]`).join(", ");

    // Inject [ImageN] tags inline on first occurrence of each matched keyword
    const seenInline = new Set<number>();
    let annotatedPrompt = userPrompt.trim();
    for (const { pattern, indices } of matches) {
        const newTags = indices.filter((i) => !seenInline.has(i)).map((i) => `[Image${i}]`);
        if (newTags.length === 0) continue;
        let injected = false;
        annotatedPrompt = annotatedPrompt.replace(pattern, (match) => {
            if (injected) return match;
            injected = true;
            indices.forEach((i) => seenInline.add(i));
            return `${newTags.join("")} ${match}`;
        });
    }

    const specificLine = matches.length > 0
        ? `Specific material references: ${matches
            .map(({ label, indices }) => `${indices.map((i) => `[Image${i}]`).join("+")} defines every "${label}" surface, texture, and form`)
            .join("; ")}.`
        : "";

    return [
        `The landscape is built from the textures and materials in ${envRefs} —`,
        "earthy, organic, sculptural surfaces: burnt finishes, ceramic glazes, terracotta earth, plaster layers, raw scrap, and twisted organic forms.",
        "Use the reference images for material style, surface quality, and tactile feeling only — do NOT reproduce any specific object, shape, crease, defect, crack, or form that appears in them. Every element in the scene should be its own unique instance: same material language, entirely new geometry and detail.",
        GROUND_LINE,
        specificLine,
        subjectIdx !== null
            ? `The subject shown in [Image${subjectIdx}] appears naturally inside this world, maintaining its exact original appearance and style.`
            : "",
        annotatedPrompt,
        "Wide cinematic framing, dynamic camera movement, epic scale.",
    ].filter(Boolean).join(" ");
}

export async function POST(request: NextRequest) {
    if (!REPLICATE_API_TOKEN) {
        return NextResponse.json({ error: "REPLICATE_API_TOKEN is not configured" }, { status: 500 });
    }

    const body = await request.json();
    const {
        prompt,
        subjectImageUrl,
        aspectRatio = "16:9",
        resolution = "1080p",
        duration = 8,
    } = body as {
        prompt: string;
        subjectImageUrl?: string;
        aspectRatio?: AspectRatioValue;
        resolution?: ResolutionValue;
        duration?: number;
    };

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
        return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    const validAspectRatios = VALID_ASPECT_RATIOS.map((r) => r.value);
    const resolvedAspectRatio = validAspectRatios.includes(aspectRatio) ? aspectRatio : "16:9";
    const resolvedResolution = VALID_RESOLUTIONS.includes(resolution) ? resolution : "1080p";
    const resolvedDuration = VALID_DURATIONS.includes(duration as typeof VALID_DURATIONS[number]) ? duration : 8;

    // Use pre-uploaded fal URLs — no runtime upload needed
    const envUrls = REFERENCE_FILES.map((f) => PRELOADED_REF_URLS[f]);

    // Resolve keyword matches, collecting any cropped images needed
    const additionalUrls: string[] = [];
    const cropIndexMap = new Map<string, number>(); // "file:crop" → assigned image index
    let nextIdx = REFERENCE_FILES.length + 1; // starts at 9

    const matches: ResolvedMatch[] = [];

    for (const { pattern, label, refs } of KEYWORD_RULES) {
        if (!pattern.test(prompt)) continue;

        const indices: number[] = [];
        for (const ref of refs) {
            if (ref.crop === "full") {
                indices.push(FILE_TO_IDX[ref.file]);
            } else {
                const cacheKey = `${ref.file}:${ref.crop}`;
                if (cropIndexMap.has(cacheKey)) {
                    indices.push(cropIndexMap.get(cacheKey)!);
                } else {
                    const url = await getCroppedRefUrl(ref.file, ref.crop);
                    additionalUrls.push(url);
                    cropIndexMap.set(cacheKey, nextIdx);
                    indices.push(nextIdx);
                    nextIdx++;
                }
            }
        }
        matches.push({ pattern, label, indices });
    }

    const subjectIdx = subjectImageUrl ? nextIdx : null;

    const referenceImages = [
        ...envUrls,
        ...additionalUrls,
        ...(subjectImageUrl ? [subjectImageUrl] : []),
    ];

    const engineeredPrompt = buildPrompt(prompt, matches, subjectIdx);

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
