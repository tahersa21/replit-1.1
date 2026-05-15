import { Router } from "express";
import OpenAI from "openai";
import https from "https";
import { SendMessageBody } from "@workspace/api-zod";
import { getContext } from "../context-store";

const router = Router();

const DEFAULT_CONTEXT = `
FreeModel Platform Documentation

FreeModel is an AI platform that provides free access to AI models.
It offers $300 in free credits to every new account instantly.
The platform supports both OpenAI-compatible and Anthropic-compatible APIs.

OpenAI models: gpt-5.5, gpt-5.4, gpt-5.4-mini, gpt-5.3-codex
Anthropic models: claude-opus-4-7, claude-sonnet-4-6, claude-haiku-4-5-20251001

Website: freemodel.dev
`.trim();

type ProviderConfig = {
  openaiBaseURL: string;
  anthropicHostname: string;
  anthropicPath: string;
  authHeader: (key: string) => Record<string, string>;
  openaiApiKey: string;
};

function getProviderConfig(provider: string): ProviderConfig {
  if (provider === "xynera") {
    const key = process.env.XYNERA_API_KEY ?? "";
    return {
      openaiBaseURL: "https://www.xynera.vip/v1",
      anthropicHostname: "www.xynera.vip",
      anthropicPath: "/v1/messages",
      authHeader: (k) => ({ Authorization: `Bearer ${k}` }),
      openaiApiKey: key,
    };
  }
  // default: freemodel
  const key = process.env.FREEMODEL_API_KEY ?? "";
  return {
    openaiBaseURL: "https://api.freemodel.dev/v1",
    anthropicHostname: "cc.freemodel.dev",
    anthropicPath: "/v1/messages",
    authHeader: (k) => ({ "x-api-key": k, "anthropic-version": "2023-06-01" }),
    openaiApiKey: key,
  };
}

function buildSystemPrompt(): string {
  const uploaded = getContext();
  const context = uploaded ?? DEFAULT_CONTEXT;
  const source = uploaded ? "the uploaded document" : "the FreeModel platform documentation";
  return `You are a helpful assistant. Answer questions based on the following ${source}. If the answer is not found in the provided context, say so politely and try to help based on your general knowledge.\n\n---\n\n${context}`;
}

function isClaudeModel(model: string): boolean {
  return model.startsWith("claude-");
}

function sseWrite(res: import("express").Response, data: string): void {
  res.write(`data: ${data}\n\n`);
}

function startSSE(res: import("express").Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
}

async function streamAnthropicToSSE(
  res: import("express").Response,
  cfg: ProviderConfig,
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: { role: string; content: string }[]
): Promise<void> {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify({
      model,
      max_tokens: 4096,
      stream: true,
      system: systemPrompt,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
    const bodyBuffer = Buffer.from(bodyStr, "utf8");

    const heartbeat = setInterval(() => {
      try { res.write(": heartbeat\n\n"); } catch { /* ignore */ }
    }, 10_000);
    const cleanup = () => clearInterval(heartbeat);

    const req = https.request(
      {
        hostname: cfg.anthropicHostname,
        path: cfg.anthropicPath,
        method: "POST",
        headers: {
          ...cfg.authHeader(apiKey),
          "Content-Type": "application/json",
          "Content-Length": bodyBuffer.length,
        },
      },
      (upstream) => {
        let buffer = "";
        upstream.on("data", (chunk: Buffer) => {
          buffer += chunk.toString("utf8");
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr || jsonStr === "[DONE]") continue;
            try {
              const event = JSON.parse(jsonStr) as {
                type: string;
                delta?: { type: string; text?: string };
                error?: { message: string };
              };
              if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
                sseWrite(res, JSON.stringify({ text: event.delta.text }));
              } else if (event.type === "message_stop") {
                sseWrite(res, "[DONE]");
              } else if (event.type === "error") {
                sseWrite(res, JSON.stringify({ error: event.error?.message ?? "Anthropic stream error" }));
              }
            } catch { /* ignore malformed */ }
          }
        });
        upstream.on("end", () => { cleanup(); resolve(); });
        upstream.on("error", (err) => { cleanup(); reject(err); });
      }
    );

    const hardTimeout = setTimeout(() => {
      cleanup();
      req.destroy(new Error("Anthropic stream exceeded 5-minute limit"));
    }, 300_000);

    req.on("error", (err) => { cleanup(); clearTimeout(hardTimeout); reject(err); });
    req.on("close", () => clearTimeout(hardTimeout));
    req.write(bodyBuffer);
    req.end();
  });
}

async function streamOpenAIToSSE(
  res: import("express").Response,
  cfg: ProviderConfig,
  model: string,
  systemPrompt: string,
  messages: { role: string; content: string }[]
): Promise<void> {
  const client = new OpenAI({ apiKey: cfg.openaiApiKey, baseURL: cfg.openaiBaseURL });
  const stream = await client.chat.completions.create({
    model,
    stream: true,
    messages: [
      { role: "system", content: systemPrompt },
      ...messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    ],
    max_tokens: 2048,
  });

  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content;
    if (text) sseWrite(res, JSON.stringify({ text }));
    if (chunk.choices[0]?.finish_reason === "stop") sseWrite(res, "[DONE]");
  }
}

router.post("/chat/stream", async (req, res) => {
  const parsed = SendMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { messages, model = "gpt-5.5", provider = "freemodel" } = parsed.data;
  const cfg = getProviderConfig(provider);
  const apiKey = provider === "xynera"
    ? (process.env.XYNERA_API_KEY ?? "")
    : (process.env.FREEMODEL_API_KEY ?? "");
  const systemPrompt = buildSystemPrompt();

  startSSE(res);

  try {
    if (isClaudeModel(model)) {
      await streamAnthropicToSSE(res, cfg, apiKey, model, systemPrompt, messages);
    } else {
      await streamOpenAIToSSE(res, cfg, model, systemPrompt, messages);
    }
  } catch (err: unknown) {
    req.log.error({ err }, "Stream chat error");
    const message = err instanceof Error ? err.message : "Internal server error";
    sseWrite(res, JSON.stringify({ error: message }));
  } finally {
    res.end();
  }
});

export default router;
