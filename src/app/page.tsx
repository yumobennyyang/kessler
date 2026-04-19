"use client";

import { useState, useEffect, useCallback } from "react";
import type { Reference } from "@/lib/db";

interface GenerationState {
    id: string;
    replicateId: string | null;
    prompt: string;
    status: "pending" | "processing" | "completed" | "failed";
    videoUrl: string | null;
    error: string | null;
}

export default function HomePage() {
    const [prompt, setPrompt] = useState("");
    const [references, setReferences] = useState<Reference[]>([]);
    const [selectedRefs, setSelectedRefs] = useState<string[]>([]);
    const [generations, setGenerations] = useState<GenerationState[]>([]);
    const [isGenerating, setIsGenerating] = useState(false);

    useEffect(() => {
        fetch("/api/references")
            .then((r) => r.json())
            .then(setReferences)
            .catch(() => { });
    }, []);

    const pollStatus = useCallback(
        (genId: string, repId: string) => {
            const interval = setInterval(async () => {
                try {
                    const res = await fetch(
                        `/api/generate/status?generationId=${encodeURIComponent(genId)}&replicateId=${encodeURIComponent(repId)}`
                    );
                    const data = await res.json();
                    if (data.status === "completed" || data.status === "failed") {
                        clearInterval(interval);
                        setGenerations((prev) =>
                            prev.map((g) =>
                                g.id === genId
                                    ? {
                                        ...g,
                                        status: data.status,
                                        videoUrl: data.videoUrl || null,
                                        error: data.error || null,
                                    }
                                    : g
                            )
                        );
                    }
                } catch {
                    // keep polling
                }
            }, 5000);
            return () => clearInterval(interval);
        },
        []
    );

    const handleGenerate = async () => {
        if (!prompt.trim() || isGenerating) return;
        setIsGenerating(true);

        try {
            const res = await fetch("/api/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    prompt: prompt.trim(),
                    referenceIds: selectedRefs,
                }),
            });

            const gen = await res.json();

            if (!res.ok) {
                setGenerations((prev) => [
                    {
                        id: gen.id || "error",
                        replicateId: null,
                        prompt: prompt.trim(),
                        status: "failed",
                        videoUrl: null,
                        error: gen.error || "Generation failed",
                    },
                    ...prev,
                ]);
            } else {
                const newGen: GenerationState = {
                    id: gen.id,
                    replicateId: gen.replicateId,
                    prompt: prompt.trim(),
                    status: gen.status,
                    videoUrl: null,
                    error: null,
                };
                setGenerations((prev) => [newGen, ...prev]);

                if (gen.replicateId) {
                    pollStatus(gen.id, gen.replicateId);
                }
            }

            setPrompt("");
        } catch {
            setGenerations((prev) => [
                {
                    id: "error-" + Date.now(),
                    replicateId: null,
                    prompt: prompt.trim(),
                    status: "failed",
                    videoUrl: null,
                    error: "Network error",
                },
                ...prev,
            ]);
        } finally {
            setIsGenerating(false);
        }
    };

    const toggleRef = (id: string) => {
        setSelectedRefs((prev) =>
            prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]
        );
    };

    return (
        <div className="mx-auto max-w-5xl px-6 py-12">
            {/* Hero */}
            <div className="mb-12 text-center">
                <h1 className="text-5xl font-bold tracking-tight mb-4">
                    Text to <span className="text-[var(--accent)]">Video</span>
                </h1>
                <p className="text-[var(--text-muted)] text-lg max-w-2xl mx-auto">
                    Describe your vision, select your style references, and let AI generate
                    cinematic video in your visual language.
                </p>
            </div>

            {/* Prompt Input */}
            <div className="relative mb-8">
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-1 transition-colors focus-within:border-[var(--accent)]/50">
                    <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="Describe the video you want to create..."
                        rows={4}
                        className="w-full resize-none bg-transparent px-5 py-4 text-base text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none"
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && e.metaKey) handleGenerate();
                        }}
                    />
                    <div className="flex items-center justify-between px-4 pb-3">
                        <span className="text-xs text-[var(--text-muted)]">
                            {selectedRefs.length > 0
                                ? `${selectedRefs.length} reference${selectedRefs.length > 1 ? "s" : ""} selected`
                                : "No style references selected"}
                        </span>
                        <button
                            onClick={handleGenerate}
                            disabled={!prompt.trim() || isGenerating}
                            className="rounded-xl bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-black transition-all hover:bg-[var(--accent-dim)] disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {isGenerating ? (
                                <span className="flex items-center gap-2">
                                    <svg
                                        className="h-4 w-4 animate-spin"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                    >
                                        <circle
                                            cx="12"
                                            cy="12"
                                            r="10"
                                            stroke="currentColor"
                                            strokeWidth="3"
                                            className="opacity-25"
                                        />
                                        <path
                                            d="M4 12a8 8 0 018-8"
                                            stroke="currentColor"
                                            strokeWidth="3"
                                            strokeLinecap="round"
                                        />
                                    </svg>
                                    Generating…
                                </span>
                            ) : (
                                <>Generate ⌘↵</>
                            )}
                        </button>
                    </div>
                </div>
            </div>

            {/* Reference selector */}
            {references.length > 0 && (
                <div className="mb-12">
                    <h3 className="text-sm font-medium text-[var(--text-muted)] mb-3 uppercase tracking-wider">
                        Style References
                    </h3>
                    <div className="flex flex-wrap gap-3">
                        {references.map((ref) => (
                            <button
                                key={ref.id}
                                onClick={() => toggleRef(ref.id)}
                                className={`group relative overflow-hidden rounded-xl border-2 transition-all ${selectedRefs.includes(ref.id)
                                        ? "border-[var(--accent)] ring-2 ring-[var(--accent)]/20"
                                        : "border-[var(--border)] hover:border-[var(--border-hover)]"
                                    }`}
                            >
                                <img
                                    src={`/uploads/${ref.filename}`}
                                    alt={ref.label}
                                    className="h-20 w-20 object-cover"
                                />
                                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-1.5 pb-1 pt-4">
                                    <span className="text-[10px] font-medium text-white leading-tight line-clamp-1">
                                        {ref.label}
                                    </span>
                                </div>
                                {selectedRefs.includes(ref.id) && (
                                    <div className="absolute top-1 right-1 h-5 w-5 rounded-full bg-[var(--accent)] flex items-center justify-center">
                                        <svg className="h-3 w-3 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                        </svg>
                                    </div>
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Generations */}
            {generations.length > 0 && (
                <div>
                    <h3 className="text-sm font-medium text-[var(--text-muted)] mb-4 uppercase tracking-wider">
                        Generations
                    </h3>
                    <div className="space-y-4">
                        {generations.map((gen) => (
                            <div
                                key={gen.id}
                                className="animate-fade-in rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6"
                            >
                                <p className="text-sm text-[var(--text-muted)] mb-3 italic">
                                    &ldquo;{gen.prompt}&rdquo;
                                </p>

                                {gen.status === "processing" && (
                                    <div className="animate-pulse-glow rounded-xl bg-[var(--bg-elevated)] border border-[var(--accent)]/20 p-8 flex flex-col items-center justify-center gap-3">
                                        <svg
                                            className="h-8 w-8 animate-spin text-[var(--accent)]"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                        >
                                            <circle
                                                cx="12"
                                                cy="12"
                                                r="10"
                                                stroke="currentColor"
                                                strokeWidth="2"
                                                className="opacity-25"
                                            />
                                            <path
                                                d="M4 12a8 8 0 018-8"
                                                stroke="currentColor"
                                                strokeWidth="2"
                                                strokeLinecap="round"
                                            />
                                        </svg>
                                        <span className="text-sm text-[var(--text-muted)]">
                                            Generating your video… this may take a few minutes
                                        </span>
                                    </div>
                                )}

                                {gen.status === "completed" && gen.videoUrl && (
                                    <video
                                        src={gen.videoUrl}
                                        controls
                                        className="w-full rounded-xl bg-black"
                                    />
                                )}

                                {gen.status === "failed" && (
                                    <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-4">
                                        <p className="text-sm text-red-400">
                                            {gen.error || "Generation failed"}
                                        </p>
                                    </div>
                                )}

                                <div className="mt-3 flex items-center gap-2">
                                    <span
                                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${gen.status === "completed"
                                                ? "bg-green-500/10 text-green-400"
                                                : gen.status === "failed"
                                                    ? "bg-red-500/10 text-red-400"
                                                    : "bg-yellow-500/10 text-yellow-400"
                                            }`}
                                    >
                                        {gen.status}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
