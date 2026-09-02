import { PDFDocument } from "pdf-lib";

// Кількість сторінок PDF (тикет 04): повноцінний розбір документа (xref,
// сторінкове дерево, потоки) — не regex за сирими байтами. Кидає на
// пошкоджених/зашифрованих файлах — це частина preflight-декодування.
export async function countPdfPages(data: Buffer): Promise<number> {
  const doc = await PDFDocument.load(data);
  return doc.getPageCount();
}
