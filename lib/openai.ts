import OpenAI from "openai";

let _client: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set. Copy .env.example to .env.local.");
    }
    _client = new OpenAI({ apiKey });
  }
  return _client;
}

export const MODEL = process.env.OPENAI_MODEL || "gpt-4o";
