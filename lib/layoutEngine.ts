/**
 * Handwriting placement engine.
 *
 * Pure geometry: given page dimensions, a text-measuring function, and a stream
 * of blocks (a header plus either word-image tokens or fallback text), it emits
 * absolutely-positioned draw commands and a page count. It knows nothing about
 * pdf-lib — the composer embeds fonts/images and executes the commands.
 *
 * Coordinate space: top-left origin, y grows downward. `yBaseline` is the text
 * baseline measured from the top of the page. Word images sit their bottom edge
 * on that baseline so mixed-height words share one straight baseline. The
 * composer flips into pdf-lib's bottom-left space with `pageHeight - y`.
 */

export type WordToken = {
  /** Stable key the composer uses to look up the embedded image. */
  imageKey: string;
  /** Intrinsic pixel dimensions of the rendered word (from the embedded PNG). */
  imgW: number;
  imgH: number;
};

export type Block = {
  /** e.g. "Question 3" */
  header: string;
  /** Word images when the ML model produced them, else null. */
  words: WordToken[] | null;
  /** Plaintext used when `words` is null. */
  fallbackText: string;
};

export type Geometry = {
  pageWidth: number;
  pageHeight: number;
  margin: number;
};

export type Style = {
  lineHeight: number;
  bodyFontSize: number;
  headerFontSize: number;
  titleFontSize: number;
  questionGap: number;
  paragraphGap: number;
  spaceWidth: number;
  /** Target cap height for a word image, in points. */
  wordTargetHeight: number;
};

export type TextRole = "title" | "header" | "body" | "muted";

export type DrawCommand =
  | { type: "text"; page: number; x: number; yBaseline: number; text: string; size: number; role: TextRole }
  | { type: "image"; page: number; x: number; yBaseline: number; width: number; height: number; imageKey: string }
  | { type: "hline"; page: number; x1: number; x2: number; y: number };

export type LayoutResult = {
  commands: DrawCommand[];
  pageCount: number;
};

/** Measures the width of `text` at `size` in points (injected from pdf-lib). */
export type MeasureText = (text: string, size: number) => number;

export const DEFAULT_STYLE: Style = {
  lineHeight: 36,
  bodyFontSize: 22,
  headerFontSize: 13,
  titleFontSize: 16,
  questionGap: 18,
  paragraphGap: 12,
  spaceWidth: 8,
  wordTargetHeight: 30
};

export class LayoutEngine {
  private readonly geom: Geometry;
  private readonly style: Style;
  private readonly measure: MeasureText;
  private readonly commands: DrawCommand[] = [];

  private page = 0;
  /** Baseline of the most-recently placed line, measured from the page top. */
  private y: number;

  constructor(geom: Geometry, style: Style, measure: MeasureText) {
    this.geom = geom;
    this.style = style;
    this.measure = measure;
    // Start one line-height above the top margin so the first `newLine` lands
    // the first baseline just inside the margin.
    this.y = geom.margin;
  }

  private get contentWidth(): number {
    return this.geom.pageWidth - this.geom.margin * 2;
  }

  private get bottomLimit(): number {
    return this.geom.pageHeight - this.geom.margin;
  }

  /**
   * Advances to the next baseline. `advance` is the vertical step from the
   * current baseline; `descent` is how far content on the new line extends
   * below the baseline (used only for the page-break check). Breaks to a new
   * page when the line would spill past the bottom margin.
   */
  private newLine(advance: number, descent = 0): number {
    let next = this.y + advance;
    if (next + descent > this.bottomLimit) {
      this.page += 1;
      next = this.geom.margin + advance;
    }
    this.y = next;
    return next;
  }

  addTitle(text: string): void {
    const { titleFontSize } = this.style;
    const baseline = this.newLine(titleFontSize);
    this.commands.push({
      type: "text",
      page: this.page,
      x: this.geom.margin,
      yBaseline: baseline,
      text,
      size: titleFontSize,
      role: "title"
    });
    // Rule under the title, then breathing room before the first block.
    this.y += 14;
    this.commands.push({
      type: "hline",
      page: this.page,
      x1: this.geom.margin,
      x2: this.geom.pageWidth - this.geom.margin,
      y: this.y
    });
    this.y += 20;
  }

  addBlock(block: Block): void {
    const { headerFontSize, questionGap } = this.style;

    const headerBaseline = this.newLine(headerFontSize + 12, headerFontSize * 0.3);
    this.commands.push({
      type: "text",
      page: this.page,
      x: this.geom.margin,
      yBaseline: headerBaseline,
      text: block.header,
      size: headerFontSize,
      role: "header"
    });

    if (block.words && block.words.length > 0) {
      this.layoutWords(block.words);
    } else {
      this.layoutText(block.fallbackText);
    }

    this.y += questionGap;
  }

  finish(): LayoutResult {
    return { commands: this.commands, pageCount: this.page + 1 };
  }

  // --- internals ---------------------------------------------------------

  private layoutText(text: string): void {
    const { lineHeight, bodyFontSize } = this.style;
    const trimmed = text.trim();
    if (!trimmed) {
      const baseline = this.newLine(lineHeight, bodyFontSize * 0.25);
      this.commands.push({
        type: "text",
        page: this.page,
        x: this.geom.margin,
        yBaseline: baseline,
        text: "(no answer)",
        size: bodyFontSize,
        role: "muted"
      });
      return;
    }

    const lines = this.wrap(trimmed, bodyFontSize);
    for (const line of lines) {
      if (line === "") {
        // Paragraph break: a short vertical gap rather than a full empty line.
        this.y += this.style.paragraphGap;
        continue;
      }
      const baseline = this.newLine(lineHeight, bodyFontSize * 0.25);
      this.commands.push({
        type: "text",
        page: this.page,
        x: this.geom.margin,
        yBaseline: baseline,
        text: line,
        size: bodyFontSize,
        role: "body"
      });
    }
  }

  private layoutWords(words: WordToken[]): void {
    const { lineHeight, wordTargetHeight, spaceWidth } = this.style;
    const maxWidth = this.contentWidth;
    const left = this.geom.margin;

    let x = left;
    let lineMaxHeight = 0;
    // First row of words for this block.
    let baseline = this.newLine(lineHeight, wordTargetHeight * 0.35);

    for (const w of words) {
      const aspect = w.imgW > 0 && w.imgH > 0 ? w.imgW / w.imgH : 3;
      let height = wordTargetHeight;
      let width = height * aspect;
      // Scale a too-wide word down to the column, preserving aspect ratio.
      if (width > maxWidth) {
        width = maxWidth;
        height = width / aspect;
      }

      // Wrap when the word would cross the right margin (but never leave a row
      // empty — an oversized first word just occupies its own row).
      if (x > left && x + width > left + maxWidth) {
        baseline = this.newLine(Math.max(lineHeight, lineMaxHeight + 6), wordTargetHeight * 0.35);
        x = left;
        lineMaxHeight = 0;
      }

      this.commands.push({
        type: "image",
        page: this.page,
        x,
        yBaseline: baseline,
        width,
        height,
        imageKey: w.imageKey
      });

      x += width + spaceWidth;
      lineMaxHeight = Math.max(lineMaxHeight, height);
    }
  }

  /** Greedy word-wrap; blank strings mark paragraph boundaries. */
  private wrap(text: string, size: number): string[] {
    return wrapText(text, size, this.contentWidth, this.measure);
  }
}

/** Greedy word-wrap; blank strings mark paragraph boundaries. */
export function wrapText(
  text: string,
  size: number,
  maxWidth: number,
  measure: MeasureText
): string[] {
  const paragraphs = text.split(/\n+/);
  const out: string[] = [];
  for (let p = 0; p < paragraphs.length; p++) {
    const words = paragraphs[p].split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && measure(candidate, size) > maxWidth) {
        out.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) out.push(line);
    if (p < paragraphs.length - 1) out.push(""); // paragraph break marker
  }
  return out;
}

// --- In-place, region-bounded layout ---------------------------------------

export type Rect = {
  /** Target page index (an existing homework page). */
  page: number;
  /** Top-left of the region, in from-page-top coordinates (y grows downward). */
  xLeft: number;
  yTop: number;
  width: number;
  height: number;
};

export type RegionBlock = {
  words: WordToken[] | null;
  fallbackText: string;
};

export type RegionResult = {
  /** Draw commands (from-top coords, `page` = rect.page). Empty if it can't fit. */
  commands: DrawCommand[];
  /** True when the answer fit inside the rect at some legible scale. */
  fits: boolean;
  /** The scale actually used (1 = full size). */
  scale: number;
};

const MIN_REGION_SCALE = 0.55;
const REGION_SCALE_STEP = 0.05;

/**
 * Lays a single answer into `rect`, shrinking uniformly (down to
 * MIN_REGION_SCALE) so it fits vertically. Returns `fits: false` with no
 * commands when even the smallest legible scale overflows — the caller then
 * routes that answer to an appended overflow page instead.
 */
export function layoutBlockInRect(
  block: RegionBlock,
  rect: Rect,
  style: Style,
  measure: MeasureText
): RegionResult {
  for (let scale = 1; scale >= MIN_REGION_SCALE - 1e-9; scale -= REGION_SCALE_STEP) {
    const attempt = emitRegion(block, rect, style, measure, scale);
    // Must fit both ways: a long single word (e.g. "Cell membrane") can't be
    // wrapped, so it only stops overflowing the box once the scale shrinks it.
    if (attempt.bottom <= rect.yTop + rect.height + 0.5 && attempt.right <= rect.xLeft + rect.width + 0.5) {
      return { commands: attempt.commands, fits: true, scale };
    }
  }
  return { commands: [], fits: false, scale: MIN_REGION_SCALE };
}

function emitRegion(
  block: RegionBlock,
  rect: Rect,
  style: Style,
  measure: MeasureText,
  scale: number
): { commands: DrawCommand[]; bottom: number; right: number } {
  const bodyFontSize = style.bodyFontSize * scale;
  const lineHeight = style.lineHeight * scale;
  const paragraphGap = style.paragraphGap * scale;
  const wordTargetHeight = style.wordTargetHeight * scale;
  const spaceWidth = style.spaceWidth * scale;

  const commands: DrawCommand[] = [];
  const left = rect.xLeft;
  const maxWidth = rect.width;
  let bottom = rect.yTop;
  let right = rect.xLeft;

  if (block.words && block.words.length > 0) {
    let x = left;
    let baseline = rect.yTop + wordTargetHeight; // first row: tallest word top at yTop
    let rowMax = 0;
    for (const w of block.words) {
      const aspect = w.imgW > 0 && w.imgH > 0 ? w.imgW / w.imgH : 3;
      let height = wordTargetHeight;
      let width = height * aspect;
      if (width > maxWidth) {
        width = maxWidth;
        height = width / aspect;
      }
      if (x > left && x + width > left + maxWidth) {
        baseline += Math.max(lineHeight, rowMax + 6 * scale);
        x = left;
        rowMax = 0;
      }
      commands.push({ type: "image", page: rect.page, x, yBaseline: baseline, width, height, imageKey: w.imageKey });
      right = Math.max(right, x + width);
      x += width + spaceWidth;
      rowMax = Math.max(rowMax, height);
      bottom = Math.max(bottom, baseline + height * 0.15);
    }
  } else {
    const text = block.fallbackText.trim();
    if (!text) return { commands, bottom, right };
    const lines = wrapText(text, bodyFontSize, maxWidth, measure);
    let baseline = rect.yTop + bodyFontSize;
    let first = true;
    for (const line of lines) {
      if (line === "") {
        baseline += paragraphGap;
        continue;
      }
      if (!first) baseline += lineHeight;
      first = false;
      commands.push({ type: "text", page: rect.page, x: left, yBaseline: baseline, text: line, size: bodyFontSize, role: "body" });
      right = Math.max(right, left + measure(line, bodyFontSize));
      bottom = Math.max(bottom, baseline + bodyFontSize * 0.25);
    }
  }

  return { commands, bottom, right };
}
