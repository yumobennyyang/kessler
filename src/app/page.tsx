"use client";

import { useState, useEffect, useCallback } from "react";
import type { TrainingJob } from "@/lib/db";

interface GenerationState {
    id: string;
    falRequestId: string | null;
    prompt: string;
    status: "pending" | "processing" | "completed" | "failed";
    videoUrl: string | null;
    error: string | null;
}

export default function HomePage() {
    const [prompt, setPrompt] = useState("");
    const [videoLength, setVideoLength] = useState(129);
    const [generations, setGenerations] = useState<GenerationState[]>([]);
    const [isGenerating, setIsGenerating] = useState(false);
    const [trainingJob, setTrainingJob] = useState<TrainingJob | null | undefined>(undefined);

    useEffect(() => {
        fetch("/api/train")
            .then((r) => r.json())
            .then(setTrainingJob)
            .catch(() => setTrainingJob(null));
    }, []);

    const pollStatus = useCallback((genId: string, falRequestId: string) => {
        let attempts = 0;
        const MAX_ATTEMPTS = 90; // 90 × 10s = 15 min timeout
        const interval = setInterval(async () => {
            attempts++;
            if (attempts > MAX_ATTEMPTS) {
                clearInterval(interval);
                setGenerations((prev) =>
                    prev.map((g) => g.id === genId ? { ...g, status: "failed", error: "Timed out waiting for generation" } : g)
                );
                return;
            }
            try {
                const res = await fetch(
                    `/api/generate/status?generationId=${encodeURIComponent(genId)}&falRequestId=${encodeURIComponent(falRequestId)}`
                );
                const data = await res.json();
                if (data.status === "completed" || data.status === "failed") {
                    clearInterval(interval);
                    setGenerations((prev) =>
                        prev.map((g) =>
                            g.id === genId
                                ? { ...g, status: data.status, videoUrl: data.videoUrl || null, error: data.error || null }
                                : g
                        )
                    );
                }
            } catch { /* keep polling */ }
        }, 10000);
        return () => clearInterval(interval);
    }, []);

    const handleGenerate = async () => {
        if (!prompt.trim() || isGenerating) return;
        setIsGenerating(true);

        try {
            const res = await fetch("/api/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt: prompt.trim(), videoLength }),
            });

            const gen = await res.json();

            if (!res.ok) {
                setGenerations((prev) => [
                    { id: gen.id || "error", falRequestId: null, prompt: prompt.trim(), status: "failed", videoUrl: null, error: gen.error || "Generation failed" },
                    ...prev,
                ]);
            } else {
                const newGen: GenerationState = {
                    id: gen.id,
                    falRequestId: gen.falRequestId,
                    prompt: prompt.trim(),
                    status: "processing",
                    videoUrl: null,
                    error: null,
                };
                setGenerations((prev) => [newGen, ...prev]);

                // falRequestId is set async in background — poll DB until it appears or fails
                if (!gen.falRequestId) {
                    let waitAttempts = 0;
                    const wait = setInterval(async () => {
                        waitAttempts++;
                        if (waitAttempts > 20) { // 20 × 3s = 1 min max wait
                            clearInterval(wait);
                            setGenerations((prev) =>
                                prev.map((g) => g.id === gen.id ? { ...g, status: "failed", error: "Failed to start generation" } : g)
                            );
                            return;
                        }
                        try {
                            const r = await fetch("/api/generate");
                            const all = await r.json();
                            const found = all.find((g: GenerationState) => g.id === gen.id);
                            if (found?.falRequestId) {
                                clearInterval(wait);
                                setGenerations((prev) =>
                                    prev.map((g) => g.id === gen.id ? { ...g, falRequestId: found.falRequestId } : g)
                                );
                                pollStatus(gen.id, found.falRequestId);
                            } else if (found?.status === "failed") {
                                clearInterval(wait);
                                setGenerations((prev) =>
                                    prev.map((g) => g.id === gen.id ? { ...g, status: "failed", error: found.error || "Generation failed" } : g)
                                );
                            }
                        } catch { /* keep waiting */ }
                    }, 3000);
                } else {
                    pollStatus(gen.id, gen.falRequestId);
                }
            }

            setPrompt("");
        } catch {
            setGenerations((prev) => [
                { id: "error-" + Date.now(), falRequestId: null, prompt: prompt.trim(), status: "failed", videoUrl: null, error: "Network error" },
                ...prev,
            ]);
        } finally {
            setIsGenerating(false);
        }
    };

    const hasLoRA = trainingJob?.status === "completed";
    const isTraining = trainingJob?.status === "training" || trainingJob?.status === "pending";

    return (
        <div className="mx-auto max-w-3xl px-6 py-20">

            {/* Model status pill */}
            {trainingJob !== undefined && (
                <div className="mb-8 flex items-center gap-2">
                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${hasLoRA ? "bg-black" : isTraining ? "bg-black/40" : "bg-black/20"}`} />
                    <span className="text-[10px] tracking-widest uppercase text-[var(--text-muted)]">
                        {hasLoRA
                            ? "Custom model active"
                            : isTraining
                                ? "Model training… generation unavailable"
                                : "No model trained — go to References to train"}
                    </span>
                </div>
            )}

            {/* Prompt */}
            <div className="mb-16">
                <div className={`rounded-2xl border bg-[var(--bg-elevated)] transition-colors ${prompt ? "border-[var(--border-hover)]" : "border-[var(--border)]"}`}>
                    <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="Describe the video you want to create…"
                        rows={5}
                        className="w-full resize-none bg-transparent px-5 pt-5 pb-3 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none leading-relaxed"
                        onKeyDown={(e) => { if (e.key === "Enter" && e.metaKey) handleGenerate(); }}
                    />
                    <div className="flex items-center justify-between px-4 pb-4">
                        <div className="flex items-center gap-1">
                            {([
                                { frames: 129, label: "5s", cost: "~$0.30" },
                                { frames: 257, label: "10s", cost: "~$0.60" },
                            ] as const).map((opt) => (
                                <button
                                    key={opt.frames}
                                    onClick={() => setVideoLength(opt.frames)}
                                    className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
                                        videoLength === opt.frames
                                            ? "bg-black text-white"
                                            : "text-[var(--text-muted)] hover:text-[var(--text)]"
                                    }`}
                                >
                                    {opt.label}
                                    <span className="ml-1 opacity-50">{opt.cost}</span>
                                </button>
                            ))}
                        </div>
                        <button
                            onClick={handleGenerate}
                            disabled={!prompt.trim() || isGenerating || !hasLoRA}
                            className="rounded-lg bg-black px-5 py-2 text-xs font-semibold text-white tracking-wide transition-opacity hover:opacity-70 disabled:opacity-20 disabled:cursor-not-allowed"
                        >
                            {isGenerating ? (
                                <span className="flex items-center gap-2">
                                    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                                        <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                                    </svg>
                                    Generating
                                </span>
                            ) : "Generate ⌘↵"}
                        </button>
                    </div>
                </div>
            </div>

            {/* Generations */}
            {generations.length > 0 && (
                <div className="space-y-px">
                    {generations.map((gen) => (
                        <div key={gen.id} className="animate-fade-in border-t border-[var(--border)] py-8 first:border-t-0">
                            <p className="text-xs text-[var(--text-muted)] mb-5 leading-relaxed">
                                &ldquo;{gen.prompt}&rdquo;
                            </p>

                            {gen.status === "processing" && (
                                <div className="flex items-center gap-3 py-6">
                                    <svg className="h-4 w-4 animate-spin text-[var(--text-muted)]" viewBox="0 0 24 24" fill="none">
                                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" className="opacity-20" />
                                        <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                                    </svg>
                                    <span className="text-xs text-[var(--text-muted)]">Generating — this may take several minutes</span>
                                </div>
                            )}

                            {gen.status === "completed" && gen.videoUrl && (
                                <video src={gen.videoUrl} controls className="w-full rounded-xl bg-black" />
                            )}

                            {gen.status === "failed" && (
                                <p className="text-xs text-[var(--text-muted)] border border-[var(--border)] rounded-lg px-4 py-3">
                                    {gen.error || "Generation failed"}
                                </p>
                            )}

                            <div className="mt-4">
                                <span className="text-[10px] tracking-widest uppercase text-[var(--text-muted)]">
                                    {gen.status}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
