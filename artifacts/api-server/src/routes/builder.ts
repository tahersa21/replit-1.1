import { Router } from "express";
import OpenAI from "openai";

const router = Router();

interface BuildRequest {
  prompt: string;
  model?: string;
  provider?: "freemodel" | "xynera";
}

function parseBuildRequest(body: unknown): BuildRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b["prompt"] !== "string" || !b["prompt"].trim()) return null;
  const provider = b["provider"] === "xynera" ? "xynera" : "freemodel";
  const model = typeof b["model"] === "string" ? b["model"] : "gpt-5.5";
  return { prompt: b["prompt"] as string, model, provider };
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

function getOpenAIClient(provider: string): { client: OpenAI; model: string; actualModel: string } {
  const freeKey = process.env.FREEMODEL_API_KEY ?? "";
  const xyneraKey = process.env.XYNERA_API_KEY ?? "";

  if (provider === "xynera") {
    return {
      client: new OpenAI({ apiKey: xyneraKey, baseURL: "https://www.xynera.vip/v1" }),
      model: "gpt-5.5",
      actualModel: "gpt-5.5",
    };
  }
  return {
    client: new OpenAI({ apiKey: freeKey, baseURL: "https://api.freemodel.dev/v1" }),
    model: "gpt-5.5",
    actualModel: "gpt-5.5",
  };
}

async function callAI(client: OpenAI, model: string, systemPrompt: string, userPrompt: string): Promise<string> {
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

const PLANNER_SYSTEM = `You are an expert software architect. When given a project description, you produce a detailed build plan.
Output ONLY valid JSON (no markdown, no explanation) in this exact format:
{
  "projectName": "string",
  "description": "string",
  "techStack": ["string"],
  "tasks": [
    {
      "id": "T001",
      "title": "string",
      "description": "string",
      "files": ["filename.ext"]
    }
  ],
  "files": [
    {
      "path": "filename.ext",
      "description": "what this file contains",
      "taskId": "T001"
    }
  ]
}
Keep it practical. For a web app: index.html, style.css, script.js (+ any needed files). Max 8 files total. Use only HTML/CSS/JS (no build tools needed — runs directly in browser).`;

const FILE_GENERATOR_SYSTEM = `You are an expert web developer. You write complete, production-ready code.
Rules:
- Output ONLY the raw file content, no markdown code blocks, no explanation
- Write complete working code, no placeholders or TODOs
- For HTML: include all styles inline or reference style.css, make it look modern and professional
- For CSS: write complete styles with a beautiful modern design using CSS variables
- For JS: write complete working JavaScript with no external dependencies unless CDN links in HTML
- All files must work together as a cohesive app
- Use Arabic UI text if the user prompt was in Arabic`;

router.post("/builder/stream", async (req, res) => {
  const parsed = parseBuildRequest(req.body);
  if (!parsed) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const { prompt, provider = "freemodel" } = parsed;
  startSSE(res);

  try {
    const { client, model } = getOpenAIClient(provider);

    // ── Step 1: Planning ─────────────────────────────────────────────────────
    sseWrite(res, { type: "status", message: "جارٍ تحليل المشروع ورسم الخطة..." });

    const planText = await callAI(
      client,
      model,
      PLANNER_SYSTEM,
      `Build this project: ${prompt}`
    );

    let plan: {
      projectName: string;
      description: string;
      techStack: string[];
      tasks: { id: string; title: string; description: string; files: string[] }[];
      files: { path: string; description: string; taskId: string }[];
    };

    try {
      // Strip potential markdown fences if model added them
      const cleaned = planText.replace(/^```[\w]*\n?/m, "").replace(/\n?```$/m, "").trim();
      plan = JSON.parse(cleaned) as typeof plan;
    } catch {
      sseWrite(res, { type: "error", message: "فشل تحليل خطة البناء. حاول مرة أخرى." });
      res.end();
      return;
    }

    sseWrite(res, { type: "plan", plan });

    // ── Step 2: Generate each file ───────────────────────────────────────────
    const generatedFiles: { path: string; content: string }[] = [];

    for (const fileSpec of plan.files) {
      sseWrite(res, { type: "status", message: `جارٍ إنشاء الملف: ${fileSpec.path}` });
      sseWrite(res, { type: "file_start", path: fileSpec.path });

      const alreadyGenerated = generatedFiles.map(f => `// FILE: ${f.path}\n${f.content.slice(0, 300)}`).join("\n\n");

      const fileContent = await callAI(
        client,
        model,
        FILE_GENERATOR_SYSTEM,
        `Project: ${plan.projectName}
Description: ${plan.description}
Tech stack: ${plan.techStack.join(", ")}

${alreadyGenerated ? `Already generated files (for reference):\n${alreadyGenerated}\n\n` : ""}
Now generate the complete content for: ${fileSpec.path}
File purpose: ${fileSpec.description}

Output ONLY the raw file content, nothing else.`
      );

      generatedFiles.push({ path: fileSpec.path, content: fileContent });
      sseWrite(res, { type: "file_done", path: fileSpec.path, content: fileContent });
    }

    // ── Step 3: Verify & emit done ───────────────────────────────────────────
    sseWrite(res, { type: "status", message: "جارٍ التحقق من اكتمال المشروع..." });

    const verifyPrompt = `You built a project with these files:
${generatedFiles.map(f => `- ${f.path}: ${f.content.length} chars`).join("\n")}

Does the project look complete and functional? Reply with JSON: {"ok": true, "notes": "brief note"} or {"ok": false, "notes": "what's missing"}
Output ONLY JSON.`;

    const verifyText = await callAI(client, model, "You are a code reviewer. Output only JSON.", verifyPrompt);
    let verification: { ok: boolean; notes: string } = { ok: true, notes: "تم البناء بنجاح" };
    try {
      const cleaned = verifyText.replace(/^```[\w]*\n?/m, "").replace(/\n?```$/m, "").trim();
      verification = JSON.parse(cleaned) as typeof verification;
    } catch { /* keep defaults */ }

    sseWrite(res, { type: "done", verification, files: generatedFiles });

  } catch (err: unknown) {
    req.log.error({ err }, "Builder stream error");
    const message = err instanceof Error ? err.message : "حدث خطأ داخلي";
    sseWrite(res, { type: "error", message });
  } finally {
    res.end();
  }
});

export default router;
