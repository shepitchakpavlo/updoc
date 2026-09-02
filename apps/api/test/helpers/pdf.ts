import { PDFDocument } from "pdf-lib";

/** Справжній PDF із заданою кількістю сторінок — оракул для підрахунку. */
export async function makePdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    doc.addPage();
  }
  return Buffer.from(await doc.save());
}
