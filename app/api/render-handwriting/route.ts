import { NextRequest, NextResponse } from "next/server";
import { renderHandwriting } from "@/lib/handwritingModel";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const sample = form.get("sample");
    const pdf = form.get("pdf");
    const latex = form.get("latex");
    const answersPlain = form.get("answersPlain");

    if (!(sample instanceof File)) return NextResponse.json({ error: "Missing handwriting sample" }, { status: 400 });
    if (!(pdf instanceof File)) return NextResponse.json({ error: "Missing homework PDF" }, { status: 400 });
    if (typeof latex !== "string") return NextResponse.json({ error: "Missing LaTeX" }, { status: 400 });

    const sampleBuf = Buffer.from(await sample.arrayBuffer());
    const pdfBuf = Buffer.from(await pdf.arrayBuffer());

    const result = await renderHandwriting({
      handwritingSampleDataUrl: `data:${sample.type || "image/png"};base64,${sampleBuf.toString("base64")}`,
      homeworkPdfDataUrl: `data:application/pdf;base64,${pdfBuf.toString("base64")}`,
      latex,
      answersPlain: typeof answersPlain === "string" ? answersPlain : ""
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
