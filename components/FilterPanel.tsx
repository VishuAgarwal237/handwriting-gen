"use client";

import type { ContentFilter } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Props = {
  value: ContentFilter;
  onChange: (next: ContentFilter) => void;
};

const ITEMS: Array<{
  key: keyof ContentFilter;
  label: string;
  hint: string;
  supported: boolean;
}> = [
  { key: "alphabet", label: "Alphabet", hint: "A–Z, a–z", supported: true },
  { key: "numbers", label: "Numbers", hint: "0–9", supported: true },
  { key: "punctuation", label: "Punctuation", hint: ". , ; : ! ? — '", supported: true },
  { key: "math", label: "Math", hint: "Equations, symbols (preview only)", supported: false }
];

export function FilterPanel({ value, onChange }: Props) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">Content in your homework</h3>
          <span className="text-[11px] text-muted-foreground">Tells GPT what to expect</span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {ITEMS.map((item) => {
            const id = `filter-${item.key}`;
            const on = value[item.key];
            return (
              <Label
                key={item.key}
                htmlFor={id}
                className={cn(
                  "flex items-start gap-2.5 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors",
                  on
                    ? "border-primary/60 bg-primary/10"
                    : "border-border bg-secondary/20 hover:bg-secondary/40"
                )}
              >
                <Checkbox
                  id={id}
                  checked={on}
                  onCheckedChange={() => onChange({ ...value, [item.key]: !on })}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-foreground flex items-center gap-1.5">
                    {item.label}
                    {!item.supported && <Badge variant="warn">no render</Badge>}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{item.hint}</div>
                </div>
              </Label>
            );
          })}
        </div>

        {value.math && (
          <Alert variant="warn" className="mt-3">
            <AlertDescription>
              Math is on. The handwriting renderer can't draw equations yet — those regions will be skipped.
              Solutions in the LaTeX and chat are unaffected.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
