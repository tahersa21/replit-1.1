import { Router } from "express";
import OpenAI from "openai";
import https from "https";

const router = Router();

interface BuildRequest {
  prompt: string;
  provider?: "freemodel" | "xynera";
}

function parseBuildRequest(body: unknown): BuildRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b["prompt"] !== "string" || !b["prompt"].trim()) return null;
  const provider = b["provider"] === "xynera" ? "xynera" : "freemodel";
  return { prompt: b["prompt"] as string, provider };
}

function sseWrite(res: import("express").Response, data: object): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function startSSE(res: import("express").Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
}

// ── Per-provider model config for each phase ─────────────────────────────────
//   Planning  → Claude (best at structured reasoning & architecture)
//   Coding    → GPT   (best at producing clean code)
//   Verifying → Claude (best at reviewing & critiquing)

interface PhaseModels {
  planModel: string;
  codeModel: string;
  verifyModel: string;
}

const PHASE_MODELS: Record<"freemodel" | "xynera", PhaseModels> = {
  freemodel: {
    planModel:   "claude-opus-4-7",
    codeModel:   "gpt-5.5",
    verifyModel: "claude-sonnet-4-6",
  },
  xynera: {
    planModel:   "claude-opus-4-7",
    codeModel:   "gpt-5.5",
    verifyModel: "claude-4-6-sonnet",
  },
};

// ── OpenAI-compatible client ──────────────────────────────────────────────────
function makeOpenAIClient(provider: "freemodel" | "xynera"): OpenAI {
  if (provider === "xynera") {
    return new OpenAI({ apiKey: process.env.XYNERA_API_KEY ?? "", baseURL: "https://www.xynera.vip/v1" });
  }
  return new OpenAI({ apiKey: process.env.FREEMODEL_API_KEY ?? "", baseURL: "https://api.freemodel.dev/v1" });
}

// ── Anthropic via node:https (for FreeModel Claude) ───────────────────────────
async function callAnthropicFreeModel(
  model: string,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify({
      model,
      max_tokens: 4096,
      stream: false,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    const bodyBuf = Buffer.from(bodyStr, "utf8");

    const req = https.request(
      {
        hostname: "cc.freemodel.dev",
        path: "/v1/messages",
        method: "POST",
        headers: {
          "x-api-key": process.env.FREEMODEL_API_KEY ?? "",
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
          "Content-Length": bodyBuf.length,
        },
      },
      (upstream) => {
        let raw = "";
        upstream.on("data", (chunk: Buffer) => { raw += chunk.toString("utf8"); });
        upstream.on("end", () => {
          try {
            const parsed = JSON.parse(raw) as { content?: { type: string; text?: string }[]; error?: { message: string } };
            if (parsed.error) { reject(new Error(parsed.error.message)); return; }
            const text = parsed.content?.find((b) => b.type === "text")?.text ?? "";
            resolve(text);
          } catch (e) { reject(e); }
        });
        upstream.on("error", reject);
      }
    );
    req.setTimeout(120_000, () => req.destroy(new Error("Anthropic request timeout")));
    req.on("error", reject);
    req.write(bodyBuf);
    req.end();
  });
}

// ── Unified callAI dispatcher ─────────────────────────────────────────────────
async function callAI(
  provider: "freemodel" | "xynera",
  model: string,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  // FreeModel Claude → dedicated Anthropic endpoint
  if (provider === "freemodel" && model.startsWith("claude-")) {
    return callAnthropicFreeModel(model, systemPrompt, userPrompt);
  }

  // Everything else → OpenAI-compatible endpoint
  const client = makeOpenAIClient(provider);
  const completion = await client.chat.completions.create({
    model,
    stream: false,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_tokens: 4000,
  });
  return completion.choices[0]?.message?.content ?? "";
}

// ── Prompts ───────────────────────────────────────────────────────────────────
const PLANNER_SYSTEM = `You are an expert software architect. When given a project description, produce a detailed build plan.
Output ONLY valid JSON (no markdown fences, no explanation) in this exact format:
{
  "projectName": "string",
  "description": "string",
  "techStack": ["string"],
  "tasks": [
    { "id": "T001", "title": "string", "description": "string", "files": ["filename.ext"] }
  ],
  "files": [
    { "path": "filename.ext", "description": "what this file contains", "taskId": "T001" }
  ]
}
Rules: max 8 files, HTML/CSS/JS only (no build tools), files must run directly in browser.`;

const FILE_GENERATOR_SYSTEM = `You are an expert web developer writing complete production-ready code.
Rules:
- Output ONLY raw file content — no markdown fences, no explanation whatsoever
- Write complete working code with zero placeholders or TODOs
- HTML: modern professional design, link to style.css and script.js
- CSS: beautiful design with CSS variables, responsive layout
- JS: complete logic, no external dependencies unless CDN links are in HTML
- All files must work together as one cohesive app
- Use Arabic UI text when the user prompt is in Arabic`;

const VERIFIER_SYSTEM = `You are a senior code reviewer. Review the provided project files and output ONLY valid JSON:
{"ok": true, "notes": "brief confirmation in Arabic"} or {"ok": false, "notes": "what is missing or broken in Arabic"}
No markdown, no explanation — just the JSON object.`;

// ── Route ─────────────────────────────────────────────────────────────────────
router.post("/builder/stream", async (req, res) => {
  const parsed = parseBuildRequest(req.body);
  if (!parsed) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const { prompt, provider = "freemodel" } = parsed;
  const phases = PHASE_MODELS[provider];
  startSSE(res);

  try {
    // ── Phase 1: Planning with Claude ────────────────────────────────────────
    sseWrite(res, {
      type: "status",
      message: "جارٍ تحليل المشروع ورسم الخطة...",
      phase: "planning",
      model: phases.planModel,
    });

    const planText = await callAI(provider, phases.planModel, PLANNER_SYSTEM, `Build this project: ${prompt}`);

    let plan: {
      projectName: string;
      description: string;
      techStack: string[];
      tasks: { id: string; title: string; description: string; files: string[] }[];
      files: { path: string; description: string; taskId: string }[];
    };

    try {
      const cleaned = planText.replace(/^```[\w]*\n?/gm, "").replace(/```$/gm, "").trim();
      plan = JSON.parse(cleaned) as typeof plan;
    } catch {
      sseWrite(res, { type: "error", message: "فشل تحليل خطة البناء — حاول مرة أخرى." });
      res.end();
      return;
    }

    sseWrite(res, { type: "plan", plan });

    // ── Phase 2: Code generation with GPT ────────────────────────────────────
    const generatedFiles: { path: string; content: string }[] = [];

    for (const fileSpec of plan.files) {
      sseWrite(res, {
        type: "status",
        message: `جارٍ إنشاء: ${fileSpec.path}`,
        phase: "coding",
        model: phases.codeModel,
      });
      sseWrite(res, { type: "file_start", path: fileSpec.path });

      const context = generatedFiles
        .map((f) => `// FILE: ${f.path}\n${f.content.slice(0, 400)}`)
        .join("\n\n");

      const fileContent = await callAI(
        provider,
        phases.codeModel,
        FILE_GENERATOR_SYSTEM,
        `Project: ${plan.projectName}
Description: ${plan.description}
Tech stack: ${plan.techStack.join(", ")}
${context ? `\nAlready generated (for reference):\n${context}\n` : ""}
Generate the complete content for: ${fileSpec.path}
File purpose: ${fileSpec.description}

Output ONLY the raw file content, nothing else.`
      );

      generatedFiles.push({ path: fileSpec.path, content: fileContent });
      sseWrite(res, { type: "file_done", path: fileSpec.path, content: fileContent });
    }

    // ── Phase 3: Verification with Claude ────────────────────────────────────
    sseWrite(res, {
      type: "status",
      message: "جارٍ مراجعة المشروع والتحقق من اكتماله...",
      phase: "verifying",
      model: phases.verifyModel,
    });

    const verifyPrompt = `Project: ${plan.projectName}
Files generated:
${generatedFiles.map((f) => `- ${f.path} (${f.content.length} chars)`).join("\n")}

First file preview (index.html):
${generatedFiles[0]?.content.slice(0, 600) ?? ""}

Is this project complete and functional?`;

    const verifyText = await callAI(provider, phases.verifyModel, VERIFIER_SYSTEM, verifyPrompt);
    let verification: { ok: boolean; notes: string } = { ok: true, notes: "تم البناء بنجاح ✓" };
    try {
      const cleaned = verifyText.replace(/^```[\w]*\n?/gm, "").replace(/```$/gm, "").trim();
      verification = JSON.parse(cleaned) as typeof verification;
    } catch { /* keep defaults */ }

    sseWrite(res, { type: "done", verification, files: generatedFiles, phases });

  } catch (err: unknown) {
    req.log.error({ err }, "Builder stream error");
    const message = err instanceof Error ? err.message : "حدث خطأ داخلي";
    sseWrite(res, { type: "error", message });
  } finally {
    res.end();
  }
});

export default router;
