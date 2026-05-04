"use client";

import { useState } from "react";
import { FileText, MessageSquare, PenLine, Sparkles, Loader2, ImageIcon, Shield } from "lucide-react";
import { UploadCard } from "@/components/UploadCard";
import { FilterPanel } from "@/components/FilterPanel";
import { LatexPreview } from "@/components/LatexPreview";
import { ChatPanel } from "@/components/ChatPanel";
import { HandwritingPreview } from "@/components/HandwritingPreview";
import { SUPPORTED_BY_HANDWRITING, type ContentFilter } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

type RenderState =
  | { kind: "idle" }
  | { kind: "blocked"; reason: string }
  | { kind: "loading" }
  | { kind: "stub"; note: string }
  | { kind: "ready"; outputDataUrl: string; mimeType: string }
  | { kind: "error"; message: string };

export default function Page() {
  const [sample, setSample] = useState<File | null>(null);
  const [pdf, setPdf] = useState<File | null>(null);
  const [filter, setFilter] = useState<ContentFilter>({
    alphabet: true,
    numbers: true,
    punctuation: true,
    math: false
  });
  const [latex, setLatex] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("latex");
  const [renderState, setRenderState] = useState<RenderState>({ kind: "idle" });

  const canGenerate = !!pdf && !generating && (filter.alphabet || filter.numbers || filter.math);
  const canRender = !!latex && !!sample && !!pdf && SUPPORTED_BY_HANDWRITING(filter);

  const generate = async () => {
    if (!pdf) return;
    setGenerating(true);
    setError(null);
    setLatex("");
    setWarnings([]);
    try {
      const fd = new FormData();
      fd.append("pdf", pdf);
      fd.append("filter", JSON.stringify(filter));
      const res = await fetch("/api/generate-latex", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Generation failed");
      setLatex(json.latex);
      setWarnings(json.warnings || []);
      setTab("latex");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setGenerating(false);
    }
  };

  const renderHand = async () => {
    if (!latex || !sample || !pdf) return;
    if (!SUPPORTED_BY_HANDWRITING(filter)) {
      setRenderState({
        kind: "blocked",
        reason: "Math is in the filter. Disable Math to render — equation rendering isn't supported yet."
      });
      return;
    }
    setRenderState({ kind: "loading" });
    try {
      const fd = new FormData();
      fd.append("sample", sample);
      fd.append("pdf", pdf);
      fd.append("latex", latex);
      const res = await fetch("/api/render-handwriting", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Render failed");
      if (!json.outputDataUrl) {
        setRenderState({ kind: "stub", note: json.note || "Handwriting model not connected." });
      } else {
        setRenderState({ kind: "ready", outputDataUrl: json.outputDataUrl, mimeType: json.mimeType });
      }
    } catch (err) {
      setRenderState({ kind: "error", message: err instanceof Error ? err.message : "Unknown error" });
    }
  };

  const renderTabState =
    !canRender && renderState.kind === "idle"
      ? !latex
        ? { kind: "idle" as const }
        : !sample
        ? { kind: "blocked" as const, reason: "Upload a handwriting sample on the left to enable rendering." }
        : !SUPPORTED_BY_HANDWRITING(filter)
        ? {
            kind: "blocked" as const,
            reason:
              "Math is in the filter. Equation rendering isn't supported yet — uncheck Math to render."
          }
        : { kind: "idle" as const }
      : renderState;

  return (
    <main className="min-h-screen">
      <Header />
      <div className="max-w-[1400px] mx-auto px-6 pb-16">
        <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">
          <aside className="space-y-4">
            <Step n={1} title="Upload" />
            <UploadCard
              label="Handwriting sample"
              hint="A clear photo of a paragraph in your hand"
              accept="image/png,image/jpeg,image/webp"
              file={sample}
              onFile={setSample}
              icon={<ImageIcon className="size-5" />}
            />
            <UploadCard
              label="Homework PDF"
              hint="The blank assignment you need to submit"
              accept="application/pdf"
              file={pdf}
              onFile={setPdf}
              icon={<FileText className="size-5" />}
            />

            <Step n={2} title="What's in it?" />
            <FilterPanel value={filter} onChange={setFilter} />

            <Step n={3} title="Generate" />
            <Button
              onClick={generate}
              disabled={!canGenerate}
              size="lg"
              className="w-full h-12 text-sm font-semibold"
            >
              {generating ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Solving with GPT…
                </>
              ) : (
                <>
                  <Sparkles className="size-4" /> Solve homework
                </>
              )}
            </Button>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </aside>

          <section className="glass-strong rounded-3xl gradient-border min-h-[78vh] flex flex-col overflow-hidden">
            <Tabs value={tab} onValueChange={setTab} className="flex flex-col flex-1 min-h-0">
              <div className="flex items-center gap-3 px-4 pt-3">
                <TabsList>
                  <TabsTrigger value="latex">
                    <FileText className="size-3.5" /> Solution
                  </TabsTrigger>
                  <TabsTrigger value="chat">
                    <MessageSquare className="size-3.5" /> Tutor chat
                  </TabsTrigger>
                  <TabsTrigger value="render">
                    <PenLine className="size-3.5" /> Handwritten
                  </TabsTrigger>
                </TabsList>
                {warnings.length > 0 && (
                  <Badge variant="warn" className="ml-auto normal-case tracking-normal text-[11px]">
                    {warnings[0]}
                  </Badge>
                )}
              </div>
              <TabsContent value="latex" className="flex-1 min-h-0 mt-3">
                <LatexPreview latex={latex} />
              </TabsContent>
              <TabsContent value="chat" className="flex-1 min-h-0 mt-3">
                <ChatPanel latex={latex} />
              </TabsContent>
              <TabsContent value="render" className="flex-1 min-h-0 mt-3">
                <HandwritingPreview state={renderTabState} onRender={renderHand} canRender={canRender} />
              </TabsContent>
            </Tabs>
          </section>
        </div>
      </div>
    </main>
  );
}

function Header() {
  return (
    <header className="max-w-[1400px] mx-auto px-6 pt-8 pb-6 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="size-9 rounded-xl bg-gradient-to-br from-violet-500 to-violet-600 flex items-center justify-center shadow-glow">
          <PenLine className="size-5 text-white" />
        </div>
        <div>
          <div className="text-lg font-semibold tracking-tight">Inkwell</div>
          <div className="text-[11px] text-muted-foreground -mt-0.5">handwritten homework, auto-drafted</div>
        </div>
      </div>
      <div className="hidden md:flex items-center gap-4 text-[12px] text-muted-foreground">
        <Badge variant="outline" className="normal-case tracking-normal text-[11px]">
          <span className="size-1.5 rounded-full bg-emerald-400 mr-1.5" /> GPT-4o
        </Badge>
        <span className="flex items-center gap-1.5">
          <Shield className="size-3.5" /> never stored
        </span>
      </div>
    </header>
  );
}

function Step({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-2.5 pt-1">
      <div className="size-6 rounded-full bg-primary/15 text-primary text-[11px] font-semibold flex items-center justify-center border border-primary/30">
        {n}
      </div>
      <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground font-medium">{title}</div>
    </div>
  );
}
