/**
 * Seam for the One-DM (or any) ML handwriting model.
 *
 * Today this returns `null`, which signals the composer to use the embedded
 * handwriting font fallback. When the Modal endpoint is deployed, set
 * `HANDWRITING_SERVICE_URL` in `.env.local` and this will POST to it.
 *
 * Contract with the Modal app (see `modal/one_dm_app.py`):
 *   POST {service}/generate
 *   body: { style_image_b64: string, words: string[] }
 *   response: { images_b64: string[], mime: "image/png" }
 *
 * One-DM generates one word at a time, so the request batches words. The
 * composer is responsible for laying them out on the page.
 */

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

export async function generateHandwritingWords(opts: GenerateOptions): Promise<WordImage[] | null> {
  const base = process.env.HANDWRITING_SERVICE_URL?.trim();
  if (!base) return null;

  const styleB64 = opts.styleImageDataUrl.split(",")[1] ?? "";
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  if (opts.signal) opts.signal.addEventListener("abort", () => ac.abort());

  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ style_image_b64: styleB64, words: opts.words }),
      signal: ac.signal
    });
    if (!res.ok) {
      console.warn("[handwritingProvider] non-OK response", res.status);
      return null;
    }
    const json = (await res.json()) as {
      images_b64?: string[];
      sizes?: { w: number; h: number }[];
    };
    if (!json.images_b64 || json.images_b64.length !== opts.words.length) return null;
    return opts.words.map((w, i) => ({
      word: w,
      pngBase64: json.images_b64![i],
      widthPx: json.sizes?.[i]?.w ?? 0,
      heightPx: json.sizes?.[i]?.h ?? 0
    }));
  } catch (err) {
    console.warn("[handwritingProvider] error, falling back to font", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
