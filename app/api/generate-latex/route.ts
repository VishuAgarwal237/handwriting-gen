import { NextRequest, NextResponse } from "next/server";
import { getOpenAI, MODEL } from "@/lib/openai";
import type { ContentFilter, GenerateLatexResponse } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM_PROMPT = `You are an expert tutor. The user uploads a homework PDF.
Your job:
1. Read every problem in the PDF.
2. Solve each problem with clear, complete reasoning.
3. Output a SINGLE self-contained LaTeX document (\\documentclass{article} ... \\end{document}).
4. Preserve problem numbering. For each problem, include the original question (paraphrased if too long), then a "Solution" block.
5. Use \\section* for each problem and \\textbf{Solution.} to introduce answers.
6. If a part of the homework is unreadable, note it with \\textit{[unreadable]} rather than guessing.
Return ONLY the LaTeX source — no markdown fences, no commentary before or after.`;

function filterInstructions(filter: ContentFilter): string {
  const allowed: string[] = [];
  if (filter.alphabet) allowed.push("alphabet letters (A-Z, a-z)");
  if (filter.numbers) allowed.push("digits (0-9)");
  if (filter.punctuation) allowed.push("basic punctuation (.,;:!?\"'-)");
  if (filter.math) allowed.push("math symbols and equations");

  const restrictions: string[] = [];
  if (!filter.alphabet) restrictions.push("Do NOT include alphabetic words. Express answers symbolically/numerically only.");
  if (!filter.numbers) restrictions.push("Do NOT include digits. Spell numbers as words if absolutely required.");
  if (!filter.math)
    restrictions.push(
      "Do NOT use math mode, equations, fractions, integrals, or symbolic notation. Express answers in plain prose or as integers."
    );

  return `Allowed character classes for the final answers: ${allowed.join(", ") || "(none)"}.
${restrictions.join("\n")}`.trim();
}

export async function POST(req: NextRequest): Promise<NextResponse<GenerateLatexResponse | { error: string }>> {
  try {
    const form = await req.formData();
    const pdf = form.get("pdf");
    const filterRaw = form.get("filter");
    if (!(pdf instanceof File)) {
      return NextResponse.json({ error: "Missing PDF upload" }, { status: 400 });
    }
    if (typeof filterRaw !== "string") {
      return NextResponse.json({ error: "Missing filter" }, { status: 400 });
    }
    const filter = JSON.parse(filterRaw) as ContentFilter;

    const buffer = Buffer.from(await pdf.arrayBuffer());
    const base64 = buffer.toString("base64");
    const dataUrl = `data:application/pdf;base64,${base64}`;

    const client = getOpenAI();
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.2,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              // OpenAI's chat completions API accepts inline PDFs via the `file` content block.
              type: "file",
              file: { filename: pdf.name || "homework.pdf", file_data: dataUrl }
            } as never,
            {
              type: "text",
              text: `Solve every problem in the attached homework.\n\n${filterInstructions(filter)}`
            }
          ]
        }
      ]
    });

    let latex = completion.choices[0]?.message?.content?.trim() ?? "";
    // Strip accidental markdown fences.
    latex = latex.replace(/^```(?:latex|tex)?\s*/i, "").replace(/```\s*$/i, "").trim();

    const warnings: string[] = [];
    if (filter.math) {
      warnings.push(
        "Your homework contains math. The handwriting renderer can't draw equations yet — it will skip math regions."
      );
    }

    return NextResponse.json({ latex, warnings });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
