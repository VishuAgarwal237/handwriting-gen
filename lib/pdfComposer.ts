import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { ExtractedAnswer } from "./answerExtractor";
import type { WordImage } from "./handwritingProvider";
import {
  LayoutEngine,
  DEFAULT_STYLE,
  layoutBlockInRect,
  type Block,
  type DrawCommand,
  type Geometry,
  type Rect,
  type TextRole,
  type WordToken
} from "./layoutEngine";
import { extractPageText } from "./pdfAnchors";
import { findAnswerRegions } from "./answerRegions";
import { detectBlankRegions } from "./blankRegions";
import { rasterizePdfPages } from "./pageRaster";
import { varyHandwritingPng, cellSeed } from "./handwritingVariation";

const MARGIN = 56; // points (~0.78")

const ROLE_COLOR: Record<TextRole, ReturnType<typeof rgb>> = {
  title: rgb(0.15, 0.15, 0.18),
  header: rgb(0.35, 0.35, 0.4),
  body: rgb(0.08, 0.1, 0.18),
  muted: rgb(0.65, 0.65, 0.7)
};

let cachedCaveat: Uint8Array | null = null;
async function loadCaveat(): Promise<Uint8Array> {
  if (cachedCaveat) return cachedCaveat;
  const p = path.join(process.cwd(), "public", "fonts", "Caveat-Regular.ttf");
  cachedCaveat = await fs.readFile(p);
  return cachedCaveat;
}

export type ComposeInput = {
  originalPdf: Buffer;
  answers: ExtractedAnswer[];
  /** Optional pre-rendered handwriting word images keyed by answer index. */
  wordImagesByAnswer?: (WordImage[] | null)[];
  /**
   * When true (default), answers are written into the blank space of the
   * original homework next to each question, falling back to an appended
   * "Handwritten Answers" page only for answers we can't place. Set false to
   * force the append-only behavior.
   */
  inPlace?: boolean;
  /**
   * When true (default), each placed word image gets a small, deterministic
   * per-instance transform so repeated tokens (all the "1"s, "8"s, …) aren't
   * byte-identical. Set false to disable (e.g. for golden-image tests).
   */
  variation?: boolean;
};

export type ComposeResult = {
  pdf: Uint8Array;
  /** How many answers landed in-place vs. on the appended overflow page. */
  placedInPlace: number;
  appended: number;
};

export async function composeAnsweredPdf(input: ComposeInput): Promise<Uint8Array> {
  return (await composeAnsweredPdfDetailed(input)).pdf;
}

export async function composeAnsweredPdfDetailed(input: ComposeInput): Promise<ComposeResult> {
  const doc = await PDFDocument.load(input.originalPdf);
  doc.registerFontkit(fontkit);

  const caveatBytes = await loadCaveat();
  const caveat = await doc.embedFont(caveatBytes, { subset: false });
  const helvetica = await doc.embedFont(StandardFonts.HelveticaBold);

  // Match original page size; default to Letter if empty.
  const sample = doc.getPageCount() > 0 ? doc.getPage(0) : null;
  const pageWidth = sample?.getWidth() ?? 612;
  const pageHeight = sample?.getHeight() ?? 792;

  // --- Pass 1: vary + embed every word image, keyed per placement instance. -
  // Each (answer, word) is embedded independently — no cross-instance dedupe —
  // because a deterministic renderer emits identical bytes for a repeated token
  // and we *want* every instance to differ. `variation` (default on) applies a
  // small per-instance transform seeded by the token's position + content.
  const applyVariation = input.variation !== false;
  const imageByKey = new Map<string, PDFImage>();
  const blocks: Block[] = [];

  for (let i = 0; i < input.answers.length; i++) {
    const answer = input.answers[i];
    const rawWords = input.wordImagesByAnswer?.[i] ?? null;

    let words: WordToken[] | null = null;
    if (rawWords && rawWords.length > 0) {
      words = [];
      for (let w = 0; w < rawWords.length; w++) {
        const wi = rawWords[w];
        let png: Buffer = Buffer.from(wi.pngBase64, "base64");
        if (applyVariation) {
          png = await varyHandwritingPng(png, cellSeed(i * 1024 + w, wi.word));
        }
        const img = await doc.embedPng(png);
        imageByKey.set(`${i}:${w}`, img);
        words.push({ imageKey: `${i}:${w}`, imgW: img.width, imgH: img.height });
      }
    }

    blocks.push({
      header: `Question ${answer.number}`,
      words,
      fallbackText: answer.answer
    });
  }

  const measure = (text: string, size: number) => caveat.widthOfTextAtSize(text, size);
  const deps: DrawDeps = { caveat, helvetica, imageByKey };

  // --- Pass 2a: in-place placement onto the original homework. --------------
  // Any answer we place here is removed from the overflow set below.
  const placed = new Set<number>();
  if (input.inPlace !== false) {
    const pageText = await extractPageText(input.originalPdf);
    if (pageText.length > 0) {
      const matches = findAnswerRegions(pageText, input.answers);
      for (const match of matches) {
        if (!match.rect) continue;
        const originalPage = doc.getPage(match.rect.page);
        if (!originalPage) continue;
        const block = blocks[match.answerIndex];
        const result = layoutBlockInRect(
          { words: block.words, fallbackText: block.fallbackText },
          match.rect,
          DEFAULT_STYLE,
          measure
        );
        if (!result.fits) continue;
        const ph = originalPage.getHeight();
        for (const cmd of result.commands) execCommand(originalPage, ph, cmd, deps);
        placed.add(match.answerIndex);
      }
    }

    // --- Pass 2a-image: fallback for worksheets the text layer can't anchor --
    // (scans, exported images, label/fill sheets like "Parts of an Animal
    // Cell"). Only runs when the text-anchor pass placed nothing, so it never
    // fights the anchor path on ordinary numbered word problems. Rasterizes the
    // pages, detects blank boxes/lines, and drops the answers into them in
    // reading order. No-ops if Poppler isn't available.
    if (placed.size === 0 && blocks.length > 0) {
      const rects = await detectRegionRects(input.originalPdf, doc);
      let ri = 0;
      for (let ai = 0; ai < blocks.length && ri < rects.length; ai++) {
        const rect = rects[ri++];
        const originalPage = doc.getPage(rect.page);
        if (!originalPage) continue;
        const block = blocks[ai];
        const result = layoutBlockInRect(
          { words: block.words, fallbackText: block.fallbackText },
          rect,
          DEFAULT_STYLE,
          measure
        );
        if (!result.fits) continue;
        const ph = originalPage.getHeight();
        for (const cmd of result.commands) execCommand(originalPage, ph, cmd, deps);
        placed.add(ai);
      }
    }
  }

  // --- Pass 2b: appended overflow page(s) for everything not placed. --------
  const overflow = blocks.filter((_, i) => !placed.has(i));
  if (overflow.length > 0) {
    const geom: Geometry = { pageWidth, pageHeight, margin: MARGIN };
    const engine = new LayoutEngine(geom, DEFAULT_STYLE, measure);
    engine.addTitle(placed.size > 0 ? "Additional Answers" : "Handwritten Answers");
    for (const block of overflow) engine.addBlock(block);
    const { commands, pageCount } = engine.finish();

    const pages: PDFPage[] = [];
    for (let i = 0; i < pageCount; i++) pages.push(doc.addPage([pageWidth, pageHeight]));
    for (const cmd of commands) {
      const page = pages[cmd.page];
      if (!page) continue;
      execCommand(page, pageHeight, cmd, deps);
    }
  }

  return {
    pdf: await doc.save(),
    placedInPlace: placed.size,
    appended: overflow.length
  };
}

type DrawDeps = {
  caveat: PDFFont;
  helvetica: PDFFont;
  imageByKey: Map<string, PDFImage>;
};

/**
 * Rasterizes the homework, detects blank fillable regions on every page, and
 * returns them as layout `Rect`s (from-page-top coords) in reading order across
 * pages. Empty when Poppler is unavailable — the caller then falls back to the
 * appended overflow page.
 */
async function detectRegionRects(pdf: Buffer, doc: PDFDocument): Promise<Rect[]> {
  const rasters = await rasterizePdfPages(pdf);
  if (!rasters) return [];

  const rects: Rect[] = [];
  for (const raster of rasters) {
    const page = doc.getPage(raster.pageIndex);
    if (!page) continue;
    const detection = await detectBlankRegions(raster.png, { mode: "auto" });
    if (detection.regions.length === 0) continue;
    const sx = page.getWidth() / detection.imageWidth;
    const sy = page.getHeight() / detection.imageHeight;
    for (const region of detection.regions) {
      rects.push({
        page: raster.pageIndex,
        xLeft: region.x * sx,
        yTop: region.y * sy, // detector uses top-left origin, same as Rect
        width: region.width * sx,
        height: region.height * sy
      });
    }
  }
  return rects;
}

function execCommand(page: PDFPage, pageHeight: number, cmd: DrawCommand, deps: DrawDeps) {
  switch (cmd.type) {
    case "text": {
      const font = cmd.role === "body" || cmd.role === "muted" ? deps.caveat : deps.helvetica;
      page.drawText(cmd.text, {
        x: cmd.x,
        y: pageHeight - cmd.yBaseline,
        size: cmd.size,
        font,
        color: ROLE_COLOR[cmd.role]
      });
      break;
    }
    case "image": {
      const img = deps.imageByKey.get(cmd.imageKey);
      if (!img) break;
      // yBaseline is the baseline from the top; the word sits its bottom on it.
      page.drawImage(img, {
        x: cmd.x,
        y: pageHeight - cmd.yBaseline,
        width: cmd.width,
        height: cmd.height
      });
      break;
    }
    case "hline": {
      page.drawLine({
        start: { x: cmd.x1, y: pageHeight - cmd.y },
        end: { x: cmd.x2, y: pageHeight - cmd.y },
        thickness: 0.6,
        color: rgb(0.78, 0.78, 0.82)
      });
      break;
    }
  }
}
