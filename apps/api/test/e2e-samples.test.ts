import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createMockAssessmentProvider } from "../src/assessment/mock.js";
import { decidePolicy } from "../src/policy/index.js";
import { preflight } from "../src/preflight/index.js";
import { ensureSamples, makeTooSmallFile } from "../scripts/e2e/samples.js";

// Seam: генератор тестових файлів тикета 09 — файли поза репо, синтетичний
// вміст без PII. Кожен зразок проходить реальний preflight і мок-assessment:
// прийняті — з маркером власного слота (≥4KB), відхилений — маркер іншого
// слота (policy дає причину-фідбек). PDF лишається валідним після вбудовування
// маркера (pdf-lib рахує сторінки) — зразок, який не проходить preflight,
// не придатний для наскрізного прогону.

const assessment = createMockAssessmentProvider();

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "updoc-e2e-samples-test-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("ensureSamples створює три зразки в каталозі поза репо", async () => {
  const dir = tempDir();
  const samples = await ensureSamples(dir);
  assert.deepEqual(
    samples.map((s) => s.name).sort(),
    ["accepted-1-2.png", "accepted-11-12.pdf", "rejected-wrong-slot.png"],
  );
  for (const sample of samples) {
    assert.ok(readFileSync(sample.path).length > 0, sample.name);
  }
});

test("прийнятий PNG: preflight image/png, мок бачить слот 1-2 і приймає", async () => {
  const dir = tempDir();
  const [png] = (await ensureSamples(dir)).filter((s) => s.name === "accepted-1-2.png");
  assert.ok(png);
  const data = readFileSync(png.path);
  assert.deepEqual(await preflight(data), { mimeType: "image/png", pageCount: null });
  const result = await assessment.assess(data);
  assert.equal(result.accepted, true);
  assert.equal(result.recognizedSlot, "1-2");
  assert.ok(data.length >= 4 * 1024, "не нижче порога читабельності мока");
});

test("прийнятий PDF: preflight application/pdf зі сторінками, мок бачить слот 11-12", async () => {
  const dir = tempDir();
  const [pdf] = (await ensureSamples(dir)).filter((s) => s.name === "accepted-11-12.pdf");
  assert.ok(pdf);
  const data = readFileSync(pdf.path);
  const pre = await preflight(data);
  assert.equal(pre.mimeType, "application/pdf");
  assert.equal(typeof pre.pageCount, "number");
  assert.ok((pre.pageCount ?? 0) >= 1, "маркер не ламає розбір PDF");
  const result = await assessment.assess(data);
  assert.equal(result.accepted, true);
  assert.equal(result.recognizedSlot, "11-12");
});

test("відхилений зразок: мок бачить інший слот, policy дає причину про слот", async () => {
  const dir = tempDir();
  const [wrong] = (await ensureSamples(dir)).filter((s) => s.name === "rejected-wrong-slot.png");
  assert.ok(wrong);
  const data = readFileSync(wrong.path);
  assert.deepEqual(await preflight(data), { mimeType: "image/png", pageCount: null });
  const result = await assessment.assess(data);
  assert.equal(result.accepted, true, "провайдер «розпізнає» маркер");
  assert.equal(result.recognizedSlot, "13-14");
  const decision = decidePolicy("1-2", result);
  assert.equal(decision.accepted, false);
  assert.match(decision.reason ?? "", /не відповідає слоту/);
});

test("замалий файл: мок відхиляє з причиною (feedback для працівника)", async () => {
  const data = makeTooSmallFile();
  assert.deepEqual(await preflight(data), { mimeType: "image/png", pageCount: null });
  const result = await assessment.assess(data);
  assert.equal(result.accepted, false);
  assert.match(result.reason ?? "", /замалий/);
});

test("ensureSamples ідемпотентний: повторний виклик не перезаписує наявні файли", async () => {
  const dir = tempDir();
  const samples = await ensureSamples(dir);
  const target = samples.find((s) => s.name === "accepted-1-2.png");
  assert.ok(target);
  // Псуємо файл: якби ensureSamples перезаписував зразки наново, він відновив би байти.
  const corrupted = Buffer.concat([readFileSync(target.path), Buffer.from("corrupt")]);
  writeFileSync(target.path, corrupted);
  await ensureSamples(dir);
  assert.ok(readFileSync(target.path).equals(corrupted), "наявний файл не перезаписується");
});
