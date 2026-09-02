// Визначення MIME за magic bytes (тикет 04): розширення ім'я і заявлений
// content-type клієнта не використовуються взагалі — рішення лише за байтами.

export const JPEG_MIME = "image/jpeg";
export const PNG_MIME = "image/png";
export const HEIC_MIME = "image/heic";
export const PDF_MIME = "application/pdf";

export type SupportedMime = typeof JPEG_MIME | typeof PNG_MIME | typeof HEIC_MIME | typeof PDF_MIME;

// Сигнатури (спека TB-0: JPG/PNG/HEIC/PDF):
// JPEG — FF D8 FF; PNG — 89 50 4E 47 0D 0A 1A 0A; PDF — %PDF.
// HEIC/HEIF — ISO BMFF-контейнер: box "ftyp" (байти 4..8) + major brand.
const JPEG_SIG = [0xff, 0xd8, 0xff];
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PDF_SIG = [0x25, 0x50, 0x44, 0x46]; // "%PDF"
// Бренди HEIC/HEVC (iPhone): лише HEIC-специфічні. Родові HEIF-бренди
// (mif1/msf1) і AVIF ("avif"/"avis") — поза списком TB-0: файл із таким
// major brand не приймається як HEIC.
const HEIC_BRANDS: Record<string, true> = {
  heic: true,
  heix: true,
  hevc: true,
  hevx: true,
};

function startsWith(data: Buffer, sig: readonly number[]): boolean {
  if (data.length < sig.length) {
    return false;
  }
  for (let i = 0; i < sig.length; i++) {
    if (data[i] !== sig[i]) {
      return false;
    }
  }
  return true;
}

export function detectMime(data: Buffer): SupportedMime | null {
  if (startsWith(data, JPEG_SIG)) {
    return JPEG_MIME;
  }
  if (startsWith(data, PNG_SIG)) {
    return PNG_MIME;
  }
  // ISO BMFF: байти 0..3 — розмір box, 4..7 — "ftyp", 8..11 — major brand.
  if (data.length >= 12 && data.toString("ascii", 4, 8) === "ftyp" && HEIC_BRANDS[data.toString("ascii", 8, 12)] === true) {
    return HEIC_MIME;
  }
  if (startsWith(data, PDF_SIG)) {
    return PDF_MIME;
  }
  return null;
}
