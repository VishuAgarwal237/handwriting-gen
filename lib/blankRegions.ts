/**
 * General, image-based detector for the *blank fillable spaces* on a homework
 * sheet — the successor to the text-layer-only anchor logic in
 * `answerRegions.ts` and the hardcoded arithmetic-bar scan that used to live in
 * the e2e script.
 *
 * It works from a rendered raster of the page, so it generalizes across
 * worksheet types and input formats:
 *   - label / fill-in boxes   (e.g. the "Parts of an Animal Cell" sheet)
 *   - table / grid cells
 *   - answer lines & underscores ("Name: ____", arithmetic answer bars)
 * and it handles scanned image PDFs and plain JP/PNG worksheets that have no
 * text layer at all.
 *
 * Two independent detectors run and their results are merged:
 *
 *   1. Boxes — flood-fill the "paper" (non-ink) inward from the page border.
 *      Any paper the fill can't reach is *enclosed* by ink, i.e. the inside of
 *      a drawn box/cell. Enclosed regions are kept when they are rectangular
 *      (rejects circles/organelles), large enough, and empty inside (rejects a
 *      printed word-bank whose interior is full of text ink).
 *
 *   2. Lines — long, thin horizontal ink runs with clear space above them and
 *      no enclosing box, i.e. answer rules the student writes on top of.
 *
 * All thresholds are expressed relative to the raster size so the same code
 * works at any render resolution. Output regions are in raster-pixel space,
 * with the raster dimensions returned so callers can map to PDF points.
 */

import sharp from "sharp";

export type BlankKind = "box" | "line";

export type BlankRegion = {
  kind: BlankKind;
  /** Fillable-area bounding box, raster-pixel space, top-left origin. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 1-based reading order (top-to-bottom rows, left-to-right within a row). */
  order: number;
};

export type DetectResult = {
  regions: BlankRegion[];
  /** Raster dimensions the regions are expressed in. */
  imageWidth: number;
  imageHeight: number;
};

export type DetectMode =
  /** Boxes when the sheet has any; otherwise underline blanks. (default) */
  | "auto"
  /** Only enclosed empty boxes/cells. */
  | "boxes"
  /** Only underline / fill-in-the-blank rules. */
  | "lines"
  /** Both, unfiltered (useful for debugging). */
  | "both";

export type DetectOptions = {
  /** Grayscale value below which a pixel counts as ink. */
  inkThreshold?: number;
  /** Render/analyze scale applied to the source raster (≥1 sharpens edges). */
  scale?: number;
  /** Which region kinds to detect. Default "auto". */
  mode?: DetectMode;
};

type Comp = { minX: number; minY: number; w: number; h: number; area: number; fill: number };

const DEFAULTS = {
  inkThreshold: 135,
  scale: 2,
  mode: "auto" as DetectMode
};

/**
 * Detects blank fillable regions on a rendered page.
 * @param input a raster (PNG/JPG) as a Buffer, or a filesystem path to one.
 */
export async function detectBlankRegions(input: Buffer | string, opts: DetectOptions = {}): Promise<DetectResult> {
  const o = { ...DEFAULTS, ...opts };
  const src = sharp(input);
  const meta = await src.metadata();
  if (!meta.width || !meta.height) throw new Error("blankRegions: could not read raster dimensions");

  const W = Math.round(meta.width * o.scale);
  const H = Math.round(meta.height * o.scale);
  const { data } = await sharp(input).resize(W, H, { kernel: "cubic" }).greyscale().raw().toBuffer({ resolveWithObject: true });

  const ink = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) ink[i] = data[i] < o.inkThreshold ? 1 : 0;

  const wantBoxes = o.mode === "boxes" || o.mode === "both" || o.mode === "auto";
  const boxes = wantBoxes ? detectBoxes(ink, W, H) : [];

  // In "auto", a sheet is box-based *or* line-based: when it has boxes, stray
  // horizontal runs are structural noise (leader lines, box edges, word-bank
  // rules), so we don't run line detection. Line worksheets have no boxes.
  const wantLines = o.mode === "lines" || o.mode === "both" || (o.mode === "auto" && boxes.length < 2);
  const lines = wantLines ? detectLines(ink, W, H, boxes) : [];

  const regions = orderReading([...boxes, ...lines], H);
  return { regions, imageWidth: W, imageHeight: H };
}

// --- box detection ----------------------------------------------------------

function detectBoxes(ink: Uint8Array, W: number, H: number): BlankRegion[] {
  const N = W * H;

  // 1. Flood-fill paper inward from the border; unreached paper is enclosed.
  const reach = new Uint8Array(N);
  const stack = new Int32Array(N);
  let sp = 0;
  const seed = (idx: number) => {
    if (!ink[idx] && !reach[idx]) { reach[idx] = 1; stack[sp++] = idx; }
  };
  for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
  while (sp > 0) {
    const idx = stack[--sp];
    const x = idx % W, y = (idx / W) | 0;
    if (x + 1 < W) seed(idx + 1);
    if (x - 1 >= 0) seed(idx - 1);
    if (y + 1 < H) seed(idx + W);
    if (y - 1 >= 0) seed(idx - W);
  }

  // 2. Connected-component the enclosed paper.
  const seen = new Uint8Array(N);
  const comps: Comp[] = [];
  for (let start = 0; start < N; start++) {
    if (ink[start] || reach[start] || seen[start]) continue;
    let minX = W, minY = H, maxX = 0, maxY = 0, area = 0;
    sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    while (sp > 0) {
      const idx = stack[--sp];
      const x = idx % W, y = (idx / W) | 0;
      area++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      const push = (n: number) => { if (!ink[n] && !reach[n] && !seen[n]) { seen[n] = 1; stack[sp++] = n; } };
      if (x + 1 < W) push(idx + 1);
      if (x - 1 >= 0) push(idx - 1);
      if (y + 1 < H) push(idx + W);
      if (y - 1 >= 0) push(idx - W);
    }
    const w = maxX - minX + 1, h = maxY - minY + 1;
    comps.push({ minX, minY, w, h, area, fill: area / (w * h) });
  }

  // 3. Keep rectangular, sufficiently-large, empty-inside regions.
  const minArea = 0.0006 * N;
  const minW = Math.max(20, W * 0.02);
  const minH = Math.max(14, H * 0.012);
  const out: BlankRegion[] = [];
  for (const c of comps) {
    if (c.area < minArea || c.w < minW || c.h < minH) continue;
    const aspect = c.w / c.h;
    if (aspect < 0.7 || aspect > 14) continue;
    if (c.fill < 0.85) continue;                 // rectangles only (a circle ≈ 0.79)
    if (interiorInkDensity(ink, W, c) > 0.03) continue; // empty inside (rejects word banks)
    // Inset slightly so handwriting sits inside the outline, not on it.
    const pad = Math.max(2, Math.round(Math.min(c.w, c.h) * 0.06));
    out.push({ kind: "box", x: c.minX + pad, y: c.minY + pad, width: c.w - pad * 2, height: c.h - pad * 2, order: 0 });
  }
  return out;
}

/** Fraction of a box's interior (inset past its outline) that is ink. */
function interiorInkDensity(ink: Uint8Array, W: number, c: Comp): number {
  const inset = Math.max(3, Math.round(Math.min(c.w, c.h) * 0.08));
  const x0 = c.minX + inset, y0 = c.minY + inset;
  const x1 = c.minX + c.w - inset, y1 = c.minY + c.h - inset;
  let dark = 0, tot = 0;
  for (let y = y0; y < y1; y++) {
    const row = y * W;
    for (let x = x0; x < x1; x++) { tot++; if (ink[row + x]) dark++; }
  }
  return tot ? dark / tot : 1;
}

// --- line detection ---------------------------------------------------------

function detectLines(ink: Uint8Array, W: number, H: number, boxes: BlankRegion[]): BlankRegion[] {
  const minLen = Math.max(28, Math.round(W * 0.045));
  const maxLen = Math.round(W * 0.92);
  const maxThick = Math.max(3, Math.round(H * 0.005));
  const topSkip = Math.round(H * 0.02);
  const aboveBand = Math.max(10, Math.round(H * 0.022));

  // Generous suppression around detected boxes so their own outline edges and
  // interiors aren't picked up as underlines.
  const boxMargin = Math.round(H * 0.012);
  const inBox = (x: number, y: number) =>
    boxes.some((b) => x >= b.x - boxMargin && x <= b.x + b.width + boxMargin && y >= b.y - boxMargin && y <= b.y + b.height + boxMargin);

  type Bar = { x1: number; x2: number; y: number };
  const bars: Bar[] = [];
  for (let y = topSkip; y < H - maxThick - 4; y++) {
    let x = 0;
    while (x < W) {
      while (x < W && !ink[y * W + x]) x++;
      const x1 = x;
      while (x < W && ink[y * W + x]) x++;
      const x2 = x - 1;
      const len = x2 - x1 + 1;
      if (len < minLen || len > maxLen) continue;

      const cx = (x1 + x2) >> 1;
      if (inBox(cx, y)) continue;

      // Thin rule: sparse ink just below the run (rejects thick fills / glyphs).
      let below = 0;
      for (let t = 2; t <= maxThick + 3; t++) if (ink[(y + t) * W + cx]) below++;
      if (below > 1) continue;

      // Clear paper in the band above: this is a rule written *on top of*
      // (a fill-in blank), not a leader line crossing the diagram.
      let aboveInk = 0, aboveTot = 0;
      for (let yy = y - aboveBand; yy < y - 1; yy++) {
        if (yy < 0) continue;
        for (let xx = x1; xx <= x2; xx += 2) { aboveTot++; if (ink[yy * W + xx]) aboveInk++; }
      }
      if (aboveTot > 0 && aboveInk / aboveTot > 0.06) continue;

      bars.push({ x1, x2, y });
    }
  }

  // Merge collinear, horizontally-overlapping runs (a rule sampled on adjacent
  // rows, or split where a descender crosses it).
  bars.sort((a, b) => a.y - b.y || a.x1 - b.x1);
  const merged: Bar[] = [];
  for (const bar of bars) {
    const m = merged.find((e) => Math.abs(e.y - bar.y) <= maxThick + 4 && bar.x1 <= e.x2 + minLen && bar.x2 >= e.x1 - minLen);
    if (m) { m.x1 = Math.min(m.x1, bar.x1); m.x2 = Math.max(m.x2, bar.x2); m.y = Math.max(m.y, bar.y); }
    else merged.push({ ...bar });
  }

  const answerH = Math.max(22, Math.round(H * 0.028));
  return merged.map((b) => ({
    kind: "line" as const,
    x: b.x1,
    y: Math.max(0, b.y - answerH),
    width: b.x2 - b.x1 + 1,
    height: answerH,
    order: 0
  }));
}

// --- reading order ----------------------------------------------------------

/** Bands regions into rows (by vertical overlap) then orders left-to-right. */
function orderReading(regions: BlankRegion[], H: number): BlankRegion[] {
  const rowTol = Math.max(12, H * 0.02);
  const sorted = [...regions].sort((a, b) => a.y - b.y);
  const rows: BlankRegion[][] = [];
  for (const r of sorted) {
    const cy = r.y + r.height / 2;
    const row = rows.find((rw) => Math.abs(rw[0].y + rw[0].height / 2 - cy) <= rowTol);
    if (row) row.push(r);
    else rows.push([r]);
  }
  const out: BlankRegion[] = [];
  let n = 0;
  for (const row of rows.sort((a, b) => a[0].y - b[0].y)) {
    for (const r of row.sort((a, b) => a.x - b.x)) out.push({ ...r, order: ++n });
  }
  return out;
}

// --- coordinate mapping -----------------------------------------------------

/** A blank region mapped into pdf-lib's page space (points, bottom-left origin). */
export type PdfBox = { x: number; y: number; width: number; height: number };

/** Maps a pixel-space region onto a PDF page of the given point dimensions. */
export function regionToPdfBox(
  region: BlankRegion,
  imageWidth: number,
  imageHeight: number,
  pageWidthPts: number,
  pageHeightPts: number
): PdfBox {
  const sx = pageWidthPts / imageWidth;
  const sy = pageHeightPts / imageHeight;
  return {
    x: region.x * sx,
    width: region.width * sx,
    // Flip Y: pixel-top-origin → PDF bottom-left origin.
    y: pageHeightPts - (region.y + region.height) * sy,
    height: region.height * sy
  };
}

/** Renders a debug overlay of detected regions onto the source raster. */
export async function drawRegionsOverlay(input: Buffer | string, result: DetectResult, outPath: string): Promise<void> {
  const { imageWidth: W, imageHeight: H, regions } = result;
  const rects = regions.map((r) => {
    const color = r.kind === "box" ? "#e11" : "#1a73e8";
    return `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="none" stroke="${color}" stroke-width="3"/>` +
      `<text x="${r.x + 4}" y="${r.y + 22}" font-size="22" fill="${color}">${r.order}</text>`;
  }).join("");
  await sharp(input).resize(W, H).composite([{ input: Buffer.from(`<svg width="${W}" height="${H}">${rects}</svg>`), top: 0, left: 0 }]).png().toFile(outPath);
}
