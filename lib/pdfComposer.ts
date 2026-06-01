import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { ExtractedAnswer } from "./answerExtractor";
import type { WordImage } from "./handwritingProvider";

const MARGIN = 56;          // points (~0.78")
const LINE_HEIGHT = 36;     // for handwriting
const BODY_FONT_SIZE = 22;
const HEADER_FONT_SIZE = 13;
const QUESTION_GAP = 18;

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
};

export async function composeAnsweredPdf(input: ComposeInput): Promise<Uint8Array> {
  const doc = await PDFDocument.load(input.originalPdf);
  doc.registerFontkit(fontkit);

  const caveatBytes = await loadCaveat();
  const caveat = await doc.embedFont(caveatBytes, { subset: true });
  const helvetica = await doc.embedFont(StandardFonts.HelveticaBold);

  // Match original page size; default to Letter if empty.
  const sample = doc.getPageCount() > 0 ? doc.getPage(0) : null;
  const pageWidth = sample?.getWidth() ?? 612;
  const pageHeight = sample?.getHeight() ?? 792;

  const ctx: LayoutCtx = {
    doc,
    page: doc.addPage([pageWidth, pageHeight]),
    pageWidth,
    pageHeight,
    cursorY: pageHeight - MARGIN,
    caveat,
    helvetica
  };

  drawAnswerPageHeader(ctx);

  for (let i = 0; i < input.answers.length; i++) {
    const a = input.answers[i];
    const wordImages = input.wordImagesByAnswer?.[i] ?? null;
    await drawQuestionBlock(ctx, a, wordImages);
  }

  return doc.save();
}

type LayoutCtx = {
  doc: PDFDocument;
  page: PDFPage;
  pageWidth: number;
  pageHeight: number;
  cursorY: number;
  caveat: PDFFont;
  helvetica: PDFFont;
};

function ensureSpace(ctx: LayoutCtx, needed: number) {
  if (ctx.cursorY - needed < MARGIN) {
    ctx.page = ctx.doc.addPage([ctx.pageWidth, ctx.pageHeight]);
    ctx.cursorY = ctx.pageHeight - MARGIN;
  }
}

function drawAnswerPageHeader(ctx: LayoutCtx) {
  ctx.page.drawText("Handwritten Answers", {
    x: MARGIN,
    y: ctx.cursorY - 18,
    size: 16,
    font: ctx.helvetica,
    color: rgb(0.15, 0.15, 0.18)
  });
  ctx.cursorY -= 36;
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.cursorY },
    end: { x: ctx.pageWidth - MARGIN, y: ctx.cursorY },
    thickness: 0.6,
    color: rgb(0.78, 0.78, 0.82)
  });
  ctx.cursorY -= 24;
}

async function drawQuestionBlock(ctx: LayoutCtx, a: ExtractedAnswer, wordImages: WordImage[] | null) {
  ensureSpace(ctx, LINE_HEIGHT * 2);

  // Question header
  ctx.page.drawText(`Question ${a.number}`, {
    x: MARGIN,
    y: ctx.cursorY,
    size: HEADER_FONT_SIZE,
    font: ctx.helvetica,
    color: rgb(0.35, 0.35, 0.4)
  });
  ctx.cursorY -= HEADER_FONT_SIZE + 8;

  if (wordImages && wordImages.length > 0) {
    await drawHandwrittenWordImages(ctx, wordImages);
  } else {
    drawHandwrittenText(ctx, a.answer);
  }
  ctx.cursorY -= QUESTION_GAP;
}

function drawHandwrittenText(ctx: LayoutCtx, text: string) {
  if (!text.trim()) {
    ctx.page.drawText("(no answer)", {
      x: MARGIN,
      y: ctx.cursorY,
      size: BODY_FONT_SIZE,
      font: ctx.caveat,
      color: rgb(0.65, 0.65, 0.7)
    });
    ctx.cursorY -= LINE_HEIGHT;
    return;
  }
  const maxWidth = ctx.pageWidth - MARGIN * 2;
  const lines = wrapText(text, ctx.caveat, BODY_FONT_SIZE, maxWidth);
  for (const line of lines) {
    ensureSpace(ctx, LINE_HEIGHT);
    ctx.page.drawText(line, {
      x: MARGIN,
      y: ctx.cursorY,
      size: BODY_FONT_SIZE,
      font: ctx.caveat,
      color: rgb(0.08, 0.1, 0.18)
    });
    ctx.cursorY -= LINE_HEIGHT;
  }
}

async function drawHandwrittenWordImages(ctx: LayoutCtx, words: WordImage[]) {
  const maxWidth = ctx.pageWidth - MARGIN * 2;
  const targetHeight = 32; // points
  const spaceWidth = 8;
  let x = MARGIN;
  let lineMaxH = 0;
  const embeddedCache = new Map<string, PDFImage>();

  for (const w of words) {
    const cacheKey = w.pngBase64.slice(0, 64);
    let img = embeddedCache.get(cacheKey);
    if (!img) {
      const bytes = Buffer.from(w.pngBase64, "base64");
      img = await ctx.doc.embedPng(bytes);
      embeddedCache.set(cacheKey, img);
    }
    const aspect = img.width / img.height;
    const drawH = targetHeight;
    const drawW = drawH * aspect;
    if (x + drawW > MARGIN + maxWidth) {
      ctx.cursorY -= Math.max(lineMaxH, LINE_HEIGHT);
      x = MARGIN;
      lineMaxH = 0;
      ensureSpace(ctx, drawH + 4);
    }
    ensureSpace(ctx, drawH + 4);
    ctx.page.drawImage(img, { x, y: ctx.cursorY - drawH + 4, width: drawW, height: drawH });
    x += drawW + spaceWidth;
    lineMaxH = Math.max(lineMaxH, drawH + 6);
  }
  ctx.cursorY -= Math.max(lineMaxH, LINE_HEIGHT);
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const paragraphs = text.split(/\n+/);
  const out: string[] = [];
  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = "";
    for (const w of words) {
      const candidate = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth) {
        if (line) out.push(line);
        line = w;
      } else {
        line = candidate;
      }
    }
    if (line) out.push(line);
    if (paragraphs.length > 1) out.push(""); // paragraph break
  }
  return out;
}
