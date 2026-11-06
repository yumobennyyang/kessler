"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { makeRefTokenRegex } from "@/lib/refTokens";

const REF_COUNT = 30;
const MAX_SLOTS = 9;

const ASPECT_RATIOS = [
    { label: "16:9", sublabel: "Landscape", value: "16:9" },
    { label: "9:16", sublabel: "Portrait", value: "9:16" },
    { label: "1:1", sublabel: "Square", value: "1:1" },
    { label: "4:3", sublabel: "Classic", value: "4:3" },
    { label: "3:4", sublabel: "Tall", value: "3:4" },
    { label: "21:9", sublabel: "Ultrawide", value: "21:9" },
] as const;

type AspectRatioValue = typeof ASPECT_RATIOS[number]["value"];

const RESOLUTIONS = ["720p", "1080p", "4k"] as const;
type ResolutionValue = typeof RESOLUTIONS[number];

const DURATIONS = [5, 8, 10, 15] as const;
type DurationValue = typeof DURATIONS[number];

const COST: Record<ResolutionValue, Record<DurationValue, string>> = {
    "720p": { 5: "$0.90", 8: "$1.44", 10: "$1.80", 15: "$2.70" },
    "1080p": { 5: "$2.25", 8: "$3.60", 10: "$4.50", 15: "$6.75" },
    "4k": { 5: "$5.00", 8: "$8.00", 10: "$10.00", 15: "$15.00" },
};

const MAX_SUBJECT_PHOTOS = 6; // must match MAX_FILES in /api/subject/upload

const PHOTO_MAX_EDGE = 1280;
const PHOTO_MAX_BYTES = 500_000;

async function compressSubjectPhoto(file: File): Promise<File> {
    try {
        const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
        const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
        if (scale === 1 && file.size <= PHOTO_MAX_BYTES) {
            bitmap.close();
            return file;
        }
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            bitmap.close();
            return file;
        }
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        const blob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, "image/jpeg", 0.82)
        );
        if (!blob || blob.size >= file.size) return file;
        return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
    } catch {
        return file;
    }
}

interface Generation {
    taskId: string;
    prompt: string;
    refNumbers: number[];
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

function NumberChip({ children, className = "" }: { children: React.ReactNode; className?: string }) {
    return (
        <span className={`rounded-[4px] bg-black px-[3px] -mx-[3px] text-white ${className}`}>
            {children}
        </span>
    );
}

// Renders the prompt text with selected reference numbers as black chips.
// Character widths must exactly match the transparent textarea above it, so
// chips add background only — padding is cancelled out by negative margins.
function HighlightedPrompt({ text, selected }: { text: string; selected: Set<number> }) {
    const nodes: React.ReactNode[] = [];
    const re = makeRefTokenRegex();
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const num = parseInt(m[1], 10);
        if (!selected.has(num)) continue;
        if (m.index > last) nodes.push(text.slice(last, m.index));
        nodes.push(<NumberChip key={`${m.index}-${m[0]}`}>{m[0]}</NumberChip>);
        last = m.index + m[0].length;
    }
    nodes.push(text.slice(last));
    // A trailing newline collapses in a div but not in a textarea
    if (text.endsWith("\n")) nodes.push("​");
    return <>{nodes}</>;
}

export default function StudioPage() {
    const [prompt, setPrompt] = useState("");
    const [selected, setSelected] = useState<number[]>([]);
    const [aspectRatio, setAspectRatio] = useState<AspectRatioValue>("16:9");
    const [resolution, setResolution] = useState<ResolutionValue>("720p");
    const [duration, setDuration] = useState<DurationValue>(5);

    const [subjectFiles, setSubjectFiles] = useState<{ file: File; previewUrl: string }[]>([]);
    const [subjectPublicUrl, setSubjectPublicUrl] = useState<string | null>(null);
    const [isUploadingSubject, setIsUploadingSubject] = useState(false);
    const [subjectError, setSubjectError] = useState<string | null>(null);
    const [isDraggingSubject, setIsDraggingSubject] = useState(false);

    const [generations, setGenerations] = useState<Generation[]>([]);
    const [isGenerating, setIsGenerating] = useState(false);
    const [zoomed, setZoomed] = useState<number | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const uploadSeqRef = useRef(0);
    const dragDepthRef = useRef(0);
    const backdropRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const subjectActive = subjectFiles.length > 0;
    const usedSlots = selected.length + (subjectActive ? 1 : 0);
    const slotsFull = usedSlots >= MAX_SLOTS;
    const selectedSet = useMemo(() => new Set(selected), [selected]);

    // Numbers mentioned in the prompt but not selected — they'd read as plain text
    const unselectedMentions = useMemo(() => {
        const found = new Set<number>();
        const re = makeRefTokenRegex();
        let m: RegExpExecArray | null;
        while ((m = re.exec(prompt)) !== null) {
            const num = parseInt(m[1], 10);
            if (num >= 1 && num <= REF_COUNT && !selectedSet.has(num)) found.add(num);
        }
        return [...found].sort((a, b) => a - b);
    }, [prompt, selectedSet]);

    const toggleRef = (n: number) => {
        setSelected((prev) => {
            if (prev.includes(n)) return prev.filter((x) => x !== n);
            if (prev.length + (subjectActive ? 1 : 0) >= MAX_SLOTS) return prev;
            return [...prev, n];
        });
    };

    // Lightbox keyboard: Esc closes, arrows step through references
    useEffect(() => {
        if (zoomed === null) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setZoomed(null);
            else if (e.key === "ArrowRight") setZoomed((z) => (z === null ? z : (z % REF_COUNT) + 1));
            else if (e.key === "ArrowLeft") setZoomed((z) => (z === null ? z : ((z + REF_COUNT - 2) % REF_COUNT) + 1));
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [zoomed]);

    const syncScroll = () => {
        if (backdropRef.current && textareaRef.current) {
            backdropRef.current.scrollTop = textareaRef.current.scrollTop;
        }
    };

    const pollStatus = useCallback((taskId: string) => {
        let attempts = 0;
        const MAX = 360;
        const interval = setInterval(async () => {
            attempts++;
            if (attempts > MAX) {
                clearInterval(interval);
                setGenerations((prev) =>
                    prev.map((g) => (g.taskId === taskId ? { ...g, status: "failed", error: "Timed out" } : g))
                );
                return;
            }
            try {
                const res = await fetch(`/api/status?taskId=${encodeURIComponent(taskId)}`);
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
            const saved = localStorage.getItem("kessler-studio-generations");
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
        localStorage.setItem("kessler-studio-generations", JSON.stringify(generations));
    }, [generations]);

    const uploadSubjectSet = useCallback(async (files: File[]) => {
        const seq = ++uploadSeqRef.current;
        setSubjectPublicUrl(null);
        if (files.length === 0) {
            setIsUploadingSubject(false);
            return;
        }
        setIsUploadingSubject(true);
        try {
            const form = new FormData();
            files.forEach((f) => form.append("file", f));
            const res = await fetch("/api/subject/upload", { method: "POST", body: form });
            if (seq !== uploadSeqRef.current) return;
            if (!res.ok) throw new Error("upload failed");
            const { url } = await res.json();
            if (seq !== uploadSeqRef.current) return;
            setSubjectPublicUrl(url);
        } catch {
            if (seq !== uploadSeqRef.current) return;
            setSubjectError("Upload failed — remove a photo or try adding again.");
        } finally {
            if (seq === uploadSeqRef.current) setIsUploadingSubject(false);
        }
    }, []);

    const addSubjectFiles = async (incoming: File[]) => {
        const allowed = ["image/jpeg", "image/png", "image/webp"];
        const images = incoming.filter((f) => allowed.includes(f.type));
        if (images.length === 0) return;
        if (!subjectActive && selected.length >= MAX_SLOTS) {
            setSubjectError(`All ${MAX_SLOTS} slots are used by references — deselect one to add a subject.`);
            return;
        }
        const room = MAX_SUBJECT_PHOTOS - subjectFiles.length;
        if (room <= 0) {
            setSubjectError(`At most ${MAX_SUBJECT_PHOTOS} subject photos.`);
            return;
        }
        setSubjectError(
            images.length > room
                ? `At most ${MAX_SUBJECT_PHOTOS} subject photos — kept the first ${room} you added.`
                : null
        );
        setIsUploadingSubject(true);
        const compressed = await Promise.all(images.slice(0, room).map(compressSubjectPhoto));
        const next = [
            ...subjectFiles,
            ...compressed.map((file) => ({ file, previewUrl: URL.createObjectURL(file) })),
        ];
        setSubjectFiles(next);
        uploadSubjectSet(next.map((s) => s.file));
    };

    const removeSubjectFile = (previewUrl: string) => {
        setSubjectError(null);
        const removed = subjectFiles.find((s) => s.previewUrl === previewUrl);
        if (removed) URL.revokeObjectURL(removed.previewUrl);
        const next = subjectFiles.filter((s) => s.previewUrl !== previewUrl);
        setSubjectFiles(next);
        uploadSubjectSet(next.map((s) => s.file));
    };

    const clearSubjects = () => {
        uploadSeqRef.current++;
        subjectFiles.forEach((s) => URL.revokeObjectURL(s.previewUrl));
        setSubjectFiles([]);
        setSubjectPublicUrl(null);
        setIsUploadingSubject(false);
        setSubjectError(null);
    };

    const handleSubjectDrop = (e: React.DragEvent) => {
        e.preventDefault();
        dragDepthRef.current = 0;
        setIsDraggingSubject(false);
        addSubjectFiles(Array.from(e.dataTransfer.files ?? []));
    };

    const canGenerate = prompt.trim().length > 0 && usedSlots > 0 && !isGenerating && !isUploadingSubject;

    const handleGenerate = async () => {
        if (!canGenerate) return;
        setIsGenerating(true);
        try {
            const res = await fetch("/api/studio/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    prompt: prompt.trim(),
                    refNumbers: selected,
                    subjectImageUrl: subjectPublicUrl ?? undefined,
                    aspectRatio,
                    resolution,
                    duration,
                }),
            });
            const data = await res.json();
            if (!res.ok || !data.taskId) {
                setGenerations((prev) => [
                    { taskId: "err-" + Date.now(), prompt: prompt.trim(), refNumbers: [...selected], aspectRatio, status: "failed", videoUrl: null, error: data.error ?? "Generation failed" },
                    ...prev,
                ]);
                return;
            }
            const gen: Generation = {
                taskId: data.taskId,
                prompt: prompt.trim(),
                refNumbers: [...selected].sort((a, b) => a - b),
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
                { taskId: "net-" + Date.now(), prompt: prompt.trim(), refNumbers: [...selected], aspectRatio, status: "failed", videoUrl: null, error: "Network error" },
                ...prev,
            ]);
        } finally {
            setIsGenerating(false);
        }
    };

    // Typography here must exactly mirror the textarea for the chip overlay to align
    const promptTextClasses = "text-sm leading-relaxed whitespace-pre-wrap break-words";

    return (
        <div className="mx-auto max-w-4xl px-6 py-20">

            {/* Header */}
            <div className="mb-10">
                <p className="text-[10px] tracking-widest uppercase text-[var(--text-muted)] mb-1">
                    Replicate · Seedance 2.0 · Reference Library
                </p>
                <h1 className="text-sm font-semibold tracking-wide">Studio</h1>
                <p className="mt-2 text-xs text-[var(--text-muted)] leading-relaxed max-w-xl">
                    Pick up to {MAX_SLOTS} images ({MAX_SLOTS - 1} references + 1 uploaded subject, or {MAX_SLOTS} references).
                    Use a reference by mentioning its number in the prompt — as a texture (&ldquo;a mountain with texture 4&rdquo;)
                    or as an object placed in the world (&ldquo;a world full of 8 extruding from the ground&rdquo;).
                </p>
            </div>

            {/* Reference grid */}
            <div className="mb-10">
                <div className="mb-3 flex items-baseline justify-between">
                    <p className="text-[10px] tracking-widest uppercase text-[var(--text-muted)]">
                        References
                    </p>
                    <p className="text-[10px] tracking-widest uppercase tabular-nums text-[var(--text-muted)]">
                        <span className={usedSlots > 0 ? "text-[var(--text)] font-semibold" : ""}>{usedSlots}</span>
                        {" / "}{MAX_SLOTS} slots
                        {subjectActive && <span className="ml-1.5 normal-case tracking-normal">(1 = subject)</span>}
                    </p>
                </div>
                <div className="columns-2 gap-2 sm:columns-3 md:columns-4">
                    {Array.from({ length: REF_COUNT }, (_, i) => i + 1).map((n) => {
                        const isSelected = selectedSet.has(n);
                        const isDimmed = !isSelected && slotsFull;
                        return (
                            <div
                                key={n}
                                role="button"
                                tabIndex={0}
                                onClick={() => toggleRef(n)}
                                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleRef(n); } }}
                                aria-pressed={isSelected}
                                aria-label={`Reference ${n}`}
                                title={isDimmed ? `All ${MAX_SLOTS} slots used — deselect something first` : `Reference ${n}`}
                                className={`group relative mb-2 block break-inside-avoid overflow-hidden rounded-lg border transition-all ${
                                    isSelected
                                        ? "border-black ring-2 ring-black"
                                        : isDimmed
                                            ? "border-[var(--border)] cursor-not-allowed"
                                            : "border-[var(--border)] hover:border-black cursor-pointer"
                                }`}
                            >
                                <img
                                    src={`/references_2.0/thumbs/${n}.jpg`}
                                    alt={`Reference ${n}`}
                                    loading="lazy"
                                    className={`w-full h-auto transition-opacity ${isDimmed ? "opacity-25" : ""}`}
                                />
                                {/* Number badge */}
                                <span className={`absolute left-1.5 top-1.5 flex h-5 min-w-5 items-center justify-center rounded-[5px] px-1 text-[10px] font-semibold tabular-nums ${
                                    isSelected ? "bg-black text-white" : "bg-white/85 text-black backdrop-blur-sm"
                                } ${isDimmed ? "opacity-40" : ""}`}>
                                    {n}
                                </span>
                                {/* Check badge */}
                                {isSelected && (
                                    <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black text-white">
                                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                        </svg>
                                    </span>
                                )}
                                {/* Zoom — visible on hover, works even when the tile is dimmed */}
                                <button
                                    onClick={(e) => { e.stopPropagation(); setZoomed(n); }}
                                    aria-label={`View reference ${n} large`}
                                    title="View large"
                                    className="absolute bottom-1.5 right-1.5 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md bg-black/70 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-black group-hover:opacity-100 focus-visible:opacity-100"
                                >
                                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <circle cx="11" cy="11" r="7" />
                                        <path strokeLinecap="round" d="M21 21l-4.35-4.35M11 8v6M8 11h6" />
                                    </svg>
                                </button>
                            </div>
                        );
                    })}
                </div>
                {selected.length > 0 && (
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-[var(--text-muted)]">Selected:</span>
                        {[...selected].sort((a, b) => a - b).map((n) => (
                            <button
                                key={n}
                                onClick={() => toggleRef(n)}
                                title={`Deselect ${n}`}
                                className="flex h-5 min-w-5 items-center justify-center rounded-[5px] bg-black px-1 text-[10px] font-semibold tabular-nums text-white transition-opacity hover:opacity-60"
                            >
                                {n}
                            </button>
                        ))}
                        <span className="text-xs text-[var(--text-muted)]">— mention a number in the prompt to use it</span>
                    </div>
                )}
            </div>

            {/* Subject upload */}
            <div className="mb-8">
                <p className="text-[10px] tracking-widest uppercase text-[var(--text-muted)] mb-3">
                    Subject image (optional — takes 1 slot)
                </p>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                        addSubjectFiles(Array.from(e.target.files ?? []));
                        e.target.value = "";
                    }}
                />
                <div
                    onDragEnter={(e) => {
                        e.preventDefault();
                        dragDepthRef.current++;
                        setIsDraggingSubject(true);
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDragLeave={(e) => {
                        e.preventDefault();
                        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
                        if (dragDepthRef.current === 0) setIsDraggingSubject(false);
                    }}
                    onDrop={handleSubjectDrop}
                >
                    {subjectFiles.length === 0 ? (
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className={`flex h-24 w-full items-center justify-center rounded-xl border border-dashed text-xs transition-colors ${isDraggingSubject
                                    ? "border-black bg-black/5 text-[var(--text)]"
                                    : "border-[var(--border-hover)] text-[var(--text-muted)] hover:border-black hover:text-[var(--text)]"
                                }`}
                        >
                            {isDraggingSubject ? "Drop photos here" : "Click or drag & drop subject photos — add more anytime"}
                        </button>
                    ) : (
                        <div className={`rounded-xl border bg-[var(--bg-elevated)] px-4 py-3 transition-colors ${isDraggingSubject ? "border-black" : "border-[var(--border)]"}`}>
                            <div className="flex flex-wrap items-center gap-1.5">
                                {subjectFiles.map(({ previewUrl }) => (
                                    <div key={previewUrl} className="group relative shrink-0">
                                        <img src={previewUrl} alt="subject" className="h-16 w-16 rounded-lg object-cover" />
                                        <button
                                            onClick={() => removeSubjectFile(previewUrl)}
                                            aria-label="Remove photo"
                                            className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black text-white opacity-0 transition-opacity group-hover:opacity-100"
                                        >
                                            <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        </button>
                                    </div>
                                ))}
                                {subjectFiles.length < MAX_SUBJECT_PHOTOS && (
                                    <button
                                        onClick={() => fileInputRef.current?.click()}
                                        aria-label="Add more photos"
                                        className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-[var(--border-hover)] text-[var(--text-muted)] transition-colors hover:border-black hover:text-[var(--text)]"
                                    >
                                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
                                        </svg>
                                    </button>
                                )}
                                <div className="ml-auto flex items-center gap-3 pl-3">
                                    <div className="text-right">
                                        <p className="text-[10px] tracking-widest uppercase text-[var(--text-muted)]">
                                            {subjectFiles.length} photo{subjectFiles.length > 1 ? "s" : ""}
                                        </p>
                                        <p className="text-xs text-[var(--text)] mt-0.5 flex items-center justify-end gap-1.5">
                                            {isUploadingSubject && <Spinner className="h-3 w-3" />}
                                            {isUploadingSubject ? "Uploading…" : subjectPublicUrl ? "Ready" : "Not uploaded"}
                                        </p>
                                    </div>
                                    <button onClick={clearSubjects} aria-label="Remove all photos" className="shrink-0 rounded-md p-1 text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
                                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
                {subjectError && (
                    <p className="mt-2 text-xs text-[var(--danger)]">{subjectError}</p>
                )}
            </div>

            {/* Prompt + controls */}
            <div className="mb-16">
                <div className={`rounded-2xl border bg-[var(--bg-elevated)] transition-colors ${prompt ? "border-[var(--border-hover)]" : "border-[var(--border)]"}`}>
                    {/* Overlay editor: highlighted backdrop + transparent-text textarea */}
                    <div className="relative">
                        <div
                            ref={backdropRef}
                            aria-hidden
                            className={`pointer-events-none absolute inset-0 overflow-hidden px-5 pt-5 pb-3 text-[var(--text)] ${promptTextClasses}`}
                        >
                            <HighlightedPrompt text={prompt} selected={selectedSet} />
                        </div>
                        <textarea
                            ref={textareaRef}
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            onScroll={syncScroll}
                            placeholder="e.g. a vast valley where a mountain with texture 4 rises over a river, the ground covered in 12, towers of 8 extruding from the earth."
                            rows={4}
                            spellCheck={false}
                            className={`relative w-full resize-none bg-transparent px-5 pt-5 pb-3 text-transparent caret-black placeholder:text-[var(--text-muted)] focus:outline-none ${promptTextClasses}`}
                            onKeyDown={(e) => { if (e.key === "Enter" && e.metaKey) handleGenerate(); }}
                        />
                    </div>

                    {unselectedMentions.length > 0 && (
                        <p className="px-5 pb-2 -mt-1 text-xs text-[var(--text-muted)]">
                            {unselectedMentions.join(", ")} {unselectedMentions.length > 1 ? "aren't" : "isn't"} selected above — plain text for now; select {unselectedMentions.length > 1 ? "them" : "it"} in the grid to send {unselectedMentions.length > 1 ? "those images" : "that image"} along.
                        </p>
                    )}

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
                                disabled={!canGenerate}
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
                {usedSlots === 0 && (
                    <p className="mt-2 text-xs text-[var(--text-muted)]">
                        Select at least one reference (or add a subject) to generate.
                    </p>
                )}
            </div>

            {/* Generations */}
            {generations.length > 0 && (
                <div className="space-y-px">
                    {generations.map((gen) => (
                        <div key={gen.taskId} className="animate-fade-in border-b border-[var(--border)] py-8 first:border-t-0">
                            <div className="mb-5 flex flex-wrap items-center gap-2">
                                {gen.refNumbers?.length > 0 && (
                                    <span className="flex items-center gap-1">
                                        {gen.refNumbers.map((n) => (
                                            <span key={n} className="flex h-4 min-w-4 items-center justify-center rounded-[4px] bg-black px-1 text-[9px] font-semibold tabular-nums text-white">
                                                {n}
                                            </span>
                                        ))}
                                    </span>
                                )}
                                <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                                    &ldquo;{gen.prompt}&rdquo;
                                </p>
                            </div>

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
                                        href={`/api/download?url=${encodeURIComponent(gen.videoUrl)}`}
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

            {/* Lightbox */}
            {zoomed !== null && (
                <div
                    className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-6 animate-fade-in"
                    onClick={() => setZoomed(null)}
                >
                    <div className="relative flex max-h-full flex-col items-center" onClick={(e) => e.stopPropagation()}>
                        <img
                            src={`/references_2.0/large/${zoomed}.jpg`}
                            alt={`Reference ${zoomed}`}
                            className="max-h-[82vh] w-auto max-w-[88vw] rounded-xl"
                        />
                        <div className="mt-4 flex items-center gap-3">
                            <span className="flex h-6 min-w-6 items-center justify-center rounded-[5px] bg-white px-1.5 text-xs font-semibold tabular-nums text-black">
                                {zoomed}
                            </span>
                            <button
                                onClick={() => toggleRef(zoomed)}
                                disabled={!selectedSet.has(zoomed) && slotsFull}
                                className={`rounded-lg px-4 py-1.5 text-xs font-semibold transition-opacity ${
                                    selectedSet.has(zoomed)
                                        ? "bg-white text-black hover:opacity-70"
                                        : slotsFull
                                            ? "bg-white/20 text-white/40 cursor-not-allowed"
                                            : "bg-white text-black hover:opacity-70"
                                }`}
                            >
                                {selectedSet.has(zoomed) ? "✓ Selected — remove" : slotsFull ? "All slots used" : "Select"}
                            </button>
                            <span className="text-xs text-white/50">← → to browse · Esc to close</span>
                        </div>
                    </div>

                    {/* Prev / next */}
                    <button
                        onClick={(e) => { e.stopPropagation(); setZoomed(((zoomed + REF_COUNT - 2) % REF_COUNT) + 1); }}
                        aria-label="Previous reference"
                        className="absolute left-4 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/25"
                    >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); setZoomed((zoomed % REF_COUNT) + 1); }}
                        aria-label="Next reference"
                        className="absolute right-4 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/25"
                    >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                    </button>
                    <button
                        onClick={() => setZoomed(null)}
                        aria-label="Close"
                        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/25"
                    >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            )}
        </div>
    );
}
