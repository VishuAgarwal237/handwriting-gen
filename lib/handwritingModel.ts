/**
 * Handwriting renderer plug-in.
 *
 * The blackbox model the user will plug in later goes here. The website calls
 * `renderHandwriting` and expects back a PNG/PDF data URL of the homework page
 * with the LaTeX-derived answers written in the student's handwriting.
 *
 * Until that codebase is dropped in, we return a placeholder so the rest of
 * the UI can be exercised end-to-end.
 */

export type RenderHandwritingInput = {
  handwritingSampleDataUrl: string; // image/png or image/jpeg
  homeworkPdfDataUrl: string; // application/pdf
  latex: string;
  /** Plain-text answers derived from the LaTeX, ready to render. */
  answersPlain: string;
};

export type RenderHandwritingOutput = {
  /** data: URL of the rendered page (image or PDF). */
  outputDataUrl: string;
  mimeType: string;
  note?: string;
};

export async function renderHandwriting(
  _input: RenderHandwritingInput
): Promise<RenderHandwritingOutput> {
  // TODO: replace with the user's blackbox handwriting model.
  return {
    outputDataUrl: "",
    mimeType: "text/plain",
    note: "Handwriting model not connected. Plug your codebase into lib/handwritingModel.ts."
  };
}
