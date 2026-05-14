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

const execFileAsync = promisify(execFile);

const router = Router();

const client = new OpenAI({
  apiKey: process.env.FREEMODEL_API_KEY,
  baseURL: "https://api.freemodel.dev/v1",
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed"));
    }
  },
});

async function extractWithVision(
  pdfBuffer: Buffer,
  log: (msg: string) => void
): Promise<string> {
  const workDir = join(tmpdir(), `pdf-${randomUUID()}`);
  await mkdir(workDir, { recursive: true });
  const pdfPath = join(workDir, "input.pdf");

  try {
    await writeFile(pdfPath, pdfBuffer);

    // Convert PDF pages to PNG images (max 8 pages, 150 DPI)
    await execFileAsync("pdftoppm", [
      "-r", "150",
      "-png",
      "-l", "8",
      pdfPath,
      join(workDir, "page"),
    ]);

    const files = (await readdir(workDir))
      .filter((f) => f.endsWith(".png"))
      .sort();

    if (files.length === 0) {
      throw new Error("No pages extracted from PDF");
    }

    log(`Extracted ${files.length} page(s) from PDF, sending to vision model`);

    // Build vision message with all pages
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
    const data = typeof raw === "string" ? JSON.parse(raw) : raw as { choices?: Array<{ message?: { content?: string } }> };
    const extracted = data.choices?.[0]?.message?.content ?? "";

    if (!extracted.trim()) {
      throw new Error("Vision model returned empty content");
    }

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

    const filename = req.file.originalname;
    let text = "";
    let method = "text";

    // Try text extraction first
    try {
      const parsed = await pdfParse(req.file.buffer);
      text = parsed.text?.trim() ?? "";
    } catch {
      text = "";
    }

    // Fall back to vision OCR for image-based PDFs
    if (text.length < 20) {
      req.log.info({ filename }, "Text extraction failed, using vision OCR");
      method = "vision";
      try {
        text = await extractWithVision(req.file.buffer, (msg) =>
          req.log.info(msg)
        );
      } catch (visionErr) {
        req.log.error({ visionErr }, "Vision OCR failed");
        res.status(422).json({
          error:
            "Could not extract content from this PDF. Please try a different file.",
        });
        return;
      }
    }

    setContext(text, filename);
    req.log.info({ filename, charCount: text.length, method }, "PDF context loaded");

    res.json({
      success: true,
      filename,
      charCount: text.length,
    });
  } catch (err: unknown) {
    req.log.error({ err }, "Upload error");
    const message =
      err instanceof Error ? err.message : "Internal server error";
    res.status(500).json({ error: message });
  }
});

router.post("/upload/clear", (req, res) => {
  clearContext();
  req.log.info("PDF context cleared");
  res.json({ success: true });
});

export default router;
