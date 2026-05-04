"use client";

import { Download, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";

type Props = {
  state:
    | { kind: "idle" }
    | { kind: "blocked"; reason: string }
    | { kind: "loading" }
    | { kind: "stub"; note: string }
    | { kind: "ready"; outputDataUrl: string; mimeType: string }
    | { kind: "error"; message: string };
  onRender: () => void;
  canRender: boolean;
};

export function HandwritingPreview({ state, onRender, canRender }: Props) {
  return (
    <div className="h-full flex flex-col">
      <div className="px-5 pt-4 pb-3 border-b border-border/60 flex items-center gap-3">
        <div className="text-sm font-semibold text-foreground">Handwritten output</div>
        <span className="text-[11px] text-muted-foreground">your hand · your homework · written for you</span>
        <Button
          size="sm"
          className="ml-auto"
          onClick={onRender}
          disabled={!canRender || state.kind === "loading"}
        >
          <PenLine className="size-3.5" />
          {state.kind === "loading" ? "Rendering…" : "Render"}
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="px-6 py-6 h-full">
          {state.kind === "idle" && (
            <Empty title="Ready when you are" body="Generate the LaTeX first, then render it back in your handwriting." />
          )}
          {state.kind === "blocked" && (
            <Empty title="Rendering is paused" body={state.reason} variant="warn" />
          )}
          {state.kind === "loading" && (
            <div className="flex items-center justify-center h-[40vh] text-muted-foreground text-sm">
              <div className="dot-pulse flex gap-1 mr-2 text-lg">
                <span>•</span>
                <span>•</span>
                <span>•</span>
              </div>
              Drawing your homework…
            </div>
          )}
          {state.kind === "stub" && (
            <Empty title="Handwriting model not connected" body={state.note} variant="info" />
          )}
          {state.kind === "error" && (
            <Empty title="Something went wrong" body={state.message} variant="warn" />
          )}
          {state.kind === "ready" && (
            <div className="flex flex-col items-center">
              {state.mimeType.startsWith("image/") ? (
                <img
                  src={state.outputDataUrl}
                  alt="rendered homework"
                  className="max-w-full rounded-xl border border-border"
                />
              ) : (
                <iframe src={state.outputDataUrl} className="w-full h-[70vh] rounded-xl border border-border bg-white" />
              )}
              <Button asChild variant="outline" size="sm" className="mt-4">
                <a href={state.outputDataUrl} download>
                  <Download className="size-3.5" />
                  Download
                </a>
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function Empty({
  title,
  body,
  variant = "default"
}: {
  title: string;
  body: string;
  variant?: "default" | "warn" | "info";
}) {
  return (
    <div className="h-full min-h-[40vh] flex items-center justify-center">
      <Alert variant={variant} className="max-w-md text-center">
        <AlertTitle className="text-sm">{title}</AlertTitle>
        <AlertDescription>{body}</AlertDescription>
      </Alert>
    </div>
  );
}
