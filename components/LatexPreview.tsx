"use client";

import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Copy, FileText } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

type Props = { latex: string };

function latexToMarkdown(src: string): string {
  if (!src) return "";
  let s = src;
  const beginIdx = s.indexOf("\\begin{document}");
  if (beginIdx >= 0) s = s.slice(beginIdx + "\\begin{document}".length);
  s = s.replace(/\\end\{document\}[\s\S]*$/, "");
  s = s.replace(/\\section\*?\{([^}]*)\}/g, "\n\n## $1\n\n");
  s = s.replace(/\\subsection\*?\{([^}]*)\}/g, "\n\n### $1\n\n");
  s = s.replace(/\\textbf\{([^}]*)\}/g, "**$1**");
  s = s.replace(/\\textit\{([^}]*)\}/g, "*$1*");
  s = s.replace(/\\emph\{([^}]*)\}/g, "*$1*");
  s = s.replace(/\\item\s+/g, "- ");
  s = s.replace(/\\begin\{(itemize|enumerate)\}/g, "");
  s = s.replace(/\\end\{(itemize|enumerate)\}/g, "");
  s = s.replace(/\\\[(.+?)\\\]/gs, (_m, body) => `\n$$${body}$$\n`);
  s = s.replace(/\\\((.+?)\\\)/gs, (_m, body) => `$${body}$`);
  return s.trim();
}

export function LatexPreview({ latex }: Props) {
  const md = useMemo(() => latexToMarkdown(latex), [latex]);
  const [copied, setCopied] = useState(false);

  if (!latex) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-8 text-muted-foreground">
        <div className="size-14 rounded-2xl bg-secondary/60 border border-border flex items-center justify-center mb-4">
          <FileText className="size-7 text-muted-foreground" />
        </div>
        <div className="text-sm text-foreground font-medium">No solution yet</div>
        <div className="text-xs mt-1.5 max-w-sm">
          Upload your handwriting + homework on the left, then hit{" "}
          <span className="text-primary">Solve homework</span> to generate it with GPT.
        </div>
      </div>
    );
  }

  const copy = async () => {
    await navigator.clipboard.writeText(latex);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <Tabs defaultValue="rendered" className="h-full flex flex-col">
      <div className="flex items-center gap-3 border-b border-border/60 px-5 pt-4 pb-3">
        <TabsList>
          <TabsTrigger value="rendered">Rendered</TabsTrigger>
          <TabsTrigger value="source">LaTeX source</TabsTrigger>
        </TabsList>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={copy}>
          <Copy className="size-3.5" />
          {copied ? "Copied" : "Copy .tex"}
        </Button>
      </div>

      <TabsContent value="rendered" className="flex-1 min-h-0">
        <ScrollArea className="h-full px-6 py-5">
          <article className="prose prose-invert prose-sm max-w-none prose-headings:text-foreground prose-p:text-foreground/85 prose-strong:text-primary prose-li:text-foreground/85">
            <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
              {md}
            </ReactMarkdown>
          </article>
        </ScrollArea>
      </TabsContent>
      <TabsContent value="source" className="flex-1 min-h-0">
        <ScrollArea className="h-full px-6 py-5">
          <pre className="latex-preview text-foreground/85 whitespace-pre-wrap">{latex}</pre>
        </ScrollArea>
      </TabsContent>
    </Tabs>
  );
}
