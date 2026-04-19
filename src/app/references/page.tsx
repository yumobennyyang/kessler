"use client";

import { useState, useEffect, useRef } from "react";
import type { Reference } from "@/lib/db";

export default function ReferencesPage() {
    const [references, setReferences] = useState<Reference[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editLabel, setEditLabel] = useState("");
    const [dragOver, setDragOver] = useState(false);
    const [uploadLabel, setUploadLabel] = useState("");
    const fileInputRef = useRef<HTMLInputElement>(null);

    const fetchReferences = async () => {
        try {
            const res = await fetch("/api/references");
            const data = await res.json();
            setReferences(data);
        } catch {
            // ignore
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchReferences();
    }, []);

    const uploadFile = async (file: File, label: string) => {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("label", label || file.name.replace(/\.[^.]+$/, ""));

        const res = await fetch("/api/references/upload", {
            method: "POST",
            body: formData,
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "Upload failed");
        }

        return res.json();
    };

    const handleFileSelect = async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        setUploading(true);

        try {
            for (const file of Array.from(files)) {
                const label = uploadLabel.trim() || file.name.replace(/\.[^.]+$/, "");
                await uploadFile(file, label);
            }
            setUploadLabel("");
            await fetchReferences();
        } catch (err) {
            alert(err instanceof Error ? err.message : "Upload failed");
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        await handleFileSelect(e.dataTransfer.files);
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Delete this reference image?")) return;
        await fetch("/api/references", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id }),
        });
        setReferences((prev) => prev.filter((r) => r.id !== id));
    };

    const handleEditSave = async (id: string) => {
        if (!editLabel.trim()) return;
        const res = await fetch("/api/references", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, label: editLabel.trim() }),
        });
        if (res.ok) {
            const updated = await res.json();
            setReferences((prev) =>
                prev.map((r) => (r.id === id ? updated : r))
            );
        }
        setEditingId(null);
        setEditLabel("");
    };

    const startEdit = (ref: Reference) => {
        setEditingId(ref.id);
        setEditLabel(ref.label);
    };

    return (
        <div className="mx-auto max-w-6xl px-6 py-12">
            <div className="mb-10">
                <h1 className="text-4xl font-bold tracking-tight mb-2">
                    Reference <span className="text-[var(--accent)]">Library</span>
                </h1>
                <p className="text-[var(--text-muted)]">
                    Upload reference images and label them to define your visual language.
                    These will guide the AI when generating videos.
                </p>
            </div>

            {/* Upload section */}
            <div className="mb-10">
                <div className="flex items-end gap-3 mb-4">
                    <div className="flex-1">
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5 uppercase tracking-wider">
                            Label for upload
                        </label>
                        <input
                            type="text"
                            value={uploadLabel}
                            onChange={(e) => setUploadLabel(e.target.value)}
                            placeholder="e.g. Neon cyberpunk city"
                            className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]/50"
                        />
                    </div>
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        className="rounded-xl bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-black transition-all hover:bg-[var(--accent-dim)] disabled:opacity-40"
                    >
                        {uploading ? "Uploading…" : "Choose Files"}
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        multiple
                        className="hidden"
                        onChange={(e) => handleFileSelect(e.target.files)}
                    />
                </div>

                {/* Drop zone */}
                <div
                    onDragOver={(e) => {
                        e.preventDefault();
                        setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    className={`flex min-h-[160px] cursor-pointer items-center justify-center rounded-2xl border-2 border-dashed transition-colors ${dragOver
                            ? "border-[var(--accent)] bg-[var(--accent)]/5"
                            : "border-[var(--border)] hover:border-[var(--border-hover)]"
                        }`}
                    onClick={() => fileInputRef.current?.click()}
                >
                    <div className="text-center px-6 py-8">
                        <svg
                            className="mx-auto mb-3 h-10 w-10 text-[var(--text-muted)]"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={1.5}
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z"
                            />
                        </svg>
                        <p className="text-sm text-[var(--text-muted)]">
                            <span className="font-medium text-[var(--text)]">
                                Drop images here
                            </span>{" "}
                            or click to browse
                        </p>
                        <p className="mt-1 text-xs text-[var(--text-muted)]">
                            JPEG, PNG, WebP, GIF — max 10MB each
                        </p>
                    </div>
                </div>
            </div>

            {/* Gallery */}
            {loading ? (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                    {Array.from({ length: 8 }).map((_, i) => (
                        <div
                            key={i}
                            className="skeleton aspect-square rounded-2xl"
                        />
                    ))}
                </div>
            ) : references.length === 0 ? (
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-12 text-center">
                    <svg
                        className="mx-auto mb-4 h-12 w-12 text-[var(--text-muted)]"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={1}
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z"
                        />
                    </svg>
                    <p className="text-lg font-medium text-[var(--text)]">
                        No references yet
                    </p>
                    <p className="mt-1 text-sm text-[var(--text-muted)]">
                        Upload your first reference image to get started
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                    {references.map((ref) => (
                        <div
                            key={ref.id}
                            className="animate-fade-in group relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] transition-all hover:border-[var(--border-hover)]"
                        >
                            <div className="aspect-square overflow-hidden">
                                <img
                                    src={`/uploads/${ref.filename}`}
                                    alt={ref.label}
                                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                                />
                            </div>

                            {/* Overlay on hover */}
                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

                            {/* Action buttons */}
                            <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                    onClick={() => startEdit(ref)}
                                    className="rounded-lg bg-black/60 backdrop-blur-sm p-1.5 text-white hover:bg-black/80 transition-colors"
                                    title="Edit label"
                                >
                                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                                    </svg>
                                </button>
                                <button
                                    onClick={() => handleDelete(ref.id)}
                                    className="rounded-lg bg-black/60 backdrop-blur-sm p-1.5 text-red-400 hover:bg-red-500/20 transition-colors"
                                    title="Delete"
                                >
                                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                                    </svg>
                                </button>
                            </div>

                            {/* Label */}
                            <div className="p-3">
                                {editingId === ref.id ? (
                                    <div className="flex gap-1.5">
                                        <input
                                            type="text"
                                            value={editLabel}
                                            onChange={(e) => setEditLabel(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") handleEditSave(ref.id);
                                                if (e.key === "Escape") setEditingId(null);
                                            }}
                                            autoFocus
                                            className="flex-1 rounded-lg border border-[var(--accent)]/50 bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[var(--text)] focus:outline-none"
                                        />
                                        <button
                                            onClick={() => handleEditSave(ref.id)}
                                            className="rounded-lg bg-[var(--accent)] px-2 py-1 text-xs font-medium text-black"
                                        >
                                            Save
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <p className="text-sm font-medium text-[var(--text)] line-clamp-1">
                                            {ref.label}
                                        </p>
                                        <p className="text-xs text-[var(--text-muted)] mt-0.5">
                                            {new Date(ref.createdAt).toLocaleDateString()}
                                        </p>
                                    </>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
