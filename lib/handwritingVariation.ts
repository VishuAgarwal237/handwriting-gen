/**
 * Per-instance handwriting variation.
 *
 * A neural renderer like One-DM is deterministic: the same style + the same
 * content produce a byte-identical glyph every time, so a worksheet full of
 * "1"s ends up with sixteen identical "1"s — a dead giveaway that no human
 * wrote it. Real handwriting varies every repetition: slant, size, stroke
 * weight, and baseline all drift.
 *
 * This module takes a rendered glyph PNG and an instance seed and applies a
 * small, *deterministic-per-seed* set of transforms so repeated tokens differ
 * without looking damaged. It also lifts the near-white renderer background to
 * transparent so the ink composits cleanly over box outlines and answer lines.
 *
 * Deterministic per seed means a rerun reproduces the same sheet, but two
 * different cells (different seeds) diverge.
 */

import sharp from "sharp";

export type VariationOptions = {
  /** Max absolute rotation in degrees. */
  maxRotationDeg?: number;
  /** Max fractional independent x/y scale jitter (0.05 = ±5%). */
  maxScaleJitter?: number;
  /** Max fractional stroke-weight change via threshold nudge. */
  maxWeightJitter?: number;
  /** Grayscale value at/above which a pixel is treated as background. */
  whiteThreshold?: number;
};

const DEFAULTS = {
  maxRotationDeg: 3,
  maxScaleJitter: 0.06,
  maxWeightJitter: 0.14,
  whiteThreshold: 232
};

/**
 * Returns a varied copy of `png` for instance `seed`. Idempotent per seed.
 */
export async function varyHandwritingPng(png: Buffer, seed: number, opts: VariationOptions = {}): Promise<Buffer> {
  const o = { ...DEFAULTS, ...opts };
  const rnd = mulberry32(seed >>> 0);
  const signed = () => rnd() * 2 - 1;

  const rotation = signed() * o.maxRotationDeg;
  const scaleX = 1 + signed() * o.maxScaleJitter;
  const scaleY = 1 + signed() * o.maxScaleJitter;
  const weight = signed() * o.maxWeightJitter; // + = heavier ink, - = lighter

  // 1. Key the background out so we transform ink on transparency (no white
  //    boxes stamped over the worksheet, and rotation stays clean).
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  // Weight nudge: shift the white cutoff so strokes fatten or thin a little.
  const cutoff = clamp(o.whiteThreshold - weight * 40, 150, 250);
  for (let i = 0; i < width * height; i++) {
    const p = i * channels;
    const lum = (data[p] + data[p + 1] + data[p + 2]) / 3;
    if (lum >= cutoff) {
      data[p + 3] = 0; // background → transparent
    } else if (weight !== 0) {
      // Push kept ink slightly darker/lighter for a subtle weight change.
      const k = clamp(1 - weight * 0.5, 0.6, 1.4);
      data[p] = clamp(data[p] * k, 0, 255);
      data[p + 1] = clamp(data[p + 1] * k, 0, 255);
      data[p + 2] = clamp(data[p + 2] * k, 0, 255);
    }
  }

  const keyed = sharp(data, { raw: { width, height, channels } });

  // 2. Independent x/y scale (changes aspect a touch), then a small rotation
  //    over a transparent canvas.
  const newW = Math.max(1, Math.round(width * scaleX));
  const newH = Math.max(1, Math.round(height * scaleY));
  return keyed
    .resize(newW, newH, { fit: "fill" })
    .rotate(rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

/** Small, fast, seedable PRNG (Mulberry32). */
function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Stable seed for a worksheet cell. Combines the cell's reading order and its
 * content so the same value in two different cells still varies, while a rerun
 * reproduces the sheet.
 */
export function cellSeed(order: number, content: string): number {
  let h = 2166136261 ^ order;
  for (let i = 0; i < content.length; i++) {
    h ^= content.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
