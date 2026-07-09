/**
 * Rasterizes PDF pages to PNG so the image-based blank detector
 * (`lib/blankRegions.ts`) can run on worksheets with no text layer (scans,
 * exported images, label/fill sheets).
 *
 * This build's libvips/sharp can't decode PDFs and `canvas` isn't installed, so
 * we shell out to Poppler's `pdftoppm`. That's a system binary, not an npm
 * dependency: it's present on the dev machine and typical Linux servers, but
 * may be absent in a locked-down serverless runtime. When it's missing (or
 * anything fails) we return `null` and the caller degrades to its existing
 * text-layer / appended-page behavior — the feature is additive, never a
 * hard dependency.
 *
 * Runs Node-side only (the render-handwriting route is `runtime = "nodejs"`).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const exec = promisify(execFile);

export type PageRaster = {
  pageIndex: number;
  /** PNG bytes of the rendered page. */
  png: Buffer;
  /** Raster pixel dimensions. */
  width: number;
  height: number;
};

let cachedAvailable: boolean | null = null;

/** True if `pdftoppm` can be invoked. Cached after the first probe. */
export async function rasterizerAvailable(): Promise<boolean> {
  if (cachedAvailable !== null) return cachedAvailable;
  try {
    await exec("pdftoppm", ["-v"]);
    cachedAvailable = true;
  } catch {
    cachedAvailable = false;
  }
  return cachedAvailable;
}

/**
 * Renders every page of `pdf` to a PNG at `dpi`. Returns `null` (never throws)
 * when Poppler is unavailable or rendering fails, so callers can fall back.
 */
export async function rasterizePdfPages(pdf: Buffer, dpi = 150): Promise<PageRaster[] | null> {
  if (!(await rasterizerAvailable())) return null;

  let dir: string | null = null;
  try {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "inkwell-raster-"));
    const inPdf = path.join(dir, "in.pdf");
    await fs.writeFile(inPdf, pdf);
    // `pdftoppm [opts] <pdf> <prefix>` emits <prefix>-<n>.png per page.
    await exec("pdftoppm", ["-png", "-r", String(dpi), inPdf, path.join(dir, "page")], {
      maxBuffer: 64 * 1024 * 1024
    });
    return await collect(dir);
  } catch (err) {
    console.warn("[pageRaster] rasterization failed, falling back", err);
    return null;
  } finally {
    if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function collect(dir: string): Promise<PageRaster[]> {
  // Lazy import to keep sharp out of the module's import cost until used.
  const sharp = (await import("sharp")).default;
  const files = (await fs.readdir(dir))
    .filter((f) => /^page-\d+\.png$/.test(f))
    .sort((a, b) => pageNum(a) - pageNum(b));

  const out: PageRaster[] = [];
  for (let i = 0; i < files.length; i++) {
    const png = await fs.readFile(path.join(dir, files[i]));
    const meta = await sharp(png).metadata();
    out.push({ pageIndex: i, png, width: meta.width ?? 0, height: meta.height ?? 0 });
  }
  return out;
}

function pageNum(f: string): number {
  const m = f.match(/-(\d+)\.png$/);
  return m ? parseInt(m[1], 10) : 0;
}
