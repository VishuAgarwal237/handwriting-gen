export type ContentFilter = {
  alphabet: boolean;
  numbers: boolean;
  math: boolean;
  punctuation: boolean;
};

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type GenerateLatexResponse = {
  latex: string;
  warnings: string[];
};

export const SUPPORTED_BY_HANDWRITING = (filter: ContentFilter) =>
  !filter.math; // Math is the only flag that blocks rendering for now.
