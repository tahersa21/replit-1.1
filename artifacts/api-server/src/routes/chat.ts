import { Router } from "express";
import OpenAI from "openai";
import { SendMessageBody } from "@workspace/api-zod";
import { getContext } from "../context-store";

const router = Router();

const openaiClient = new OpenAI({
  apiKey: process.env.FREEMODEL_API_KEY,
  baseURL: "https://api.freemodel.dev/v1",
});

const ANTHROPIC_BASE_URL = "https://cc.freemodel.dev";

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

async function callAnthropicAPI(
  model: string,
  systemPrompt: string,
  messages: { role: string; content: string }[]
): Promise<string> {
  const response = await fetch(`${ANTHROPIC_BASE_URL}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": process.env.FREEMODEL_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    }),
  });

  const data = (await response.json()) as {
    content?: { type: string; text: string }[];
    error?: { message: string };
  };

  if (!response.ok) {
    throw new Error(data.error?.message ?? "Anthropic API error");
  }

  const textBlock = data.content?.find((b) => b.type === "text");
  return textBlock?.text ?? "No response";
}

router.post("/chat", async (req, res) => {
  try {
    const parsed = SendMessageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }

    const { messages, model = "gpt-5.5" } = parsed.data;
    const systemPrompt = buildSystemPrompt();

    let reply: string;

    if (isClaudeModel(model)) {
      reply = await callAnthropicAPI(model, systemPrompt, messages);
    } else {
      const completion = await openaiClient.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
        ],
        max_tokens: 1024,
      });

      const completionData =
        typeof completion === "string" ? JSON.parse(completion) : completion;
      reply = completionData.choices?.[0]?.message?.content ?? "No response";
    }

    res.json({
      message: {
        role: "assistant",
        content: reply,
      },
    });
  } catch (err: unknown) {
    req.log.error({ err }, "Chat error");
    const message = err instanceof Error ? err.message : "Internal server error";
    res.status(500).json({ error: message });
  }
});

export default router;
