"use client";

import { useCallback, useRef, useState } from "react";
import { FileText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  label: string;
  hint: string;
  accept: string;
  icon: React.ReactNode;
  file: File | null;
  onFile: (f: File | null) => void;
};

export function UploadCard({ label, hint, accept, icon, file, onFile }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const setFile = useCallback(
    (f: File | null) => {
      onFile(f);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      if (f && f.type.startsWith("image/")) setPreviewUrl(URL.createObjectURL(f));
      else setPreviewUrl(null);
    },
    [onFile, previewUrl]
  );

  return (
    <div
      className={cn(
        "dropzone glass relative rounded-2xl p-5 cursor-pointer group transition-shadow",
        active && "shadow-glow"
      )}
      data-active={active}
      data-loaded={!!file}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setActive(true);
      }}
      onDragLeave={() => setActive(false)}
      onDrop={(e) => {
        e.preventDefault();
        setActive(false);
        const f = e.dataTransfer.files?.[0];
        if (f) setFile(f);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <div className="flex items-start gap-4">
        <div className="shrink-0 size-11 rounded-xl bg-primary/15 text-primary flex items-center justify-center group-hover:bg-primary/25 transition-colors">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-foreground">{label}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>
          {file ? (
            <div className="mt-3 flex items-center gap-3">
              {previewUrl ? (
                <img src={previewUrl} alt="preview" className="size-14 object-cover rounded-lg border border-border" />
              ) : (
                <div className="size-14 rounded-lg bg-secondary/60 border border-border flex items-center justify-center">
                  <FileText className="size-5 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-xs text-foreground truncate">{file.name}</div>
                <div className="text-[11px] text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={(e) => {
                  e.stopPropagation();
                  setFile(null);
                }}
                aria-label="Remove file"
              >
                <X className="size-4" />
              </Button>
            </div>
          ) : (
            <div className="mt-3 text-[11px] text-muted-foreground">Drop file here, or click to browse</div>
          )}
        </div>
      </div>
    </div>
  );
}
