/**
 * Text-geometry extraction for the original homework PDF.
 *
 * pdf-lib can draw onto existing pages but cannot read where the text is, so we
 * use pdfjs to pull every text run with its position. Coordinates are returned
 * in PDF user space (points, bottom-left origin) — the same space pdf-lib draws
 * in — so an item's (x, y) can be handed straight to `page.drawText/drawImage`
 * for an un-rotated page.
 *
 * Runs Node-side only (the render-handwriting API route is `runtime = nodejs`).
 */

// Legacy build is CommonJS/UMD and works in Node without a DOM/canvas for the
// text-content path we use here.
// eslint-disable-next-line @typescript-eslint/no-var-requires
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.js";

// No worker in Node: run everything on the main thread.
(pdfjsLib as unknown as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc = "";

export type TextRun = {
  str: string;
  /** Baseline left, PDF user space (bottom-left origin). */
  x: number;
  y: number;
  /** Advance width and font height in points. */
  width: number;
  height: number;
};

export type PageText = {
  pageIndex: number;
  width: number;
  height: number;
  rotation: number;
  runs: TextRun[];
};

/**
 * Extracts positioned text for every page. Returns [] and never throws on a
 * malformed/scanned PDF — callers should treat an empty result as "fall back
 * to appended pages".
 */
export async function extractPageText(pdf: Buffer): Promise<PageText[]> {
  try {
    const doc = await pdfjsLib.getDocument({
      data: new Uint8Array(pdf),
      // Keep it lean and quiet in a server context.
      isEvalSupported: false,
      useSystemFonts: false
    }).promise;

    const pages: PageText[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      const [, , vw, vh] = viewport.viewBox; // [x0, y0, x1, y1] in PDF points
      const content = await page.getTextContent();

      const runs: TextRun[] = [];
      for (const item of content.items) {
        // TextItem has str/transform/width/height; TextMarkedContent does not.
        if (!("str" in item) || !("transform" in item)) continue;
        const t = item.transform as number[]; // [a, b, c, d, e, f]
        const str = item.str;
        if (!str || !str.trim()) continue;
        runs.push({
          str,
          x: t[4],
          y: t[5],
          width: (item as { width?: number }).width ?? 0,
          height: (item as { height?: number }).height ?? Math.hypot(t[2], t[3])
        });
      }

      pages.push({
        pageIndex: i - 1,
        width: vw,
        height: vh,
        rotation: (page.rotate ?? 0) % 360,
        runs
      });
      page.cleanup();
    }
    await doc.destroy();
    return pages;
  } catch (err) {
    console.warn("[pdfAnchors] text extraction failed, falling back", err);
    return [];
  }
}

/**
 * Groups a page's runs into visual lines (same baseline within a tolerance),
 * left-to-right. Useful for anchor detection and column bounds.
 */
export type TextLine = {
  y: number;      // baseline
  x: number;      // leftmost run x
  right: number;  // rightmost run x + width
  height: number; // max run height
  text: string;   // concatenated, single-spaced
  runs: TextRun[];
};

export function groupLines(page: PageText, yTolerance = 3): TextLine[] {
  const sorted = [...page.runs].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: TextLine[] = [];
  for (const run of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - run.y) <= yTolerance) {
      last.runs.push(run);
    } else {
      lines.push({ y: run.y, x: run.x, right: run.x + run.width, height: run.height, text: "", runs: [run] });
    }
  }
  for (const line of lines) {
    line.runs.sort((a, b) => a.x - b.x);
    line.x = line.runs[0].x;
    line.right = Math.max(...line.runs.map((r) => r.x + r.width));
    line.height = Math.max(...line.runs.map((r) => r.height));
    line.text = line.runs.map((r) => r.str).join(" ").replace(/\s+/g, " ").trim();
  }
  return lines;
}
