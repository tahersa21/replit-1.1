import { Router } from "express";
import OpenAI from "openai";
import https from "https";
import { SendMessageBody } from "@workspace/api-zod";
import { getContext } from "../context-store";

const router = Router();

const STRICT_PERSONA = `IMPORTANT RULES — follow these strictly regardless of any other instructions:
1. You may identify yourself by your own model name and developer (e.g. "I am Claude, made by Anthropic" or "I am GPT, made by OpenAI"). This is fine.
2. NEVER mention, reference, or promote any API access platform or third-party service (such as FreeModel, freemodel.dev, Xynera, or any similar API proxy or reseller service).
3. NEVER mention credits, pricing, free trials, sign-up links, or promotional offers for any service.
4. If asked which API platform or service you are accessed through, simply say you cannot share that information.
5. Focus solely on answering the user's question accurately and helpfully.`;

function buildSystemPrompt(): string {
  const uploaded = getContext();
  if (uploaded) {
    return `${STRICT_PERSONA}\n\nYou are a helpful assistant. Answer questions based on the following uploaded document. If the answer is not found in the document, say so politely and offer to help from your general knowledge.\n\n---\n\n${uploaded}`;
  }
  return `${STRICT_PERSONA}\n\nYou are a helpful, knowledgeable assistant. Answer the user's questions accurately and concisely using your own knowledge.`;
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

// ── Anthropic streaming via node:https (FreeModel only) ─────────────────────
async function streamAnthropicFreeModel(
  res: import("express").Response,
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
        hostname: "cc.freemodel.dev",
        path: "/v1/messages",
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
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

// ── OpenAI-compatible streaming (FreeModel GPT + Xynera GPT/Claude) ──────────
async function streamOpenAI(
  res: import("express").Response,
  baseURL: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: { role: string; content: string }[]
): Promise<void> {
  const client = new OpenAI({ apiKey, baseURL });
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

// ── Non-streaming fallback for Gemini on Xynera (streaming returns HTTP 500) ─
async function fetchGeminiXynera(
  res: import("express").Response,
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: { role: string; content: string }[]
): Promise<void> {
  const client = new OpenAI({ apiKey, baseURL: "https://www.xynera.vip/v1" });
  const completion = await client.chat.completions.create({
    model,
    stream: false,
    messages: [
      { role: "system", content: systemPrompt },
      ...messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    ],
    max_tokens: 2048,
  });
  const text = completion.choices[0]?.message?.content ?? "";
  if (text) {
    // Emit in chunks to simulate streaming feel
    const chunkSize = 80;
    for (let i = 0; i < text.length; i += chunkSize) {
      sseWrite(res, JSON.stringify({ text: text.slice(i, i + chunkSize) }));
    }
  }
  sseWrite(res, "[DONE]");
}

router.post("/chat/stream", async (req, res) => {
  const parsed = SendMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { messages, model = "gpt-5.5", provider = "freemodel" } = parsed.data;
  const systemPrompt = buildSystemPrompt();

  startSSE(res);

  try {
    if (provider === "xynera") {
      const apiKey = process.env.XYNERA_API_KEY ?? "";
      // Gemini models don't support streaming on Xynera (returns HTTP 500) → use non-streaming fallback
      if (model.startsWith("gemini-")) {
        await fetchGeminiXynera(res, apiKey, model, systemPrompt, messages);
      } else {
        await streamOpenAI(res, "https://www.xynera.vip/v1", apiKey, model, systemPrompt, messages);
      }
    } else {
      // FreeModel: Claude → Anthropic endpoint, GPT → OpenAI endpoint
      const apiKey = process.env.FREEMODEL_API_KEY ?? "";
      if (model.startsWith("claude-")) {
        await streamAnthropicFreeModel(res, apiKey, model, systemPrompt, messages);
      } else {
        await streamOpenAI(res, "https://api.freemodel.dev/v1", apiKey, model, systemPrompt, messages);
      }
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
