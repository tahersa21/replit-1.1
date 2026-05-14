import { createRequire } from "node:module";
import { Router } from "express";
import multer from "multer";
import { setContext, clearContext } from "../context-store";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse") as (
  buffer: Buffer
) => Promise<{ text: string }>;

const router = Router();

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

router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    const filename = req.file.originalname;
    let text = "";
    let hasText = false;

    try {
      const parsed = await pdfParse(req.file.buffer);
      text = parsed.text?.trim() ?? "";
      hasText = text.length > 20;
    } catch {
      hasText = false;
    }

    if (!hasText) {
      res.status(422).json({
        error:
          "Could not extract text from this PDF. It may be image-based or scanned. Please upload a PDF with selectable text.",
      });
      return;
    }

    setContext(text, filename);

    req.log.info({ filename, charCount: text.length }, "PDF context loaded");

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
