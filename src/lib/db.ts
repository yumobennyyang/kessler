import { promises as fs } from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

export interface Reference {
    id: string;
    label: string;
    filename: string;
    originalName: string;
    createdAt: string;
}

export interface Generation {
    id: string;
    prompt: string;
    referenceIds: string[];
    status: "pending" | "processing" | "completed" | "failed";
    videoUrl: string | null;
    replicateId: string | null;
    error: string | null;
    createdAt: string;
}

interface DB {
    references: Reference[];
    generations: Generation[];
}

const DB_PATH = path.join(process.cwd(), "data.json");

async function readDB(): Promise<DB> {
    try {
        const raw = await fs.readFile(DB_PATH, "utf-8");
        return JSON.parse(raw);
    } catch {
        return { references: [], generations: [] };
    }
}

async function writeDB(db: DB): Promise<void> {
    await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2));
}

// References
export async function getReferences(): Promise<Reference[]> {
    const db = await readDB();
    return db.references.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
}

export async function addReference(
    label: string,
    filename: string,
    originalName: string
): Promise<Reference> {
    const db = await readDB();
    const ref: Reference = {
        id: uuidv4(),
        label,
        filename,
        originalName,
        createdAt: new Date().toISOString(),
    };
    db.references.push(ref);
    await writeDB(db);
    return ref;
}

export async function updateReference(
    id: string,
    label: string
): Promise<Reference | null> {
    const db = await readDB();
    const ref = db.references.find((r) => r.id === id);
    if (!ref) return null;
    ref.label = label;
    await writeDB(db);
    return ref;
}

export async function deleteReference(id: string): Promise<boolean> {
    const db = await readDB();
    const idx = db.references.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    const ref = db.references[idx];
    db.references.splice(idx, 1);
    await writeDB(db);
    // Delete file
    const filePath = path.join(process.cwd(), "public", "uploads", ref.filename);
    try {
        await fs.unlink(filePath);
    } catch {
        // file may already be gone
    }
    return true;
}

// Generations
export async function getGenerations(): Promise<Generation[]> {
    const db = await readDB();
    return db.generations.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
}

export async function addGeneration(
    prompt: string,
    referenceIds: string[]
): Promise<Generation> {
    const db = await readDB();
    const gen: Generation = {
        id: uuidv4(),
        prompt,
        referenceIds,
        status: "pending",
        videoUrl: null,
        replicateId: null,
        error: null,
        createdAt: new Date().toISOString(),
    };
    db.generations.push(gen);
    await writeDB(db);
    return gen;
}

export async function updateGeneration(
    id: string,
    updates: Partial<Pick<Generation, "status" | "videoUrl" | "replicateId" | "error">>
): Promise<Generation | null> {
    const db = await readDB();
    const gen = db.generations.find((g) => g.id === id);
    if (!gen) return null;
    Object.assign(gen, updates);
    await writeDB(db);
    return gen;
}
