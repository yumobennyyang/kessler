import { fal } from "@fal-ai/client";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env.local manually
const envPath = path.join(__dirname, "../.env.local");
const envContent = await fs.readFile(envPath, "utf8");
for (const line of envContent.split("\n")) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
}

fal.config({ credentials: () => process.env.FAL_KEY ?? "" });

const FILES = [
    "burnt.png",
    "clump.png",
    "glaze.png",
    "nail.png",
    "plaster.png",
    "scrap.png",
    "terra.png",
    "tree.png",
];

const refsDir = path.join(__dirname, "../public/references");

for (const filename of FILES) {
    const buf = await fs.readFile(path.join(refsDir, filename));
    const file = new File([buf], filename, { type: "image/png" });
    const url = await fal.storage.upload(file);
    console.log(`${filename}: ${url}`);
}
