# Inkwell — Handwritten Homework, Auto-Drafted

Upload a sample of your handwriting + a homework PDF. GPT solves it and emits a LaTeX answer key, you can chat with a tutor that's grounded on that LaTeX, and a pluggable handwriting model renders the solution back in your own hand.

## Stack

- Next.js 15 (App Router) + TypeScript + Tailwind
- OpenAI Chat Completions w/ inline PDF input (default `gpt-4o`)
- React-Markdown + KaTeX for the rendered LaTeX preview
- Streaming chat (Server-Sent text)

## Quick start

```bash
cp .env.example .env.local   # add your OPENAI_API_KEY
npm install
npm run dev
```

Open http://localhost:3000.

## Architecture

```
app/
  page.tsx                        # 3-step UI: upload → filters → generate
  api/generate-latex/route.ts     # PDF + filter → GPT → LaTeX
  api/chat/route.ts               # streamed Q&A grounded on LaTeX
  api/render-handwriting/route.ts # forwards to lib/handwritingModel.ts
components/
  UploadCard, FilterPanel, LatexPreview, ChatPanel, HandwritingPreview
lib/
  openai.ts            # client + model config
  types.ts             # ContentFilter, ChatMessage, etc.
  handwritingModel.ts  # <-- plug your blackbox model in here
```

## Plugging in the handwriting model

When your handwriting-generation codebase is ready, replace the body of `renderHandwriting()` in `lib/handwritingModel.ts`:

```ts
export async function renderHandwriting(input: RenderHandwritingInput): Promise<RenderHandwritingOutput> {
  // input.handwritingSampleDataUrl  — base64 image of the student's handwriting
  // input.homeworkPdfDataUrl        — base64 of the original blank homework PDF
  // input.latex                     — full LaTeX of the solved homework
  // input.answersPlain              — plain-text answers extracted from the LaTeX
  // return { outputDataUrl, mimeType: "image/png" | "application/pdf" };
}
```

The UI already handles the empty-stub case, image output, PDF output, download, and the math-blocked state — no UI changes needed when you wire it up.

## Filters & math gating

The Filter panel (`components/FilterPanel.tsx`) is a checklist for what's in the homework. The `math` flag is the only one that blocks rendering, since equation drawing isn't supported yet. LaTeX generation and chat work regardless. Edit `SUPPORTED_BY_HANDWRITING` in `lib/types.ts` to expand support as the model grows.
