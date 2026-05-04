import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Inkwell — Handwritten Homework, Auto-Drafted",
  description:
    "Upload your handwriting and your homework. Inkwell solves it with GPT and renders it back in your own hand."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Caveat:wght@500;600&display=swap"
        />
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css" />
      </head>
      <body className="min-h-screen antialiased font-sans">{children}</body>
    </html>
  );
}
