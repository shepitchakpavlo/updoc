import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FileTooLargeError,
  InvalidPdfError,
  UnsupportedFormatError,
  preflight,
} from "../src/preflight/index.js";
import { makePdf } from "./helpers/pdf.js";

// Seam: preflight — чиста функція над байтами (тикет 04):
// розмір ≤20MB (спека TB-0), MIME за magic bytes (не за розширенням чи
// заявленим content-type — їх функція взагалі не бачить), сторінки PDF.
// Незалежні значення: 20MB = 20 * 1024 * 1024, сигнатури форматів — зі спеки.

const MAX_20MB = 20 * 1024 * 1024;

// Magic bytes тестових файлів (незалежні від реалізації).
const JPEG_SIG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

function heicBytes(brand: string): Buffer {
  const b = Buffer.alloc(16);
  b.writeUInt32BE(16, 0); // розмір box
  b.write("ftyp", 4, "ascii");
  b.write(brand, 8, "ascii"); // major brand
  return b;
}

test("MIME визначається за magic bytes: JPEG, PNG, HEIC, PDF", async () => {
  const cases: Array<[Buffer, string]> = [
    [JPEG_SIG, "image/jpeg"],
    [PNG_SIG, "image/png"],
    [heicBytes("heic"), "image/heic"],
    [heicBytes("heix"), "image/heic"],
    [await makePdf(2), "application/pdf"],
  ];
  for (const [data, expected] of cases) {
    const result = await preflight(data);
    assert.equal(result.mimeType, expected, `bytes ${data.subarray(0, 12).toString("hex")}`);
  }
});

test("формати поза JPG/PNG/HEIC/PDF відкидаються", async () => {
  const cases: Buffer[] = [
    Buffer.from("просто текстовий файл"),
    Buffer.from("GIF89a"),
    heicBytes("avif"), // AVIF — поза дозволеним списком TB-0
    heicBytes("mif1"), // родовий HEIF-бренд — не є HEIC
    heicBytes("msf1"),
    Buffer.from("RIFF\x00\x00\x00\x00WEBP"),
    Buffer.alloc(64),
  ];
  for (const data of cases) {
    await assert.rejects(preflight(data), UnsupportedFormatError, `bytes ${data.subarray(0, 8).toString("hex")}`);
  }
});

test("файл понад 20MB відкидається (до перевірки формату)", async () => {
  await assert.rejects(preflight(Buffer.alloc(MAX_20MB + 1)), FileTooLargeError);
});

test("файл рівно 20MB проходить preflight", async () => {
  const data = Buffer.alloc(MAX_20MB);
  PNG_SIG.copy(data);
  const result = await preflight(data);
  assert.equal(result.mimeType, "image/png");
});

test("для PDF відома кількість сторінок", async () => {
  assert.equal((await preflight(await makePdf(1))).pageCount, 1);
  assert.equal((await preflight(await makePdf(3))).pageCount, 3);
});

test("для не-PDF pageCount — null", async () => {
  const result = await preflight(PNG_SIG);
  assert.equal(result.pageCount, null);
});

test("PDF із magic bytes, але пошкоджений — відхиляється", async () => {
  const corrupt = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from("garbage not a pdf")]);
  await assert.rejects(preflight(corrupt), InvalidPdfError);
});
