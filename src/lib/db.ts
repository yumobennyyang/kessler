import { promises as fs } from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

export interface Reference {
    id: string;
    subject: string;
    material: string;
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
    falRequestId: string | null;
    falEndpoint: string | null;
    error: string | null;
    createdAt: string;
}

export interface TrainingJob {
    id: string;
    status: "pending" | "training" | "completed" | "failed";
    falRequestId: string | null;
    loraUrl: string | null;
    triggerWord: string;
    referenceCount: number;
    error: string | null;
    createdAt: string;
    completedAt: string | null;
}

interface DB {
    references: Reference[];
    generations: Generation[];
    trainingJobs: TrainingJob[];
}

const DB_PATH = path.join(process.cwd(), "data.json");

async function readDB(): Promise<DB> {
    try {
        const raw = await fs.readFile(DB_PATH, "utf-8");
        const parsed = JSON.parse(raw);
        return {
            references: parsed.references ?? [],
            generations: parsed.generations ?? [],
            trainingJobs: parsed.trainingJobs ?? [],
        };
    } catch {
        return { references: [], generations: [], trainingJobs: [] };
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
    subject: string,
    material: string,
    filename: string,
    originalName: string
): Promise<Reference> {
    const db = await readDB();
    const ref: Reference = {
        id: uuidv4(),
        subject,
        material,
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
    subject: string,
    material: string
): Promise<Reference | null> {
    const db = await readDB();
    const ref = db.references.find((r) => r.id === id);
    if (!ref) return null;
    ref.subject = subject;
    ref.material = material;
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
    const filePath = path.join(process.cwd(), "public", "uploads", ref.filename);
    try { await fs.unlink(filePath); } catch { /* already gone */ }
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
        falRequestId: null,
        falEndpoint: null,
        error: null,
        createdAt: new Date().toISOString(),
    };
    db.generations.push(gen);
    await writeDB(db);
    return gen;
}

export async function updateGeneration(
    id: string,
    updates: Partial<Pick<Generation, "status" | "videoUrl" | "falRequestId" | "falEndpoint" | "error">>
): Promise<Generation | null> {
    const db = await readDB();
    const gen = db.generations.find((g) => g.id === id);
    if (!gen) return null;
    Object.assign(gen, updates);
    await writeDB(db);
    return gen;
}

// Training jobs
export async function getLatestTrainingJob(): Promise<TrainingJob | null> {
    const db = await readDB();
    if (!db.trainingJobs.length) return null;
    return db.trainingJobs.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )[0];
}

export async function addTrainingJob(
    triggerWord: string,
    referenceCount: number
): Promise<TrainingJob> {
    const db = await readDB();
    const job: TrainingJob = {
        id: uuidv4(),
        status: "pending",
        falRequestId: null,
        loraUrl: null,
        triggerWord,
        referenceCount,
        error: null,
        createdAt: new Date().toISOString(),
        completedAt: null,
    };
    db.trainingJobs.push(job);
    await writeDB(db);
    return job;
}

export async function updateTrainingJob(
    id: string,
    updates: Partial<Pick<TrainingJob, "status" | "falRequestId" | "loraUrl" | "error" | "completedAt">>
): Promise<TrainingJob | null> {
    const db = await readDB();
    const job = db.trainingJobs.find((j) => j.id === id);
    if (!job) return null;
    Object.assign(job, updates);
    await writeDB(db);
    return job;
}
