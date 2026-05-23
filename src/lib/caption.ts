import sharp from "sharp";
import Anthropic from "@anthropic-ai/sdk";

export const CAPTION_SYSTEM_PROMPT =
    "Generate a style LoRA training caption for this artwork image. " +
    "Describe ONLY the visual style elements: surface texture, material quality, color palette, surface finish, and tactile feel. " +
    "Do NOT name or describe the object or subject depicted. " +
    "Use specific texture vocabulary (e.g. porous, granular, oxidized, burnished, cracked, glazed, matte, encrusted). " +
    "Write as if describing a visual style that could apply to any scene or landscape. " +
    "Output only the caption, no preamble, no quotation marks, 1-2 sentences.";

// Resize to max 1024px and re-encode as JPEG to stay under Claude's 5MB base64 limit
async function shrinkForClaude(buffer: Buffer): Promise<Buffer> {
    return sharp(buffer)
        .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
}

export async function generateCaption(buffer: Buffer): Promise<string> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return "";

    try {
        const resized = await shrinkForClaude(buffer);
        const client = new Anthropic({ apiKey });
        const message = await client.messages.create({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 200,
            system: CAPTION_SYSTEM_PROMPT,
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: resized.toString("base64") } },
                        { type: "text", text: "Describe the visual style." },
                    ],
                },
            ],
        });
        const text = message.content.find((b) => b.type === "text");
        return text?.type === "text" ? text.text.trim() : "";
    } catch (err) {
        console.warn("Caption failed:", err);
        return "";
    }
}
