/**
 * Finds, for each extracted answer, the blank region on the original homework
 * where its handwriting should go.
 *
 * Matching is content-first, not number-first: the LaTeX numbering GPT emits is
 * not guaranteed to line up with the homework's, so we compare each answer's
 * restated question text against the *printed* question text near each anchor
 * and assign by best textual overlap. The question number is only a fallback
 * (and a tiebreaker) used when there isn't enough text to compare. Assignment is
 * one-to-one and greedy, so the strongest matches claim their spots first and a
 * weak number match can never steal an anchor a content match wanted.
 *
 * Anything we can't place confidently is returned as a miss so the composer can
 * fall back to an appended page.
 */

import type { PageText, TextLine } from "./pdfAnchors";
import { groupLines } from "./pdfAnchors";
import type { ExtractedAnswer } from "./answerExtractor";
import type { Rect } from "./layoutEngine";

/** Vertical space (pt) an answer needs before we bother placing it in-line. */
const MIN_REGION_HEIGHT = 26;
/** Padding kept between the question text / next anchor and the answer. */
const GAP = 6;
/** Bottom margin used when an anchor is the last on its page. */
const PAGE_BOTTOM_MARGIN = 48;
/** Minimum token containment (|∩| / smaller set) to trust a content match. */
const CONTENT_THRESHOLD = 0.34;

type Anchor = {
  number: string;
  pageIndex: number;
  /** Baseline y (PDF space, bottom-left origin) of the anchor line. */
  y: number;
  x: number;
  height: number;
};

type AnchorRegion = {
  anchor: Anchor;
  /** Printed question text near the anchor, used for content matching. */
  questionText: string;
  /** Lowest question-text baseline (top of the blank space). */
  lowestQuestionY: number;
  rect: Rect | null;
};

// Ordered from most to least specific so "Problem 3" isn't misread as sub-part.
const ANCHOR_PATTERNS: { re: RegExp; group: number }[] = [
  { re: /^\s*(?:problem|question|exercise|prob|ques)\s*#?\s*([0-9]+)\b/i, group: 1 },
  { re: /^\s*([0-9]+)\s*[.)]\s*/, group: 1 },
  { re: /^\s*\(\s*([0-9]+)\s*\)\s*/, group: 1 }
];

function matchAnchor(text: string): string | null {
  for (const { re, group } of ANCHOR_PATTERNS) {
    const m = text.match(re);
    if (m) return m[group];
  }
  return null;
}

export type RegionMatch = {
  answerIndex: number;
  rect: Rect | null;
  /** How the answer was matched to its spot (for diagnostics / notes). */
  matchedBy?: "content" | "number";
  /** Content-overlap score of the winning match, 0..1. */
  confidence?: number;
};

/**
 * @param pages positioned text from `extractPageText`
 * @param answers extracted answers, each with its restated `question` text
 * @returns one entry per answer; `rect` is null when no confident region exists
 */
export function findAnswerRegions(pages: PageText[], answers: ExtractedAnswer[]): RegionMatch[] {
  // 1. Collect anchors across all pages, in reading order.
  const anchors: Anchor[] = [];
  const linesByPage = new Map<number, TextLine[]>();
  for (const page of pages) {
    const lines = groupLines(page); // top-to-bottom (y descending)
    linesByPage.set(page.pageIndex, lines);
    for (const line of lines) {
      const num = matchAnchor(line.text);
      if (num != null) {
        anchors.push({ number: num, pageIndex: page.pageIndex, y: line.y, x: line.x, height: line.height });
      }
    }
  }

  // 2. Build a region (printed question text + blank rect) for each anchor.
  const regions: AnchorRegion[] = anchors.map((anchor) => {
    const page = pages.find((p) => p.pageIndex === anchor.pageIndex)!;
    const lines = linesByPage.get(anchor.pageIndex)!;
    const { text, lowestQuestionY } = gatherQuestionText(anchor, anchors, lines);
    const rect = regionForAnchor(anchor, anchors, page, lowestQuestionY, lines);
    return { anchor, questionText: text, lowestQuestionY, rect };
  });

  // 3. Score every (answer, region) pair and assign greedily, one-to-one.
  const result: RegionMatch[] = answers.map((_, i) => ({ answerIndex: i, rect: null }));
  const usedRegion = new Set<number>();
  const usedAnswer = new Set<number>();

  type Candidate = { ai: number; ri: number; tier: number; score: number; by: "content" | "number" };
  const candidates: Candidate[] = [];

  for (let ai = 0; ai < answers.length; ai++) {
    const answer = answers[ai];
    for (let ri = 0; ri < regions.length; ri++) {
      const region = regions[ri];
      if (!region.rect) continue; // no usable blank space -> can't place here anyway
      const content = similarity(answer.question, region.questionText);
      const numberMatch = normalize(answer.number) === region.anchor.number;

      if (content >= CONTENT_THRESHOLD) {
        // Tier 2: verified by the question text itself. Number breaks ties.
        candidates.push({ ai, ri, tier: 2, score: content + (numberMatch ? 0.001 : 0), by: "content" });
      } else if (numberMatch) {
        // Tier 1: no text to compare (scanned question, terse restatement) — the
        // number is the only signal, so use it but let content matches win first.
        candidates.push({ ai, ri, tier: 1, score: 0.5 + content, by: "number" });
      }
    }
  }

  // Higher tier first, then higher score.
  candidates.sort((a, b) => b.tier - a.tier || b.score - a.score);
  for (const c of candidates) {
    if (usedAnswer.has(c.ai) || usedRegion.has(c.ri)) continue;
    usedAnswer.add(c.ai);
    usedRegion.add(c.ri);
    result[c.ai] = {
      answerIndex: c.ai,
      rect: regions[c.ri].rect,
      matchedBy: c.by,
      confidence: c.by === "content" ? c.score : undefined
    };
  }

  return result;
}

function normalize(n: string): string {
  // Answers may carry "1", "Q1", "1a"; anchors are bare numbers. Pull the digits.
  const m = n.match(/[0-9]+/);
  return m ? m[0] : n.trim();
}

// --- text similarity --------------------------------------------------------

const STOPWORDS = new Set([
  "the", "and", "for", "that", "this", "with", "are", "was", "let", "given", "find",
  "compute", "solve", "name", "explain", "why", "how", "what", "which", "who", "where",
  "your", "you", "from", "into", "each", "all", "using", "use", "then", "show", "prove",
  "determine", "calculate", "evaluate", "consider", "following", "value", "values"
]);

// Single letters that are ordinary English words, not variables — don't treat
// these as math identifiers.
const NON_VARIABLE_LETTERS = new Set(["a", "i", "o"]);

type MatchProfile = {
  tokens: Set<string>;
  numbers: Set<string>;
  variables: Set<string>;
  expressions: Set<string>;
};

/**
 * Tokenizes for question matching. Beyond ≥3-letter content words, it captures
 * the signals math questions live on: numbers (`#42`, `#3.5`), variables
 * (`$x`), compact terms (`term:3x`, `term:x^2`), and whole expressions
 * (`expr:x+7=12`). Namespacing keeps a number from colliding with a word.
 */
function profile(s: string): MatchProfile {
  const lower = normalizeMathText(s.toLowerCase());
  const out: MatchProfile = {
    tokens: new Set<string>(),
    numbers: new Set<string>(),
    variables: new Set<string>(),
    expressions: new Set<string>()
  };

  const add = (token: string) => out.tokens.add(token);

  // Content words.
  for (const w of lower.match(/[a-z]{3,}/g) ?? []) {
    if (!STOPWORDS.has(w)) add(w);
  }
  // Numbers (integers or decimals).
  for (const m of lower.match(/\d+(?:\.\d+)?/g) ?? []) {
    const token = "#" + m;
    out.numbers.add(token);
    add(token);
  }
  // Single-letter variables: a letter standing alone (not inside a word).
  for (const m of lower.match(/(?<![a-z])[a-z](?![a-z])/g) ?? []) {
    if (NON_VARIABLE_LETTERS.has(m)) continue;
    const token = "$" + m;
    out.variables.add(token);
    add(token);
  }

  // Math terms and whole expressions. This is what disambiguates terse
  // symbolic questions with the same constants, e.g. x + 7 = 12 vs y + 7 = 12.
  for (const expr of extractMathExpressions(lower)) {
    const exprToken = "expr:" + expr;
    out.expressions.add(exprToken);
    add(exprToken);

    for (const term of expr.match(/\d+(?:\.\d+)?[a-z](?:\^\d+)?|[a-z]\^\d+/g) ?? []) {
      add("term:" + term);
    }
  }

  return out;
}

function normalizeMathText(s: string): string {
  return s
    .replace(/[−–—]/g, "-")
    .replace(/[×·]/g, "*")
    .replace(/÷/g, "/")
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=")
    .replace(/≠/g, "!=")
    .replace(/≈/g, "~=")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/¹/g, "^1")
    .replace(/\\(?:times|cdot|ast)\b/g, "*")
    .replace(/\\(?:div)\b/g, "/")
    .replace(/\\(?:leq?|le)\b/g, "<=")
    .replace(/\\(?:geq?|ge)\b/g, ">=")
    .replace(/\\(?:neq|ne)\b/g, "!=")
    .replace(/\\(?:approx|sim)\b/g, "~=")
    .replace(/\\(?:left|right)\b/g, "");
}

function extractMathExpressions(s: string): string[] {
  const compact = s.replace(/\s+/g, "");
  const exprs: string[] = [];
  const re = /[a-z0-9().]+(?:[+\-*/^=<>!~]+[a-z0-9().]+)+/g;
  for (const raw of compact.match(re) ?? []) {
    const expr = raw.replace(/^[^a-z0-9(]+|[^a-z0-9)]+$/g, "");
    if (!expr || !/[a-z0-9]/.test(expr)) continue;
    if (!/[+\-*/^=<>!~]/.test(expr)) continue;
    exprs.push(expr);
  }
  return exprs;
}

/** Token containment: |A∩B| / |smaller set|. Robust to one side being truncated. */
function similarity(a: string, b: string): number {
  const A = profile(a);
  const B = profile(b);
  if (A.tokens.size === 0 || B.tokens.size === 0) return 0;

  let inter = 0;
  for (const t of A.tokens) if (B.tokens.has(t)) inter++;
  let score = inter / Math.min(A.tokens.size, B.tokens.size);

  const expressionOverlap = overlapCount(A.expressions, B.expressions);
  if (expressionOverlap > 0) {
    score = Math.max(score, 0.72);
  } else if (A.expressions.size > 0 && B.expressions.size > 0) {
    score *= 0.65;
  }

  if (A.variables.size > 0 && B.variables.size > 0) {
    const variableContainment = overlapCount(A.variables, B.variables) / Math.min(A.variables.size, B.variables.size);
    if (variableContainment < 1) score *= variableContainment === 0 ? 0.35 : 0.65;
  }

  if (A.numbers.size > 0 && B.numbers.size > 0) {
    const numberContainment = overlapCount(A.numbers, B.numbers) / Math.min(A.numbers.size, B.numbers.size);
    if (numberContainment < 0.6) score *= 0.6;
  }

  return Math.min(score, 1);
}

function overlapCount(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const t of a) if (b.has(t)) count++;
  return count;
}

// --- region geometry --------------------------------------------------------

function gatherQuestionText(
  anchor: Anchor,
  anchors: Anchor[],
  lines: TextLine[]
): { text: string; lowestQuestionY: number } {
  const belowSamePage = anchors
    .filter((a) => a.pageIndex === anchor.pageIndex && a.y < anchor.y - 1)
    .sort((a, b) => b.y - a.y)[0];
  // Exclude the next anchor and everything below it.
  const cutoffY = belowSamePage ? belowSamePage.y + belowSamePage.height : -Infinity;

  const questionLines = lines
    .filter((l) => l.y <= anchor.y + 1 && l.y > cutoffY)
    .sort((a, b) => b.y - a.y);

  const text = questionLines.map((l) => l.text).join(" ").replace(/\s+/g, " ").trim();
  const lowestQuestionY = questionLines.length
    ? Math.min(...questionLines.map((l) => l.y))
    : anchor.y;
  return { text, lowestQuestionY };
}

function regionForAnchor(
  anchor: Anchor,
  anchors: Anchor[],
  page: PageText,
  lowestQuestionY: number,
  lines: TextLine[]
): Rect | null {
  const belowSamePage = anchors
    .filter((a) => a.pageIndex === anchor.pageIndex && a.y < anchor.y - 1)
    .sort((a, b) => b.y - a.y)[0];

  const regionBottomY = belowSamePage
    ? belowSamePage.y + belowSamePage.height + GAP
    : PAGE_BOTTOM_MARGIN;
  const regionTopY = lowestQuestionY - GAP;
  const heightPts = regionTopY - regionBottomY;
  if (heightPts < MIN_REGION_HEIGHT) return null;

  const rightMargin = Math.max(...lines.map((l) => l.right), page.width - 56);
  const left = anchor.x;
  const width = Math.max(60, rightMargin - left);

  return {
    page: anchor.pageIndex,
    xLeft: left,
    yTop: page.height - regionTopY,
    width,
    height: heightPts
  };
}
