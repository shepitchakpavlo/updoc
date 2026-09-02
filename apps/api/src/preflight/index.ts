import { ApiError } from "../errors.js";
import { detectMime, type SupportedMime } from "./detect.js";
import { countPdfPages } from "./pdf.js";

export type { SupportedMime } from "./detect.js";

// Preflight upload (тикет 04): розмір ≤20MB (спека TB-0) → MIME за magic
// bytes → для PDF розбір і кількість сторінок. Файл тримається в пам'яті
// процесу (TemporaryStorage — лише контракт, Phase 1 реалізує зберігання).

export const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
export const MAX_FILE_SIZE_MB = MAX_FILE_SIZE / (1024 * 1024);

export interface PreflightResult {
  mimeType: SupportedMime;
  /** кількість сторінок для PDF, інакше null */
  pageCount: number | null;
}

export class PreflightError extends ApiError {}
export class FileTooLargeError extends PreflightError {
  constructor() {
    super("file_too_large", 413, `Файл понад ${MAX_FILE_SIZE_MB}MB`);
  }
}
export class UnsupportedFormatError extends PreflightError {
  constructor() {
    super("unsupported_format", 400, "Формат файла не підтримується — потрібні JPG, PNG, HEIC або PDF");
  }
}
export class InvalidPdfError extends PreflightError {
  constructor() {
    super("invalid_pdf", 400, "PDF пошкоджений або не читається");
  }
}

export async function preflight(data: Buffer): Promise<PreflightResult> {
  if (data.length > MAX_FILE_SIZE) {
    throw new FileTooLargeError();
  }
  const mimeType = detectMime(data);
  if (mimeType === null) {
    throw new UnsupportedFormatError();
  }
  if (mimeType === "application/pdf") {
    let pageCount: number;
    try {
      pageCount = await countPdfPages(data);
    } catch {
      throw new InvalidPdfError();
    }
    return { mimeType, pageCount };
  }
  return { mimeType, pageCount: null };
}
