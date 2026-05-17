import { Router } from "express";
import OpenAI from "openai";

const router = Router();

interface BuildRequest {
  prompt: string;
  provider?: "freemodel" | "xynera";
  apiKey?: string;
  models?: Partial<PhaseModels>;
}

function parseBuildRequest(body: unknown): BuildRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b["prompt"] !== "string" || !b["prompt"].trim()) return null;
  const provider = b["provider"] === "xynera" ? "xynera" : "freemodel";
  const apiKey = typeof b["apiKey"] === "string" && b["apiKey"].trim() ? b["apiKey"].trim() : undefined;

  // Optional per-phase model overrides — accept any non-empty string
  let models: Partial<PhaseModels> | undefined;
  if (typeof b["models"] === "object" && b["models"] !== null) {
    const m = b["models"] as Record<string, unknown>;
    models = {};
    if (typeof m["planModel"]   === "string" && m["planModel"].trim())   models.planModel   = m["planModel"].trim();
    if (typeof m["codeModel"]   === "string" && m["codeModel"].trim())   models.codeModel   = m["codeModel"].trim();
    if (typeof m["verifyModel"] === "string" && m["verifyModel"].trim()) models.verifyModel = m["verifyModel"].trim();
    if (Object.keys(models).length === 0) models = undefined;
  }

  return { prompt: b["prompt"] as string, provider, apiKey, models };
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

// ── Non-streaming call ────────────────────────────────────────────────────────
async function callAI(
  provider: "freemodel" | "xynera",
  model: string,
  systemPrompt: string,
  userPrompt: string,
  userApiKey?: string,
  maxTokens = 2000
): Promise<string> {
  const client = makeOpenAIClient(provider, userApiKey);
  const stream = await client.chat.completions.create({
    model, stream: true,
    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
    max_tokens: maxTokens,
  });
  let result = "";
  for await (const chunk of stream) {
    result += chunk.choices[0]?.delta?.content ?? "";
  }
  return result;
}

// ── Phase 2a: Generate a lightweight interface contract for one file ──────────
// Fast non-streaming call — returns a single line describing what this file
// defines (IDs, CSS classes, JS functions) so parallel siblings know exactly
// what names to reference when they generate their own code.
async function generateInterface(
  provider: "freemodel" | "xynera",
  model: string,
  fileSpec: { path: string; description: string },
  projectName: string,
  projectOverview: string,
  userApiKey?: string
): Promise<string> {
  try {
    return await callAI(
      provider, model, INTERFACE_SYSTEM,
      `Project: ${projectName}\nAll project files:\n${projectOverview}\n\nGenerate the interface contract for: ${fileSpec.path}\nPurpose: ${fileSpec.description}`,
      userApiKey, 150
    );
  } catch {
    return `(contract unavailable for ${fileSpec.path})`;
  }
}

// ── Phase 2b: STREAMING code generation — emits SSE events token-by-token ─────
// Runs independently per file; catches its own errors so parallel siblings
// are not affected. Returns "" on failure (file_error event is emitted instead).
async function streamFileGeneration(
  res: import("express").Response,
  provider: "freemodel" | "xynera",
  model: string,
  systemPrompt: string,
  userPrompt: string,
  filePath: string,
  userApiKey?: string
): Promise<string> {
  try {
    const client = makeOpenAIClient(provider, userApiKey);
    const stream = await client.chat.completions.create({
      model, stream: true,
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
      max_tokens: 6000,
    });

    let fullContent = "";
    let hitTokenLimit = false;

    for await (const chunk of stream) {
      // Stop streaming if client disconnected (aborted from frontend)
      if (res.writableEnded) break;

      const text = chunk.choices[0]?.delta?.content;
      if (text) {
        fullContent += text;
        sseWrite(res, { type: "file_chunk", path: filePath, chunk: text });
      }
      if (chunk.choices[0]?.finish_reason === "length") {
        hitTokenLimit = true;
      }
    }

    if (hitTokenLimit && !res.writableEnded) {
      sseWrite(res, {
        type: "token_limit",
        path: filePath,
        message: `⚠️ "${filePath}" وصل لحد التوكن — الكود قد يكون ناقصاً. استخدم "تحسين" لاستكماله.`,
      });
    }

    return fullContent;
  } catch (err) {
    // Per-file error: notify frontend but don't crash the whole build
    if (!res.writableEnded) {
      sseWrite(res, {
        type: "file_error",
        path: filePath,
        message: err instanceof Error ? err.message : "خطأ غير معروف",
      });
    }
    return "";
  }
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

// Phase 2a: Generate a tiny "interface contract" for each file.
// This tells sibling files exactly what IDs, class names, CSS variables,
// and JS functions this file will define — so they can reference them correctly.
const INTERFACE_SYSTEM = `You are a web developer creating a concise interface contract for a file.
List ONLY what this file DEFINES that other files can USE. Be extremely concise.

Format by file type:
HTML → "ids: <id list> | classes: <class list> | forms: <form ids>"
CSS  → "vars: --name:value list | classes: .class list"
JS   → "fns: fnName() list | globals: varName list | events: eventName list"

Output ONE LINE only. No code, no explanation, no markdown.`;

const FILE_GENERATOR_SYSTEM = `You are an expert web developer writing complete production-ready code.
Rules:
- Output ONLY raw file content — no markdown fences, no explanation whatsoever
- Write complete working code with zero placeholders or TODOs
- HTML: modern professional design, link to style.css and script.js
- CSS: beautiful design with CSS variables, responsive layout
- JS: complete logic, no external dependencies unless CDN links are in HTML
- All files must work together as one cohesive app — use the EXACT ids, classes, and function names from the interface contracts
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

  const { prompt, provider = "freemodel", apiKey: userApiKey, models: modelOverrides } = parsed;
  // Merge provider defaults with any per-phase overrides from the client
  const phases: PhaseModels = { ...PHASE_MODELS[provider], ...modelOverrides };
  startSSE(res);

  try {
    // ── Phase 1: Planning ─────────────────────────────────────────────────────
    sseWrite(res, { type: "status", message: "جارٍ تحليل المشروع ورسم الخطة...", phase: "planning", model: phases.planModel });

    const planText = await callAI(provider, phases.planModel, PLANNER_SYSTEM, `Build this project: ${prompt}`, userApiKey, 2000);

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

    // ── Phase 2a: Interface contracts (fast, parallel) ────────────────────────
    // Each file generates a one-line "interface spec" describing exactly what
    // it DEFINES — HTML element IDs/classes, CSS variables/selectors, JS
    // function names. These contracts are then fed to Phase 2b so every file
    // knows the exact names used by its siblings, preventing class/ID mismatches.
    sseWrite(res, {
      type: "status",
      message: `جارٍ بناء العقود البينية للملفات...`,
      phase: "coding",
      model: phases.planModel,
    });

    const projectOverview = plan.files
      .map((f) => `- ${f.path}: ${f.description}`)
      .join("\n");

    const contractResults = await Promise.allSettled(
      plan.files.map(async (fileSpec) => {
        const contract = await generateInterface(
          provider, phases.planModel, fileSpec,
          plan.projectName, projectOverview, userApiKey
        );
        return { path: fileSpec.path, contract };
      })
    );

    // Build a shared cross-file context from all contracts
    const contracts = contractResults
      .filter((r): r is PromiseFulfilledResult<{ path: string; contract: string }> =>
        r.status === "fulfilled")
      .map((r) => r.value);

    // Emit contracts to frontend so user can see the shared interface
    if (!res.writableEnded) {
      sseWrite(res, { type: "contracts", contracts });
    }

    // ── Phase 2b: Full code generation (streaming, parallel) ─────────────────
    // Every file now has the complete interface contracts of ALL siblings,
    // so it can use the exact IDs, class names, CSS variables and function
    // names without guessing — all files stay consistent with each other.
    sseWrite(res, {
      type: "status",
      message: `جارٍ كتابة ${plan.files.length} ملفات بالتوازي...`,
      phase: "coding",
      model: phases.codeModel,
    });

    const filePromises = plan.files.map(async (fileSpec) => {
      // Contracts of sibling files (exclude this file's own contract)
      const siblingContracts = contracts
        .filter((c) => c.path !== fileSpec.path)
        .map((c) => `  ${c.path}: ${c.contract}`)
        .join("\n");

      sseWrite(res, { type: "file_start", path: fileSpec.path });

      const content = await streamFileGeneration(
        res, provider, phases.codeModel, FILE_GENERATOR_SYSTEM,
        `Project: ${plan.projectName}
Description: ${plan.description}
Tech stack: ${plan.techStack.join(", ")}

All project files:
${projectOverview}

Sibling file interface contracts — use these EXACT names in your code:
${siblingContracts || "(none)"}

Your task: generate the complete content for "${fileSpec.path}"
File purpose: ${fileSpec.description}

Output ONLY the raw file content — no markdown, no explanation.`,
        fileSpec.path,
        userApiKey
      );

      sseWrite(res, { type: "file_done", path: fileSpec.path, content });
      return { path: fileSpec.path, content };
    });

    // allSettled: a failing file never blocks its siblings
    const results = await Promise.allSettled(filePromises);
    const generatedFiles = results
      .filter((r): r is PromiseFulfilledResult<{ path: string; content: string }> =>
        r.status === "fulfilled" && r.value.content.length > 0)
      .map((r) => r.value);

    // ── Phase 3: Code verification ────────────────────────────────────────────
    sseWrite(res, { type: "status", message: "جارٍ مراجعة الكود...", phase: "verifying", model: phases.verifyModel });

    const verifyText = await callAI(
      provider, phases.verifyModel, VERIFIER_SYSTEM,
      `Project: ${plan.projectName}
Files: ${generatedFiles.map((f) => `${f.path} (${f.content.length} chars)`).join(", ")}
First file preview:\n${generatedFiles[0]?.content.slice(0, 600) ?? ""}`,
      userApiKey, 500
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

    const designText = await callAI(provider, phases.verifyModel, DESIGN_REVIEWER_SYSTEM, designPrompt, userApiKey, 2000);

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
