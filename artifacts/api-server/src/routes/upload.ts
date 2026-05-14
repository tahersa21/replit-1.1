import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, readFile, readdir, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Router } from "express";
import multer from "multer";
import OpenAI from "openai";
import { setContext, clearContext } from "../context-store";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse") as (
  buffer: Buffer
) => Promise<{ text: string }>;
const mammoth = require("mammoth") as {
  extractRawText: (opts: { buffer: Buffer }) => Promise<{ value: string }>;
};

const execFileAsync = promisify(execFile);

const router = Router();

const client = new OpenAI({
  apiKey: process.env.FREEMODEL_API_KEY,
  baseURL: "https://api.freemodel.dev/v1",
});

const ACCEPTED_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "image",
  "image/jpeg": "image",
  "image/jpg": "image",
  "image/gif": "image",
  "image/webp": "image",
  "image/bmp": "image",
  "text/plain": "text",
  "text/markdown": "text",
  "text/csv": "text",
  "application/json": "text",
  "application/xml": "text",
  "text/xml": "text",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "docx",
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (_req, file, cb) => {
    if (ACCEPTED_TYPES[file.mimetype]) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

async function extractWithVision(
  imageBuffer: Buffer,
  mimeType: string,
  prompt: string,
  log: (msg: string) => void
): Promise<string> {
  log(`Sending image to vision model (${mimeType})`);
  const b64 = imageBuffer.toString("base64");

  const completion = await client.chat.completions.create({
    model: "FRE-5.5",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          {
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${b64}`, detail: "high" as const },
          },
        ],
      },
    ],
    max_tokens: 4096,
  });

  const raw = completion as unknown;
  const data = typeof raw === "string"
    ? JSON.parse(raw)
    : (raw as { choices?: Array<{ message?: { content?: string } }> });
  return data.choices?.[0]?.message?.content ?? "";
}

async function extractPdfWithVision(
  pdfBuffer: Buffer,
  log: (msg: string) => void
): Promise<string> {
  const workDir = join(tmpdir(), `pdf-${randomUUID()}`);
  await mkdir(workDir, { recursive: true });
  const pdfPath = join(workDir, "input.pdf");

  try {
    await writeFile(pdfPath, pdfBuffer);
    await execFileAsync("pdftoppm", [
      "-r", "150", "-png", "-l", "8",
      pdfPath, join(workDir, "page"),
    ]);

    const files = (await readdir(workDir))
      .filter((f) => f.endsWith(".png"))
      .sort();

    if (files.length === 0) throw new Error("No pages extracted from PDF");
    log(`Extracted ${files.length} page(s) from PDF, sending to vision model`);

    const imageContent: OpenAI.ChatCompletionContentPart[] = await Promise.all(
      files.map(async (f) => {
        const imgBuffer = await readFile(join(workDir, f));
        const b64 = imgBuffer.toString("base64");
        return {
          type: "image_url" as const,
          image_url: { url: `data:image/png;base64,${b64}`, detail: "high" as const },
        };
      })
    );

    const completion = await client.chat.completions.create({
      model: "FRE-5.5",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "These are pages from a PDF document. Please extract and transcribe ALL the text content from these pages as accurately as possible. Preserve the structure (headings, lists, paragraphs). Return only the extracted text, nothing else.",
            },
            ...imageContent,
          ],
        },
      ],
      max_tokens: 4096,
    });

    const raw = completion as unknown;
    const data = typeof raw === "string"
      ? JSON.parse(raw)
      : (raw as { choices?: Array<{ message?: { content?: string } }> });
    const extracted = data.choices?.[0]?.message?.content ?? "";
    if (!extracted.trim()) throw new Error("Vision model returned empty content");
    return extracted;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    const { originalname: filename, mimetype, buffer } = req.file;
    const fileKind = ACCEPTED_TYPES[mimetype] ?? "unknown";
    let text = "";
    let method = fileKind;

    if (fileKind === "text") {
      text = buffer.toString("utf-8").trim();
      req.log.info({ filename, charCount: text.length }, "Text file loaded");

    } else if (fileKind === "docx") {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value.trim();
      req.log.info({ filename, charCount: text.length }, "DOCX text extracted");

    } else if (fileKind === "image") {
      text = await extractWithVision(
        buffer,
        mimetype,
        "Please describe this image in detail and extract any text visible in it. Be thorough and comprehensive.",
        (msg) => req.log.info(msg)
      );
      method = "vision";
      req.log.info({ filename, charCount: text.length }, "Image described via vision");

    } else if (fileKind === "pdf") {
      // Try text extraction first
      try {
        const parsed = await pdfParse(buffer);
        text = parsed.text?.trim() ?? "";
      } catch {
        text = "";
      }
      // Fall back to vision OCR for image-based PDFs
      if (text.length < 20) {
        req.log.info({ filename }, "Text extraction failed, using vision OCR");
        method = "vision";
        text = await extractPdfWithVision(buffer, (msg) => req.log.info(msg));
      }
    }

    if (!text.trim()) {
      res.status(422).json({ error: "Could not extract any content from this file." });
      return;
    }

    setContext(text, filename);
    req.log.info({ filename, charCount: text.length, method }, "Context loaded");

    res.json({ success: true, filename, charCount: text.length });
  } catch (err: unknown) {
    req.log.error({ err }, "Upload error");
    const message = err instanceof Error ? err.message : "Internal server error";
    res.status(500).json({ error: message });
  }
});

router.post("/upload/clear", (req, res) => {
  clearContext();
  req.log.info("Context cleared");
  res.json({ success: true });
});

export default router;
