import { NextRequest } from "next/server";
import { getOpenAI, MODEL } from "@/lib/openai";
import type { ChatMessage } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { messages, latex } = (await req.json()) as {
      messages: ChatMessage[];
      latex: string;
    };

    if (!Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "messages must be an array" }), { status: 400 });
    }

    const system = `You are a homework tutor. The student has uploaded a homework PDF, which has already been solved and rendered as the LaTeX document below. Use this LaTeX as ground truth when answering questions about the assignment. Quote problem numbers when relevant. Keep answers concise and pedagogical — explain the reasoning, don't just restate the answer.

=== HOMEWORK LATEX (source of truth) ===
${latex || "(no LaTeX yet — tell the user to generate it first)"}
=== END HOMEWORK LATEX ===`;

    const client = getOpenAI();
    const stream = await client.chat.completions.create({
      model: MODEL,
      stream: true,
      temperature: 0.4,
      messages: [{ role: "system", content: system }, ...messages]
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content;
            if (delta) controller.enqueue(encoder.encode(delta));
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "stream error";
          controller.enqueue(encoder.encode(`\n\n[error: ${msg}]`));
        } finally {
          controller.close();
        }
      }
    });

    return new Response(readable, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
}
