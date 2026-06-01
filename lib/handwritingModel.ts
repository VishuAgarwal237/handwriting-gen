/**
 * Orchestrates the "render answers in the student's hand onto the homework PDF" step.
 *
 *   LaTeX from GPT
 *      → extractAnswers (lib/answerExtractor)
 *      → generateHandwritingWords (lib/handwritingProvider, hits Modal/One-DM when wired)
 *      → composeAnsweredPdf (lib/pdfComposer, falls back to Caveat font if no images)
 *      → data URL of the final PDF
 *
 * Plugging in One-DM = deploying `modal/one_dm_app.py` and setting
 * `HANDWRITING_SERVICE_URL` in `.env.local`. No code changes here.
 */

import { extractAnswers, answersToPlain } from "./answerExtractor";
import { generateHandwritingWords, type WordImage } from "./handwritingProvider";
import { composeAnsweredPdf } from "./pdfComposer";

export type RenderHandwritingInput = {
  handwritingSampleDataUrl: string;
  homeworkPdfDataUrl: string;
  latex: string;
  answersPlain: string;
};

export type RenderHandwritingOutput = {
  outputDataUrl: string;
  mimeType: string;
  note?: string;
};

const MAX_WORDS_PER_REQUEST = 64; // keep Modal calls bounded
const MAX_ANSWER_CHARS = 600;     // belt-and-suspenders against runaway GPT output

export async function renderHandwriting(input: RenderHandwritingInput): Promise<RenderHandwritingOutput> {
  const answers = extractAnswers(input.latex);
  if (answers.length === 0) {
    return {
      outputDataUrl: "",
      mimeType: "text/plain",
      note: "Couldn't parse any answers from the LaTeX."
    };
  }

  for (const a of answers) {
    if (a.answer.length > MAX_ANSWER_CHARS) a.answer = a.answer.slice(0, MAX_ANSWER_CHARS) + "…";
  }

  // Try ML provider per answer. Returns null when HANDWRITING_SERVICE_URL is unset
  // or the call fails — composer then falls back to the Caveat font.
  let usedModel = false;
  let note: string | undefined;
  const wordImagesByAnswer: (WordImage[] | null)[] = [];
  for (const a of answers) {
    const words = a.answer.split(/\s+/).filter(Boolean).slice(0, MAX_WORDS_PER_REQUEST);
    if (words.length === 0) {
      wordImagesByAnswer.push(null);
      continue;
    }
    const images = await generateHandwritingWords({
      styleImageDataUrl: input.handwritingSampleDataUrl,
      words
    });
    if (images) usedModel = true;
    wordImagesByAnswer.push(images);
  }

  if (!process.env.HANDWRITING_SERVICE_URL) {
    note = "One-DM not connected — using handwriting font fallback. Deploy modal/one_dm_app.py and set HANDWRITING_SERVICE_URL to enable real style cloning.";
  } else if (!usedModel) {
    note = "Handwriting service did not return images — fell back to the font.";
  }

  const originalPdf = dataUrlToBuffer(input.homeworkPdfDataUrl);
  const pdfBytes = await composeAnsweredPdf({
    originalPdf,
    answers,
    wordImagesByAnswer
  });

  const out = Buffer.from(pdfBytes).toString("base64");
  void answersToPlain; // exported for callers that want plaintext later

  return {
    outputDataUrl: `data:application/pdf;base64,${out}`,
    mimeType: "application/pdf",
    note
  };
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Buffer.from(b64, "base64");
}
