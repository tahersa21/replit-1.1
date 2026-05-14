import { Router } from "express";
import OpenAI from "openai";
import { SendMessageBody } from "@workspace/api-zod";
import { getContext } from "../context-store";

const router = Router();

const client = new OpenAI({
  apiKey: process.env.FREEMODEL_API_KEY,
  baseURL: "https://api.freemodel.dev/v1",
});

const FREEMODEL_CONTEXT = `
FreeModel Platform Documentation

Overview:
FreeModel is an AI platform that provides free access to the latest AI models (FRE-5.4 and FRE-5.5). It offers $300 in free credits to every new account instantly — no payment info required. The platform is fully OpenAI Compatible, making it a drop-in replacement for the OpenAI API that works with every SDK and tool you already use.

Key Features:
- $300 Free Credits: Every new account gets $300 in credits instantly, no payment info required. Start building right away.
- FRE-5.4 & FRE-5.5: Access to the latest flagship models through one clean, simple API endpoint.
- OpenAI Compatible: Compatible with ChatGPT SDK, Cursor, ChatBox, and all OpenAI-ecosystem tools. Drop-in replacement for the OpenAI API.
- No hidden fees, no trial limits — just build.

API Routes and Endpoints:
- OpenAI Format (Primary Route): https://api.freemodel.dev
- This endpoint is active and compatible with OpenAI client libraries.

Authentication:
- API keys are used to authenticate requests.
- Keys should never be exposed in client-side code.
- You can create and revoke API keys from the dashboard at freemodel.dev/dashboard/keys.

API Key Format:
- Keys follow the format: fe_oa_... (followed by a unique identifier)

Usage:
- You can use the FreeModel API with any OpenAI-compatible SDK by setting the base URL to https://api.freemodel.dev/v1 and your API key.
- The platform supports 356+ concurrent users (at time of documentation).

Models Available:
- FRE-5.4: Latest flagship model
- FRE-5.5: Latest flagship model (newer version)

Account Management:
- Home: Dashboard overview
- API Keys: Manage your authentication keys
- Usage: Monitor your API usage
- Logs: View request logs
- Billing: Manage billing information
- Refer & Earn: Referral program
- Profile: Account settings

Compatible Tools:
- ChatGPT SDK
- Cursor
- ChatBox
- All OpenAI-ecosystem tools

Website: freemodel.dev
`.trim();

function buildSystemPrompt(): string {
  const uploaded = getContext();
  const context = uploaded ?? FREEMODEL_CONTEXT;
  const source = uploaded
    ? "the uploaded document"
    : "the FreeModel platform documentation";
  return `You are a helpful assistant. Answer questions based on the following ${source}. If the answer is not found in the provided context, say so politely and try to help based on your general knowledge.

---

${context}`;
}

router.post("/chat", async (req, res) => {
  try {
    const parsed = SendMessageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }

    const { messages, model = "FRE-5.5" } = parsed.data;

    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        ...messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      ],
      max_tokens: 1024,
    });

    const completionData =
      typeof completion === "string" ? JSON.parse(completion) : completion;
    const reply =
      completionData.choices?.[0]?.message?.content ?? "No response";

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
