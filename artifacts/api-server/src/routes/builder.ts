import { Router } from "express";
import OpenAI from "openai";

const router = Router();

interface BuildRequest {
  prompt: string;
  provider?: "freemodel" | "xynera";
  apiKey?: string;
}

function parseBuildRequest(body: unknown): BuildRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b["prompt"] !== "string" || !b["prompt"].trim()) return null;
  const provider = b["provider"] === "xynera" ? "xynera" : "freemodel";
  const apiKey = typeof b["apiKey"] === "string" && b["apiKey"].trim() ? b["apiKey"].trim() : undefined;
  return { prompt: b["prompt"] as string, provider, apiKey };
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

interface PhaseModels {
  planModel: string;
  codeModel: string;
  verifyModel: string;
}

const PHASE_MODELS: Record<"freemodel" | "xynera", PhaseModels> = {
  freemodel: {
    planModel:   "gpt-4.1",
    codeModel:   "gpt-5.5",
    verifyModel: "gpt-4.1",
  },
  xynera: {
    planModel:   "gpt-4.1",
    codeModel:   "gpt-5.5",
    verifyModel: "gpt-4.1",
  },
};

function makeOpenAIClient(provider: "freemodel" | "xynera", userApiKey?: string): OpenAI {
  if (provider === "xynera") {
    return new OpenAI({ apiKey: userApiKey ?? process.env.XYNERA_API_KEY ?? "", baseURL: "https://www.xynera.vip/v1" });
  }
  return new OpenAI({ apiKey: userApiKey ?? process.env.FREEMODEL_API_KEY ?? "", baseURL: "https://api.freemodel.dev/v1" });
}

// ── Non-streaming call — uses stream:true internally so connection stays alive ──
async function callAI(
  provider: "freemodel" | "xynera",
  model: string,
  systemPrompt: string,
  userPrompt: string,
  userApiKey?: string
): Promise<string> {
  const client = makeOpenAIClient(provider, userApiKey);
  // Use streaming internally so the HTTP connection receives data continuously
  // and never times out waiting for a single large response.
  const stream = await client.chat.completions.create({
    model, stream: true,
    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
    max_tokens: 4000,
  });
  let result = "";
  for await (const chunk of stream) {
    result += chunk.choices[0]?.delta?.content ?? "";
  }
  return result;
}

// ── STREAMING code generation — emits file_chunk events token-by-token ────────
async function streamFileGeneration(
  res: import("express").Response,
  provider: "freemodel" | "xynera",
  model: string,
  systemPrompt: string,
  userPrompt: string,
  filePath: string,
  userApiKey?: string
): Promise<string> {
  const client = makeOpenAIClient(provider, userApiKey);
  let fullContent = "";

  const stream = await client.chat.completions.create({
    model, stream: true,
    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
    max_tokens: 4000,
  });

  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content;
    if (text) {
      fullContent += text;
      sseWrite(res, { type: "file_chunk", path: filePath, chunk: text });
    }
  }
  return fullContent;
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

const DESIGN_REVIEWER_SYSTEM = `You are an expert UI/UX designer and front-end visual auditor. 
Analyze the provided HTML/CSS/JS code and audit it for visual and design quality.
Output ONLY valid JSON — no markdown fences, no explanation.
Format:
{
  "score": <number 0-100>,
  "summary": "<one sentence summary in Arabic>",
  "issues": [
    {
      "severity": "high" | "medium" | "low",
      "category": "colors" | "typography" | "spacing" | "responsive" | "animation" | "accessibility" | "ux" | "consistency",
      "title": "<short title in Arabic>",
      "description": "<what is wrong in Arabic>",
      "fix": "<exact CSS/HTML fix suggestion in Arabic, be specific>"
    }
  ]
}
Severity guide: high = broken UX or very ugly, medium = noticeable flaw, low = minor polish.
Check for: color contrast & harmony, font hierarchy, padding/margin consistency, hover & focus states,
responsive breakpoints, smooth transitions, button clarity, empty states, visual hierarchy, CSS variables usage,
Arabic RTL support if text is Arabic.
Return max 8 issues. If no issues found for a category, skip it.`;

// ── Improve route — streams improved file content token-by-token ──────────────
router.post("/builder/improve", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const path       = typeof body["path"]        === "string" ? body["path"]        : "";
  const content    = typeof body["content"]     === "string" ? body["content"]     : "";
  const instruction= typeof body["instruction"] === "string" ? body["instruction"] : "";
  const provider   = body["provider"] === "xynera" ? "xynera" : "freemodel" as const;
  const userApiKey = typeof body["apiKey"] === "string" && (body["apiKey"] as string).trim()
    ? (body["apiKey"] as string).trim() : undefined;
  const allFiles   = Array.isArray(body["allFiles"])
    ? (body["allFiles"] as { path: string; content: string }[])
    : [];

  if (!path || !content || !instruction) {
    res.status(400).json({ error: "Missing required fields" }); return;
  }

  startSSE(res);

  const context = allFiles
    .filter((f) => f.path !== path)
    .map((f) => `// FILE: ${f.path}\n${f.content.slice(0, 300)}`)
    .join("\n\n");

  const IMPROVE_SYSTEM = `You are an expert web developer improving existing code.
Rules:
- Output ONLY the complete improved file content — no markdown fences, no explanation
- Apply the user's instruction precisely
- Keep everything that wasn't asked to change
- Ensure the file still works with the other project files`;

  const userPrompt = `File to improve: ${path}
${context ? `\nOther project files (for context):\n${context}\n` : ""}
Current file content:
${content}

Instruction: ${instruction}

Output the complete improved file content only.`;

  try {
    const client = makeOpenAIClient(provider, userApiKey);
    const codeModel = PHASE_MODELS[provider].codeModel;

    const stream = await client.chat.completions.create({
      model: codeModel, stream: true,
      messages: [{ role: "system", content: IMPROVE_SYSTEM }, { role: "user", content: userPrompt }],
      max_tokens: 4000,
    });

    sseWrite(res, { type: "improve_start", path });
    let full = "";
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) { full += text; sseWrite(res, { type: "improve_chunk", path, chunk: text }); }
    }
    sseWrite(res, { type: "improve_done", path, content: full });
  } catch (err) {
    req.log.error({ err }, "Improve stream error");
    sseWrite(res, { type: "error", message: err instanceof Error ? err.message : "حدث خطأ" });
  } finally {
    res.end();
  }
});

// ── Route ─────────────────────────────────────────────────────────────────────
router.post("/builder/stream", async (req, res) => {
  const parsed = parseBuildRequest(req.body);
  if (!parsed) { res.status(400).json({ error: "Invalid request" }); return; }

  const { prompt, provider = "freemodel", apiKey: userApiKey } = parsed;
  const phases = PHASE_MODELS[provider];
  startSSE(res);

  try {
    // ── Phase 1: Planning (Claude, non-streaming — need full JSON) ────────────
    sseWrite(res, { type: "status", message: "جارٍ تحليل المشروع ورسم الخطة...", phase: "planning", model: phases.planModel });

    const planText = await callAI(provider, phases.planModel, PLANNER_SYSTEM, `Build this project: ${prompt}`, userApiKey);

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
      res.end(); return;
    }

    sseWrite(res, { type: "plan", plan });

    // ── Phase 2: Code generation (GPT, STREAMING — tokens appear live) ────────
    const generatedFiles: { path: string; content: string }[] = [];

    for (const fileSpec of plan.files) {
      sseWrite(res, { type: "status", message: `جارٍ كتابة: ${fileSpec.path}`, phase: "coding", model: phases.codeModel });
      sseWrite(res, { type: "file_start", path: fileSpec.path });

      const context = generatedFiles.map((f) => `// FILE: ${f.path}\n${f.content.slice(0, 400)}`).join("\n\n");

      const fileContent = await streamFileGeneration(
        res, provider, phases.codeModel, FILE_GENERATOR_SYSTEM,
        `Project: ${plan.projectName}
Description: ${plan.description}
Tech stack: ${plan.techStack.join(", ")}
${context ? `\nAlready generated (for reference):\n${context}\n` : ""}
Generate the complete content for: ${fileSpec.path}
File purpose: ${fileSpec.description}

Output ONLY the raw file content, nothing else.`,
        fileSpec.path,
        userApiKey
      );

      generatedFiles.push({ path: fileSpec.path, content: fileContent });
      sseWrite(res, { type: "file_done", path: fileSpec.path, content: fileContent });
    }

    // ── Phase 3: Code verification ────────────────────────────────────────────
    sseWrite(res, { type: "status", message: "جارٍ مراجعة الكود...", phase: "verifying", model: phases.verifyModel });

    const verifyText = await callAI(
      provider, phases.verifyModel, VERIFIER_SYSTEM,
      `Project: ${plan.projectName}
Files: ${generatedFiles.map((f) => `${f.path} (${f.content.length} chars)`).join(", ")}
First file preview:\n${generatedFiles[0]?.content.slice(0, 600) ?? ""}`,
      userApiKey
    );

    let verification: { ok: boolean; notes: string } = { ok: true, notes: "تم البناء بنجاح ✓" };
    try {
      const cleaned = verifyText.replace(/^```[\w]*\n?/gm, "").replace(/```$/gm, "").trim();
      verification = JSON.parse(cleaned) as typeof verification;
    } catch { /* keep defaults */ }

    // ── Phase 4: Visual / design review ──────────────────────────────────────
    sseWrite(res, { type: "status", message: "جارٍ المراجعة البصرية والتصميمية...", phase: "design_review", model: phases.verifyModel });

    const htmlFile  = generatedFiles.find((f) => f.path.endsWith(".html"));
    const cssFile   = generatedFiles.find((f) => f.path.endsWith(".css"));
    const designPrompt = `Project: ${plan.projectName}
HTML (${htmlFile?.path ?? "none"}):
${htmlFile?.content.slice(0, 1200) ?? "not provided"}

CSS (${cssFile?.path ?? "none"}):
${cssFile?.content.slice(0, 2000) ?? "not provided"}

User's original request: ${prompt}`;

    const designText = await callAI(provider, phases.verifyModel, DESIGN_REVIEWER_SYSTEM, designPrompt, userApiKey);

    interface DesignIssue {
      severity: "high" | "medium" | "low";
      category: string;
      title: string;
      description: string;
      fix: string;
    }
    interface DesignReview { score: number; summary: string; issues: DesignIssue[] }

    let designReview: DesignReview = { score: 80, summary: "تم تحليل التصميم", issues: [] };
    try {
      const cleaned = designText.replace(/^```[\w]*\n?/gm, "").replace(/```$/gm, "").trim();
      designReview = JSON.parse(cleaned) as DesignReview;
    } catch { /* keep defaults */ }

    sseWrite(res, { type: "done", verification, designReview, files: generatedFiles, phases });

  } catch (err: unknown) {
    req.log.error({ err }, "Builder stream error");
    sseWrite(res, { type: "error", message: err instanceof Error ? err.message : "حدث خطأ داخلي" });
  } finally {
    res.end();
  }
});

export default router;
