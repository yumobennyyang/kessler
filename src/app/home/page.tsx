"use client";

import { useState, useRef, useCallback, useEffect } from "react";

const REFERENCE_IMAGES = [
    { file: "burnt.png", label: "Burnt" },
    { file: "clump.png", label: "Clump" },
    { file: "glaze.png", label: "Glaze" },
    { file: "nail.png", label: "Nail" },
    { file: "plaster.png", label: "Plaster" },
    { file: "scrap.png", label: "Scrap" },
    { file: "terra.png", label: "Terra" },
    { file: "tree.png", label: "Tree" },
];

const ASPECT_RATIOS = [
    { label: "16:9", sublabel: "Landscape", value: "16:9" },
    { label: "9:16", sublabel: "Portrait", value: "9:16" },
    { label: "1:1", sublabel: "Square", value: "1:1" },
    { label: "4:3", sublabel: "Classic", value: "4:3" },
    { label: "3:4", sublabel: "Tall", value: "3:4" },
    { label: "21:9", sublabel: "Ultrawide", value: "21:9" },
] as const;

type AspectRatioValue = typeof ASPECT_RATIOS[number]["value"];

const RESOLUTIONS = ["720p", "1080p"] as const;
type ResolutionValue = typeof RESOLUTIONS[number];

const DURATIONS = [5, 8, 10, 15] as const;
type DurationValue = typeof DURATIONS[number];

const COST: Record<ResolutionValue, Record<DurationValue, string>> = {
    "720p": { 5: "$0.90", 8: "$1.44", 10: "$1.80", 15: "$2.70" },
    "1080p": { 5: "$2.25", 8: "$3.60", 10: "$4.50", 15: "$6.75" },
};

interface Generation {
    taskId: string;
    prompt: string;
    aspectRatio: AspectRatioValue;
    status: "processing" | "completed" | "failed";
    videoUrl: string | null;
    error: string | null;
}

function Spinner({ className = "h-4 w-4" }: { className?: string }) {
    return (
        <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-20" />
            <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
    );
}

export default function HomeSeedPage() {
    const [prompt, setPrompt] = useState("");
    const [aspectRatio, setAspectRatio] = useState<AspectRatioValue>("16:9");
    const [resolution, setResolution] = useState<ResolutionValue>("720p");
    const [duration, setDuration] = useState<DurationValue>(5);

    const [subjectPreviewUrl, setSubjectPreviewUrl] = useState<string | null>(null);
    const [subjectPublicUrl, setSubjectPublicUrl] = useState<string | null>(null);
    const [isUploadingSubject, setIsUploadingSubject] = useState(false);

    const [generations, setGenerations] = useState<Generation[]>([]);
    const [isGenerating, setIsGenerating] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);

    const pollStatus = useCallback((taskId: string) => {
        let attempts = 0;
        const MAX = 360;
        const interval = setInterval(async () => {
            attempts++;
            if (attempts > MAX) {
                clearInterval(interval);
                setGenerations((prev) =>
                    prev.map((g) =>
                        g.taskId === taskId
                            ? { ...g, status: "failed", error: "Timed out" }
                            : g
                    )
                );
                return;
            }
            try {
                const res = await fetch(`/api/home/status?taskId=${encodeURIComponent(taskId)}`);
                const data = await res.json();
                if (data.status === "completed" || data.status === "failed") {
                    clearInterval(interval);
                    setGenerations((prev) =>
                        prev.map((g) =>
                            g.taskId === taskId
                                ? { ...g, status: data.status, videoUrl: data.videoUrl ?? null, error: data.error ?? null }
                                : g
                        )
                    );
                }
            } catch { /* keep polling */ }
        }, 5000);
    }, []);

    useEffect(() => {
        try {
            const saved = localStorage.getItem("kessler-home-generations");
            if (!saved) return;
            const parsed: Generation[] = JSON.parse(saved);
            setGenerations(parsed);
            for (const gen of parsed) {
                if (gen.status === "processing" && !gen.taskId.startsWith("err-") && !gen.taskId.startsWith("net-")) {
                    pollStatus(gen.taskId);
                }
            }
        } catch { /* ignore */ }
    }, [pollStatus]);

    useEffect(() => {
        localStorage.setItem("kessler-home-generations", JSON.stringify(generations));
    }, [generations]);

    const handleSubjectSelect = async (file: File) => {
        const localUrl = URL.createObjectURL(file);
        setSubjectPreviewUrl(localUrl);
        setSubjectPublicUrl(null);
        setIsUploadingSubject(true);
        try {
            const form = new FormData();
            form.append("file", file);
            const res = await fetch("/api/subject/upload", { method: "POST", body: form });
            if (!res.ok) throw new Error("upload failed");
            const { url } = await res.json();
            setSubjectPublicUrl(url);
        } catch {
            URL.revokeObjectURL(localUrl);
            setSubjectPreviewUrl(null);
        } finally {
            setIsUploadingSubject(false);
        }
    };

    const removeSubject = () => {
        if (subjectPreviewUrl) URL.revokeObjectURL(subjectPreviewUrl);
        setSubjectPreviewUrl(null);
        setSubjectPublicUrl(null);
    };

    const handleGenerate = async () => {
        if (!prompt.trim() || isGenerating) return;
        setIsGenerating(true);
        try {
            const res = await fetch("/api/home/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    prompt: prompt.trim(),
                    subjectImageUrl: subjectPublicUrl ?? undefined,
                    aspectRatio,
                    resolution,
                    duration,
                }),
            });
            const data = await res.json();
            if (!res.ok || !data.taskId) {
                setGenerations((prev) => [
                    { taskId: "err-" + Date.now(), prompt: prompt.trim(), aspectRatio, status: "failed", videoUrl: null, error: data.error ?? "Generation failed" },
                    ...prev,
                ]);
                return;
            }
            const gen: Generation = {
                taskId: data.taskId,
                prompt: prompt.trim(),
                aspectRatio,
                status: "processing",
                videoUrl: null,
                error: null,
            };
            setGenerations((prev) => [gen, ...prev]);
            pollStatus(data.taskId);
            setPrompt("");
        } catch {
            setGenerations((prev) => [
                { taskId: "net-" + Date.now(), prompt: prompt.trim(), aspectRatio, status: "failed", videoUrl: null, error: "Network error" },
                ...prev,
            ]);
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="mx-auto max-w-3xl px-6 py-20">

            {/* Header */}
            <div className="mb-10">
                <p className="text-[10px] tracking-widest uppercase text-[var(--text-muted)] mb-1">
                    Replicate · Seedance 2.0
                </p>
                <h1 className="text-sm font-semibold tracking-wide">Environment Generation</h1>
                <p className="mt-2 text-xs text-[var(--text-muted)] leading-relaxed max-w-lg">
                    Describe the scene and action. How is the camera moving? What is happening inside the landscape? If you upload a subject, what is it doing?

                </p>
            </div>

            {/* Environment references strip 
            <div className="mb-10">
                <p className="text-[10px] tracking-widest uppercase text-[var(--text-muted)] mb-3">
                    Environment references
                </p>
                <div className="flex gap-2 overflow-x-auto pb-1">
                    {REFERENCE_IMAGES.map(({ file, label }) => (
                        <div key={file} className="shrink-0 w-20">
                            <div className="w-20 h-20 rounded-lg overflow-hidden border border-[var(--border)] bg-[var(--bg-card)]">
                                <img src={`/references/${file}`} alt={label} className="w-full h-full object-cover" />
                            </div>
                            <p className="mt-1 text-center text-[9px] text-[var(--text-muted)] tracking-wide">{label}</p>
                        </div>
                    ))}
                </div>
            </div>

            */}

            {/* Subject upload */}
            <div className="mb-8">
                <p className="text-[10px] tracking-widest uppercase text-[var(--text-muted)] mb-3">
                    Subject image (optional)
                </p>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleSubjectSelect(f);
                        e.target.value = "";
                    }}
                />
                {!subjectPreviewUrl ? (
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="flex h-24 w-full items-center justify-center rounded-xl border border-dashed border-[var(--border-hover)] text-xs text-[var(--text-muted)] transition-colors hover:border-black hover:text-[var(--text)]"
                    >
                        Click to upload subject
                    </button>
                ) : (
                    <div className="flex items-center gap-4 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-3">
                        <div className="relative shrink-0">
                            <img src={subjectPreviewUrl} alt="subject" className="h-16 w-16 rounded-lg object-cover" />
                            {isUploadingSubject && (
                                <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40">
                                    <Spinner className="h-4 w-4 text-white" />
                                </div>
                            )}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-[10px] tracking-widest uppercase text-[var(--text-muted)]">Subject</p>
                            <p className="text-xs text-[var(--text)] mt-0.5">
                                {isUploadingSubject ? "Uploading…" : subjectPublicUrl ? "Ready" : "Upload failed"}
                            </p>
                        </div>
                        <button onClick={removeSubject} className="shrink-0 rounded-md p-1 text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                )}
            </div>

            {/* Prompt + controls */}
            <div className="mb-16">
                <div className={`rounded-2xl border bg-[var(--bg-elevated)] transition-colors ${prompt ? "border-[var(--border-hover)]" : "border-[var(--border)]"}`}>
                    <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="e.g. vast volcanic landscape with rivers flowing through and pillars extruding through a foreground of trees, slow panning camera."
                        rows={4}
                        className="w-full resize-none bg-transparent px-5 pt-5 pb-3 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none leading-relaxed"
                        onKeyDown={(e) => { if (e.key === "Enter" && e.metaKey) handleGenerate(); }}
                    />

                    <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-4">
                        <div className="flex flex-wrap items-center gap-2">

                            {/* Duration */}
                            <div className="flex items-center rounded-lg border border-[var(--border)] overflow-hidden">
                                {DURATIONS.map((d) => (
                                    <button
                                        key={d}
                                        onClick={() => setDuration(d)}
                                        className={`px-2.5 py-1.5 text-xs transition-colors ${duration === d
                                                ? "bg-black text-white"
                                                : "text-[var(--text-muted)] hover:text-[var(--text)]"
                                            }`}
                                    >
                                        {d}s
                                    </button>
                                ))}
                            </div>

                            {/* Aspect ratio */}
                            <select
                                value={aspectRatio}
                                onChange={(e) => setAspectRatio(e.target.value as AspectRatioValue)}
                                className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-1.5 text-xs text-[var(--text-muted)] cursor-pointer focus:outline-none hover:text-[var(--text)]"
                            >
                                {ASPECT_RATIOS.map(({ label, sublabel, value }) => (
                                    <option key={value} value={value}>{label} — {sublabel}</option>
                                ))}
                            </select>

                            {/* Resolution */}
                            <div className="flex items-center rounded-lg border border-[var(--border)] overflow-hidden">
                                {RESOLUTIONS.map((r) => (
                                    <button
                                        key={r}
                                        onClick={() => setResolution(r)}
                                        className={`px-3 py-1.5 text-xs transition-colors ${resolution === r
                                                ? "bg-black text-white"
                                                : "text-[var(--text-muted)] hover:text-[var(--text)]"
                                            }`}
                                    >
                                        {r}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            <span className="text-xs text-[var(--text-muted)] tabular-nums">
                                {COST[resolution][duration]}
                            </span>
                            <button
                                onClick={handleGenerate}
                                disabled={!prompt.trim() || isGenerating || isUploadingSubject}
                                className="rounded-lg bg-black px-5 py-2 text-xs font-semibold text-white tracking-wide transition-opacity hover:opacity-70 disabled:opacity-20 disabled:cursor-not-allowed"
                            >
                                {isGenerating ? (
                                    <span className="flex items-center gap-2">
                                        <Spinner className="h-3.5 w-3.5" />
                                        Sending
                                    </span>
                                ) : "Generate ⌘↵"}
                            </button>
                        </div>
                    </div>
                </div>
            </div>


            {/* Generations */}
            {generations.length > 0 && (
                <div className="space-y-px">
                    {generations.map((gen) => (
                        <div key={gen.taskId} className="animate-fade-in border-b border-[var(--border)] py-8 first:border-t-0">
                            <p className="text-xs text-[var(--text-muted)] mb-5 leading-relaxed">
                                &ldquo;{gen.prompt}&rdquo;
                            </p>

                            {gen.status === "processing" && (
                                <div
                                    className="w-full rounded-xl bg-black/5 flex flex-col items-center justify-center gap-3"
                                    style={{ aspectRatio: gen.aspectRatio.replace(":", "/") }}
                                >
                                    <Spinner className="h-4 w-4 text-[var(--text-muted)]" />
                                    <span className="text-xs text-[var(--text-muted)]">Generating — this may take a few minutes…</span>
                                </div>
                            )}

                            {gen.status === "completed" && gen.videoUrl && (
                                <video src={gen.videoUrl} controls autoPlay loop muted className="w-full rounded-xl bg-black" />
                            )}

                            {gen.status === "failed" && (
                                <p className="text-xs text-[var(--text-muted)] border border-[var(--border)] rounded-lg px-4 py-3">
                                    {gen.error || "Generation failed"}
                                </p>
                            )}

                            <div className="mt-4 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${gen.status === "completed" ? "bg-black" :
                                            gen.status === "failed" ? "bg-[var(--danger)]" : "bg-black/30"
                                        }`} />
                                    <span className="text-[10px] tracking-widest uppercase text-[var(--text-muted)]">{gen.status}</span>
                                </div>
                                {gen.status === "completed" && gen.videoUrl && (
                                    <a
                                        href={gen.videoUrl}
                                        download
                                        className="flex items-center gap-1.5 rounded-lg bg-black px-3 py-2 text-xs font-medium text-white transition-opacity hover:opacity-70"
                                    >
                                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0 0l-4-4m4 4l4-4" />
                                        </svg>
                                        Download
                                    </a>
                                )}
                            </div>
                        </div>
                    ))}

                    <p className="mt-2 text-xs text-[var(--text-muted)] leading-relaxed max-w-lg">
                        Make sure to download everything you generate, as the storage gets cleared periodically.
                    </p>
                </div>


            )}
        </div>
    );
}
