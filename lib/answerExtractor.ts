export type ExtractedAnswer = {
  number: string;
  question: string;
  answer: string;
};

const SECTION_RE = /\\section\*\{([^}]*)\}([\s\S]*?)(?=\\section\*\{|\\end\{document\})/g;
const SOLUTION_RE = /\\textbf\{Solution\.?\}\s*([\s\S]*?)$/i;

export function extractAnswers(latex: string): ExtractedAnswer[] {
  const out: ExtractedAnswer[] = [];
  let m: RegExpExecArray | null;
  let idx = 1;
  while ((m = SECTION_RE.exec(latex)) !== null) {
    const heading = stripLatex(m[1]);
    const body = m[2];
    const solMatch = body.match(SOLUTION_RE);
    const questionPart = solMatch ? body.slice(0, body.indexOf(solMatch[0])) : body;
    const answerPart = solMatch ? solMatch[1] : "";
    const numberMatch = heading.match(/(?:problem|question|q|p)\s*([0-9a-z]+)/i) || heading.match(/^([0-9]+)/);
    out.push({
      number: numberMatch ? numberMatch[1] : String(idx),
      question: stripLatex(questionPart).trim(),
      answer: stripLatex(answerPart).trim()
    });
    idx++;
  }
  if (out.length === 0) {
    const tail = stripLatex(latex).trim();
    if (tail) out.push({ number: "1", question: "", answer: tail });
  }
  return out;
}

export function answersToPlain(answers: ExtractedAnswer[]): string {
  return answers.map((a) => `${a.number}. ${a.answer}`).join("\n\n");
}

function stripLatex(s: string): string {
  return s
    .replace(/\\(?:begin|end)\{[^}]*\}/g, "")
    .replace(/\$\$?([^$]*)\$\$?/g, "$1")
    .replace(/\\(?:textbf|textit|emph|underline|mathrm|mathbf)\{([^}]*)\}/g, "$1")
    .replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?(\{[^}]*\})?/g, " ")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
