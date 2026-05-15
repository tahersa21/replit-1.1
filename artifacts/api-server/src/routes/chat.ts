import { Router } from "express";
import OpenAI from "openai";
import https from "https";
import { SendMessageBody } from "@workspace/api-zod";
import { getContext } from "../context-store";

const router = Router();

const openaiClient = new OpenAI({
  apiKey: process.env.FREEMODEL_API_KEY,
  baseURL: "https://api.freemodel.dev/v1",
});

const DEFAULT_CONTEXT = `
FreeModel Platform Documentation

FreeModel is an AI platform that provides free access to AI models.
It offers $300 in free credits to every new account instantly.
The platform supports both OpenAI-compatible and Anthropic-compatible APIs.

OpenAI models: gpt-5.5, gpt-5.4, gpt-5.4-mini, gpt-5.3-codex
Anthropic models: claude-opus-4-7, claude-sonnet-4-6, claude-haiku-4-5-20251001

Website: freemodel.dev
`.trim();

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

    const req = https.request(
      {
        hostname: "cc.freemodel.dev",
        path: "/v1/messages",
        method: "POST",
        headers: {
          "x-api-key": process.env.FREEMODEL_API_KEY ?? "",
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
          "Content-Length": bodyBuffer.length,
        },
        timeout: 120_000,
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
            } catch {
              // ignore malformed lines
            }
          }
        });

        upstream.on("end", () => resolve());
        upstream.on("error", reject);
      }
    );

    req.on("timeout", () => req.destroy(new Error("Anthropic stream timed out")));
    req.on("error", reject);
    req.write(bodyBuffer);
    req.end();
  });
}

async function streamOpenAIToSSE(
  res: import("express").Response,
  model: string,
  systemPrompt: string,
  messages: { role: string; content: string }[]
): Promise<void> {
  const stream = await openaiClient.chat.completions.create({
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
    if (text) {
      sseWrite(res, JSON.stringify({ text }));
    }
    if (chunk.choices[0]?.finish_reason === "stop") {
      sseWrite(res, "[DONE]");
    }
  }
}

router.post("/chat/stream", async (req, res) => {
  const parsed = SendMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { messages, model = "gpt-5.5" } = parsed.data;
  const systemPrompt = buildSystemPrompt();

  startSSE(res);

  try {
    if (isClaudeModel(model)) {
      await streamAnthropicToSSE(res, model, systemPrompt, messages);
    } else {
      await streamOpenAIToSSE(res, model, systemPrompt, messages);
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
