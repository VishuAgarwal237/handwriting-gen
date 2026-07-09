/**
 * Seam for the One-DM (or any) ML handwriting model.
 *
 * The user's uploaded handwriting sample is the *style* — it's what the model
 * conditions on so the output is in their hand. This module sends that sample
 * (lightly cleaned up) to the deployed renderer for every token.
 *
 * Two endpoint contracts are supported, preferred in this order:
 *
 *   1. HANDWRITING_TEXT_URL (+ HANDWRITING_API_TOKEN) — the deployed Modal
 *      endpoint. One request per token:
 *        POST {url}
 *        headers: Authorization: Bearer <token>
 *        body: { style_image_b64, content, api_token }
 *        resp: { image_b64 }
 *
 *   2. HANDWRITING_SERVICE_URL — the batch `/generate` contract in
 *      `modal/one_dm_app.py`:
 *        POST {base}/generate
 *        body: { style_image_b64, words }
 *        resp: { images_b64, sizes }
 *
 * When neither is set (or a call fails) this returns `null` and the composer
 * falls back to the embedded handwriting font.
 */

import sharp from "sharp";

export type WordImage = {
  word: string;
  pngBase64: string;
  widthPx: number;
  heightPx: number;
};

export type GenerateOptions = {
  styleImageDataUrl: string;
  words: string[];
  signal?: AbortSignal;
};

const TIMEOUT_MS = 90_000;
const PER_WORD_ATTEMPTS = 2;

export async function generateHandwritingWords(opts: GenerateOptions): Promise<WordImage[] | null> {
  const textUrl = process.env.HANDWRITING_TEXT_URL?.trim();
  const token = process.env.HANDWRITING_API_TOKEN?.trim();
  const serviceBase = process.env.HANDWRITING_SERVICE_URL?.trim();
  if (!textUrl && !serviceBase) return null;

  const styleB64 = await prepareStyle(opts.styleImageDataUrl);
  if (!styleB64) return null;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  if (opts.signal) opts.signal.addEventListener("abort", () => ac.abort());

  try {
    if (textUrl) {
      return await renderPerWord(textUrl, token, styleB64, opts.words, ac.signal);
    }
    return await renderBatch(serviceBase!, styleB64, opts.words, ac.signal);
  } catch (err) {
    console.warn("[handwritingProvider] error, falling back to font", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cleans the uploaded sample into a compact greyscale style image: strip color
 * so phone-photo tints don't leak into conditioning, normalize contrast, and
 * cap the size to keep request payloads small. The renderer does its own tight
 * ink-crop, so we just hand it a clean sample. Falls back to the raw bytes if
 * sharp can't process the upload.
 */
async function prepareStyle(styleImageDataUrl: string): Promise<string | null> {
  const raw = styleImageDataUrl.split(",")[1] ?? "";
  if (!raw) return null;
  try {
    const png = await sharp(Buffer.from(raw, "base64"))
      .greyscale()
      .normalize()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    return png.toString("base64");
  } catch (err) {
    console.warn("[handwritingProvider] style preprocessing failed, sending raw sample", err);
    return raw;
  }
}

/** Deployed endpoint: one styled render per token, memoized within the call. */
async function renderPerWord(
  url: string,
  token: string | undefined,
  styleB64: string,
  words: string[],
  signal: AbortSignal
): Promise<WordImage[]> {
  // A deterministic renderer returns identical bytes for a repeated token, so
  // memoizing avoids paying for the same word twice. The composer applies
  // per-instance variation afterwards, so repeats still don't look identical.
  const memo = new Map<string, string>();

  const renderOne = async (word: string): Promise<string> => {
    const cached = memo.get(word);
    if (cached) return cached;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= PER_WORD_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify({ style_image_b64: styleB64, content: word, api_token: token }),
          signal
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
        const json = (await res.json()) as { image_b64?: string };
        if (!json.image_b64) throw new Error("response missing image_b64");
        memo.set(word, json.image_b64);
        return json.image_b64;
      } catch (err) {
        lastErr = err;
        if (attempt < PER_WORD_ATTEMPTS) await new Promise((r) => setTimeout(r, 800 * attempt));
      }
    }
    throw lastErr;
  };

  const out: WordImage[] = [];
  for (const word of words) {
    out.push({ word, pngBase64: await renderOne(word), widthPx: 0, heightPx: 0 });
  }
  return out;
}

/** Batch `/generate` contract (modal/one_dm_app.py). */
async function renderBatch(base: string, styleB64: string, words: string[], signal: AbortSignal): Promise<WordImage[] | null> {
  const res = await fetch(`${base.replace(/\/+$/, "")}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ style_image_b64: styleB64, words }),
    signal
  });
  if (!res.ok) {
    console.warn("[handwritingProvider] non-OK response", res.status);
    return null;
  }
  const json = (await res.json()) as { images_b64?: string[]; sizes?: { w: number; h: number }[] };
  if (!json.images_b64 || json.images_b64.length !== words.length) return null;
  return words.map((w, i) => ({
    word: w,
    pngBase64: json.images_b64![i],
    widthPx: json.sizes?.[i]?.w ?? 0,
    heightPx: json.sizes?.[i]?.h ?? 0
  }));
}
