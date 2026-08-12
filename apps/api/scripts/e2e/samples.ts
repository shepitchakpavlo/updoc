import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { MIN_READABLE_SIZE, SLOT_MARKER } from "../../src/assessment/mock.js";
import type { BookletSlot } from "../../src/checklist.js";

// Тестові файли наскрізного прогону (тикет 09): синтетичний вміст без PII,
// генеруються ЛИШЕ поза репо (за замовчуванням os.tmpdir()). Прийняті зразки
// несуть маркер мока (`mock:slot=<слот>`, той самий контракт, що в
// assessment/mock.ts) і не нижче порога читабельності; відхилений зразок
// несе маркер іншого слота — policy відхилить його з поясненням. PDF-зразок
// лишається валідним після вбудовування маркера (pdf-lib рахує сторінки).

/** Ім'я каталогу зразків у тимчасовій директорії (поза репо). */
export const SAMPLE_DIR_NAME = "updoc-e2e-samples";

export interface SampleFile {
  /** ім'я файла на диску */
  name: string;
  /** слот, у який файл треба завантажувати */
  slot: BookletSlot;
  /** мок-провайдер прийме файл (інакше policy/провайдер відхиляє) */
  accepted: boolean;
  /** що очікувати від API — підказка для людини й перевірок */
  note: string;
  /** абсолютний шлях (поза репо) */
  path: string;
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** PNG із маркером мока і паддінгом до порога читабельності. */
function makeMarkerPng(slot: BookletSlot): Buffer {
  return Buffer.concat([
    PNG_SIG,
    Buffer.from(`${SLOT_MARKER}${slot}\n`, "latin1"),
    // Паддінг після переносу рядка: маркер лишається першим рядком.
    Buffer.alloc(MIN_READABLE_SIZE, 0x01),
  ]);
}

/** Валідний PDF (1 сторінка) із маркером мока після %%EOF — розбір не ламається. */
async function makeMarkerPdf(slot: BookletSlot): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage();
  // Фіксовані дати: байти зразка детерміновані між запусками.
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  const bytes = await doc.save();
  return Buffer.concat([
    Buffer.from(bytes),
    // Маркер — окремий рядок після %%EOF; паддінг — після переносу, щоб не
    // ламати рядок маркера і тримати файл вище порога читабельності мока.
    Buffer.from(`\n${SLOT_MARKER}${slot}\n`, "latin1"),
    Buffer.alloc(MIN_READABLE_SIZE, 0x20),
  ]);
}

/** Замалий PNG (без маркера) — мок відхилить як нечитабельний. */
export function makeTooSmallFile(): Buffer {
  return Buffer.concat([PNG_SIG, Buffer.from("замалий для розпізнавання", "latin1")]);
}

interface SampleSpec {
  name: string;
  slot: BookletSlot;
  accepted: boolean;
  note: string;
  make: () => Buffer | Promise<Buffer>;
}

const SPECS: SampleSpec[] = [
  {
    name: "accepted-1-2.png",
    slot: "1-2",
    accepted: true,
    note: "завантажується в слот 1-2 — буде прийнято і записано в Drive",
    make: () => makeMarkerPng("1-2"),
  },
  {
    name: "accepted-11-12.pdf",
    slot: "11-12",
    accepted: true,
    note: "завантажується в слот 11-12 — буде прийнято і записано в Drive",
    make: () => makeMarkerPdf("11-12"),
  },
  {
    name: "rejected-wrong-slot.png",
    slot: "1-2",
    accepted: false,
    note: "завантажується в слот 1-2, але маркер слота 13-14 — policy відхилить із поясненням, у Drive не потрапить",
    make: () => makeMarkerPng("13-14"),
  },
];

/**
 * Гарантує наявність зразків у каталозі (поза репо): записує лише відсутні
 * файли — повторний прогін/ручний SPA-прохід не перезаписує наявні.
 * Повертає опис усіх зразків.
 */
export async function ensureSamples(dir: string): Promise<SampleFile[]> {
  mkdirSync(dir, { recursive: true });
  const samples: SampleFile[] = [];
  for (const spec of SPECS) {
    const path = join(dir, spec.name);
    if (!existsSync(path)) {
      writeFileSync(path, await spec.make());
    }
    samples.push({ name: spec.name, slot: spec.slot, accepted: spec.accepted, note: spec.note, path });
  }
  return samples;
}

/** Каталог зразків за замовчуванням: у тимчасовій директорії, поза репо. */
export function defaultSamplesDir(): string {
  return join(tmpdir(), SAMPLE_DIR_NAME);
}
