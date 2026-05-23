"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { Reference, TrainingJob } from "@/lib/db";

export default function ReferencesPage() {
    const [references, setReferences] = useState<Reference[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
    const [captions, setCaptions] = useState<Record<string, string>>({});
    const [savingId, setSavingId] = useState<string | null>(null);
    const [recaptioning, setRecaptioning] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const [trainingJob, setTrainingJob] = useState<TrainingJob | null>(null);
    const [startingTrain, setStartingTrain] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const fetchReferences = async () => {
        try {
            const res = await fetch("/api/references");
            const data: Reference[] = await res.json();
            setReferences(data);
            setCaptions((prev) => {
                const next = { ...prev };
                for (const r of data) {
                    if (!(r.id in next)) next[r.id] = r.caption;
                }
                return next;
            });
        } catch { /* ignore */ } finally {
            setLoading(false);
        }
    };

    const fetchTrainingJob = useCallback(async () => {
        try {
            const res = await fetch("/api/train");
            const data = await res.json();
            setTrainingJob(data);
            return data as TrainingJob | null;
        } catch { return null; }
    }, []);

    const pollTrainingStatus = useCallback(async (job: TrainingJob) => {
        if (!job.falRequestId) return;
        try {
            const res = await fetch(
                `/api/train/status?jobId=${job.id}&falRequestId=${encodeURIComponent(job.falRequestId)}`
            );
            const data = await res.json();
            setTrainingJob((prev) => prev ? { ...prev, ...data, id: prev.id } : prev);
            if (data.status === "completed" || data.status === "failed") {
                if (pollRef.current) clearInterval(pollRef.current);
            }
        } catch { /* keep polling */ }
    }, []);

    useEffect(() => {
        fetchReferences();
        fetchTrainingJob().then((job) => {
            if (job?.status === "training" && job.falRequestId) {
                pollRef.current = setInterval(() => pollTrainingStatus(job), 15000);
            }
        });
        return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }, [fetchTrainingJob, pollTrainingStatus]);

    const handleCaptionBlur = async (ref: Reference) => {
        const edited = captions[ref.id]?.trim();
        if (!edited || edited === ref.caption) return;
        setSavingId(ref.id);
        try {
            const res = await fetch("/api/references", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: ref.id, caption: edited }),
            });
            if (res.ok) {
                const updated: Reference = await res.json();
                setReferences((prev) => prev.map((r) => (r.id === ref.id ? updated : r)));
            }
        } catch { /* ignore */ }
        setSavingId(null);
    };

    const handleFileSelect = (files: FileList | null) => {
        if (!files || files.length === 0) return;
        const incoming = Array.from(files).filter(
            (f) => !pendingFiles.some((p) => p.name === f.name && p.size === f.size)
        );
        setPendingFiles((prev) => [...prev, ...incoming]);
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    const removePending = (index: number) => {
        setPendingFiles((prev) => prev.filter((_, i) => i !== index));
    };

    const handleUploadAll = async () => {
        if (pendingFiles.length === 0 || uploading) return;
        setUploading(true);
        setUploadProgress({ done: 0, total: pendingFiles.length });
        try {
            for (let i = 0; i < pendingFiles.length; i++) {
                const file = pendingFiles[i];
                const formData = new FormData();
                formData.append("file", file);
                const res = await fetch("/api/references/upload", { method: "POST", body: formData });
                if (!res.ok) {
                    const err = await res.json();
                    throw new Error(err.error || "Upload failed");
                }
                setUploadProgress({ done: i + 1, total: pendingFiles.length });
            }
            setPendingFiles([]);
            await fetchReferences();
        } catch (err) {
            alert(err instanceof Error ? err.message : "Upload failed");
        } finally {
            setUploading(false);
            setUploadProgress(null);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        handleFileSelect(e.dataTransfer.files);
    };

    const handleRecaptionAll = async () => {
        if (recaptioning) return;
        setRecaptioning(true);
        try {
            const res = await fetch("/api/references/caption", { method: "POST" });
            if (res.ok) await fetchReferences();
        } catch { /* ignore */ } finally {
            setRecaptioning(false);
        }
    };

    const handleDelete = async (id: string) => {
        const res = await fetch("/api/references", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id }),
        });
        if (res.ok) {
            setReferences((prev) => prev.filter((r) => r.id !== id));
            setCaptions((prev) => { const next = { ...prev }; delete next[id]; return next; });
        }
    };

    const handleTrain = async () => {
        if (startingTrain) return;
        setStartingTrain(true);
        try {
            const res = await fetch("/api/train", { method: "POST" });
            const job = await res.json();
            if (!res.ok) { alert(job.error || "Failed to start training"); return; }
            setTrainingJob(job);
            const poll = setInterval(async () => {
                const updated = await fetchTrainingJob();
                if (updated?.falRequestId && (updated.status === "training" || updated.status === "pending")) {
                    clearInterval(poll);
                    pollRef.current = setInterval(() => pollTrainingStatus(updated), 15000);
                }
                if (updated?.status === "completed" || updated?.status === "failed") {
                    clearInterval(poll);
                }
            }, 3000);
        } finally {
            setStartingTrain(false);
        }
    };

    const isTraining = trainingJob?.status === "training" || trainingJob?.status === "pending";

    return (
        <div className="mx-auto max-w-5xl px-6 py-16">

            {/* Header */}
            <div className="mb-12 border-b border-[var(--border)] pb-8">
                <h1 className="text-2xl font-semibold tracking-tight mb-1">Reference Library</h1>
                <p className="text-sm text-[var(--text-muted)]">
                    Upload sculpture reference images. Captions are auto-generated and used as training labels — click any caption to edit.
                </p>
            </div>

            {/* Train section */}
            <div className="mb-12 flex items-center justify-between">
                <div>
                    <p className="text-[10px] font-medium tracking-[0.15em] uppercase text-[var(--text-muted)] mb-0.5">
                        Model
                    </p>
                    {!trainingJob && (
                        <p className="text-sm text-[var(--text-muted)]">No model trained yet.</p>
                    )}
                    {trainingJob?.status === "pending" && (
                        <p className="text-sm text-[var(--text-muted)]">Preparing training data…</p>
                    )}
                    {trainingJob?.status === "training" && (
                        <div className="flex items-center gap-2">
                            <svg className="h-3.5 w-3.5 animate-spin text-[var(--text-muted)]" viewBox="0 0 24 24" fill="none">
                                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" className="opacity-20" />
                                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                            </svg>
                            <p className="text-sm text-[var(--text-muted)]">Training — this takes 1–2 hours.</p>
                        </div>
                    )}
                    {trainingJob?.status === "completed" && (
                        <p className="text-sm text-[var(--text)]">
                            Model ready
                            <span className="ml-2 text-[var(--text-muted)] text-xs">
                                — {trainingJob.referenceCount} images · {new Date(trainingJob.completedAt!).toLocaleDateString()}
                            </span>
                        </p>
                    )}
                    {trainingJob?.status === "failed" && (
                        <p className="text-sm text-[var(--text-muted)]">Training failed. {trainingJob.error}</p>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleRecaptionAll}
                        disabled={recaptioning || references.length === 0}
                        className="rounded-lg border border-[var(--border)] px-5 py-2.5 text-xs font-semibold text-[var(--text)] tracking-wide transition-opacity hover:opacity-70 disabled:opacity-20 disabled:cursor-not-allowed"
                    >
                        {recaptioning ? "Recaptioning…" : "Recaption All"}
                    </button>
                    <button
                        onClick={handleTrain}
                        disabled={isTraining || startingTrain || references.length < 4}
                        title={references.length < 4 ? "Upload at least 4 reference images to train" : undefined}
                        className="rounded-lg bg-black px-5 py-2.5 text-xs font-semibold text-white tracking-wide transition-opacity hover:opacity-70 disabled:opacity-20 disabled:cursor-not-allowed"
                    >
                        {isTraining || startingTrain ? "Training…" : trainingJob?.status === "completed" ? "Retrain" : "Train Model"}
                    </button>
                </div>
            </div>

            {/* Upload */}
            <div className="mb-16">
                <p className="text-[10px] font-medium tracking-[0.15em] uppercase text-[var(--text-muted)] mb-4">
                    Upload
                </p>

                <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    onClick={() => !uploading && fileInputRef.current?.click()}
                    className={`flex min-h-28 cursor-pointer items-center justify-center rounded-xl border border-dashed transition-colors mb-4 ${
                        dragOver ? "border-black/30 bg-black/[0.03]" : "border-[var(--border)] hover:border-[var(--border-hover)]"
                    } ${uploading ? "pointer-events-none" : ""}`}
                >
                    <div className="text-center py-8 px-6">
                        <svg className="mx-auto mb-2.5 h-6 w-6 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
                        </svg>
                        <p className="text-xs text-[var(--text-muted)]">
                            <span className="text-[var(--text)]">Drop images here</span> or click to browse
                        </p>
                        <p className="mt-1 text-[10px] text-[var(--text-muted)]">JPEG · PNG · WebP · GIF · Captions auto-generated</p>
                    </div>
                </div>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    multiple
                    className="hidden"
                    onChange={(e) => handleFileSelect(e.target.files)}
                />

                {pendingFiles.length > 0 && (
                    <div className="mb-4">
                        <p className="text-[10px] text-[var(--text-muted)] mb-2 tracking-wide">
                            {pendingFiles.length} image{pendingFiles.length !== 1 ? "s" : ""} queued
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                            {pendingFiles.map((file, i) => (
                                <div key={i} className="flex items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 py-1 text-[11px] text-[var(--text-muted)]">
                                    <span className="max-w-36 truncate">{file.name}</span>
                                    {!uploading && (
                                        <button onClick={() => removePending(i)} className="hover:text-[var(--text)] transition-colors">
                                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <button
                    onClick={handleUploadAll}
                    disabled={pendingFiles.length === 0 || uploading}
                    className="rounded-lg bg-black px-5 py-2.5 text-xs font-semibold text-white tracking-wide transition-opacity hover:opacity-70 disabled:opacity-20 disabled:cursor-not-allowed"
                >
                    {uploading && uploadProgress
                        ? `Uploading ${uploadProgress.done}/${uploadProgress.total}…`
                        : pendingFiles.length > 0
                            ? `Upload ${pendingFiles.length} Image${pendingFiles.length !== 1 ? "s" : ""}`
                            : "Select images to upload"}
                </button>
            </div>

            {/* Gallery */}
            {loading ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                    {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className="skeleton rounded-xl" style={{ aspectRatio: "3/4" }} />
                    ))}
                </div>
            ) : references.length === 0 ? (
                <div className="py-20 text-center border-t border-[var(--border)]">
                    <p className="text-sm text-[var(--text-muted)]">No references yet.</p>
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                    {references.map((ref) => (
                        <div
                            key={ref.id}
                            className="animate-fade-in rounded-xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden transition-colors hover:border-[var(--border-hover)]"
                        >
                            {/* Image with delete button */}
                            <div className="relative group aspect-square overflow-hidden">
                                <img
                                    src={`/uploads/${ref.filename}`}
                                    alt={ref.caption}
                                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                                />
                                {/* overlay is pointer-events-none so it never blocks the delete button */}
                                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                                <button
                                    onClick={() => handleDelete(ref.id)}
                                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity rounded-md bg-white/80 backdrop-blur-sm p-1.5 text-black/40 hover:text-black"
                                    title="Delete"
                                >
                                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                                    </svg>
                                </button>
                            </div>

                            {/* Always-editable caption */}
                            <div className="p-2.5">
                                <textarea
                                    value={captions[ref.id] ?? ref.caption}
                                    onChange={(e) =>
                                        setCaptions((prev) => ({ ...prev, [ref.id]: e.target.value }))
                                    }
                                    onBlur={() => handleCaptionBlur(ref)}
                                    rows={3}
                                    className="w-full resize-none bg-transparent text-[11px] text-[var(--text)] placeholder:text-[var(--text-muted)] leading-relaxed focus:outline-none"
                                />
                                {savingId === ref.id && (
                                    <p className="text-[10px] text-[var(--text-muted)] mt-0.5">Saving…</p>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
