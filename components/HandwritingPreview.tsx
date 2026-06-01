"use client";

import { Download, PenLine } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
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
          <AnimatePresence mode="wait">
            <motion.div
              key={state.kind}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
            >
              {state.kind === "idle" && (
                <Empty title="Ready when you are" body="Generate the LaTeX first, then render it back in your handwriting." />
              )}
              {state.kind === "blocked" && (
                <Empty title="Rendering is paused" body={state.reason} variant="warn" />
              )}
              {state.kind === "loading" && <DrawingLoader />}
              {state.kind === "stub" && (
                <Empty title="Handwriting model not connected" body={state.note} variant="info" />
              )}
              {state.kind === "error" && (
                <Empty title="Something went wrong" body={state.message} variant="warn" />
              )}
              {state.kind === "ready" && (
                <div className="flex flex-col items-center">
                  {state.mimeType.startsWith("image/") ? (
                    <motion.img
                      src={state.outputDataUrl}
                      alt="rendered homework"
                      className="max-w-full rounded-xl border border-border"
                      initial={{ opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.3, ease: "easeOut" }}
                    />
                  ) : (
                    <motion.iframe
                      src={state.outputDataUrl}
                      className="w-full h-[70vh] rounded-xl border border-border bg-white"
                      initial={{ opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.3, ease: "easeOut" }}
                    />
                  )}
                  <Button asChild variant="outline" size="sm" className="mt-4">
                    <a href={state.outputDataUrl} download>
                      <Download className="size-3.5" />
                      Download
                    </a>
                  </Button>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </ScrollArea>
    </div>
  );
}

function DrawingLoader() {
  return (
    <div className="h-[40vh] flex flex-col items-center justify-center gap-4 text-muted-foreground">
      <div className="relative size-20">
        <motion.div
          className="absolute inset-0 rounded-full border-2 border-primary/30"
          animate={{ scale: [1, 1.25, 1], opacity: [0.7, 0, 0.7] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute inset-3 rounded-full bg-primary/15 flex items-center justify-center"
          animate={{ rotate: [0, 8, -8, 0] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        >
          <PenLine className="size-6 text-primary" />
        </motion.div>
      </div>
      <div className="text-sm">Drawing your homework…</div>
      <div className="flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="size-1.5 rounded-full bg-primary/60"
            animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }}
          />
        ))}
      </div>
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
