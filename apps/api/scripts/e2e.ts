// CLI-вхід наскрізного прогону (тикет 09): `npm run e2e -w @updoc/api [-- --spa]`.
// Потрібні: запущений API (`make dev`) і секрети Drive в .env
// (GOOGLE_DRIVE_TEST_FOLDER_ID + GOOGLE_APPLICATION_CREDENTIALS — поза репо).
// Звичайний режим: весь ланцюжок через публічні ендпоінти з перевіркою
// результату в Drive; папка заявки прибирається наприкінці.
// `--spa`: лише заявка + лінк + зразки — для ручного SPA-проходу (папка
// лишається, її прибере наступний прогін). Токен і лінк у логи API не
// потрапляють: токен іде лише в заголовку x-access-token.
import "dotenv/config";
import { loadConfig } from "../src/config.js";
import { createDriveClient } from "../src/drive/client.js";
import { defaultSamplesDir } from "./e2e/samples.js";
import { prepareSpa, runSlice, type SliceEnv } from "./e2e/slice.js";

const HELP = `Наскрізний прогін TB-0 (тикет 09).

Використання:
  npm run e2e -w @updoc/api              — весь ланцюжок: заявка → лінк → upload →
                                          мок-assessment → policy → Drive (з перевіркою)
  npm run e2e -w @updoc/api -- --spa     — підготовка ручного SPA-проходу
                                          (заявка + лінк + зразки, папка лишається)

Прапори:
  --samples-dir=<path>   каталог зразків (дефолт os.tmpdir()/updoc-e2e-samples — поза репо)

Змінні оточення (GOOGLE_* — див. .env.example):
  API_BASE_URL          база API (дефолт http://localhost:3000)
  E2E_FULL_NAME         синтетичне ПІБ заявки (дефолт "Працівник E2E")
  E2E_COMPANY           синтетична компанія (дефолт "ТОВ E2E")
  GOOGLE_DRIVE_TEST_FOLDER_ID    тестова папка Drive (обов'язково)
  GOOGLE_APPLICATION_CREDENTIALS JSON-ключ сервісного акаунта (обов'язково)

Зразки тестових файлів генеруються поза репо (os.tmpdir()/updoc-e2e-samples)
і ніколи не комітяться.`;

function parseSamplesDir(args: string[]): string | null {
  const flag = args.find((arg) => arg.startsWith("--samples-dir="));
  if (flag === undefined) {
    return null;
  }
  const value = flag.slice("--samples-dir=".length);
  return value.length > 0 ? value : null;
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}
const spaMode = args.includes("--spa");

const config = loadConfig();
if (!config.driveTestFolderId) {
  console.error("GOOGLE_DRIVE_TEST_FOLDER_ID не задано — див. .env.example");
  process.exit(1);
}
if (!config.driveCredentialsFile) {
  console.error(
    "GOOGLE_APPLICATION_CREDENTIALS не задано — шлях до JSON-ключа сервісного акаунта (поза репо)",
  );
  process.exit(1);
}

const env: SliceEnv = {
  apiBaseUrl: process.env.API_BASE_URL ?? "http://localhost:3000",
  fetchImpl: fetch,
  drive: createDriveClient({ credentialsFile: config.driveCredentialsFile }),
  testFolderId: config.driveTestFolderId,
  samplesDir: parseSamplesDir(args) ?? defaultSamplesDir(),
  fullName: process.env.E2E_FULL_NAME ?? "Працівник E2E",
  company: process.env.E2E_COMPANY ?? "ТОВ E2E",
  log: (line) => console.log(line),
};

if (spaMode) {
  try {
    const prep = await prepareSpa(env);
    console.log("\nSPA-прохід підготовлено:");
    console.log(`Лінк форми: ${prep.link}`);
    console.log(`Папка в тестовому Drive: «${prep.folderName}» (лишається для ручного проходу)`);
    console.log("Зразки (поза репо):");
    for (const sample of prep.samples) {
      console.log(`  ${sample.path}  — слот ${sample.slot}: ${sample.note}`);
    }
    console.log(
      "Порядок ручного проходу: спершу відхилений зразок (перевірте пояснення і що файла немає",
      "в папці Drive), потім прийняті — кожен з'являється в папці заявки.",
    );
    if (prep.staleRemoved > 0) {
      console.log(`Прибрано старих папок попередніх прогонів: ${prep.staleRemoved}`);
    }
    process.exit(0);
  } catch (err) {
    console.error(`SPA-підготовка не вдалася: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

const result = await runSlice(env);
if (result.ok) {
  console.log("\n=== НАСКРІЗНИЙ ПРОГІН TB-0: УСПІХ ===");
} else {
  console.error("\n=== НАСКРІЗНИЙ ПРОГІН TB-0: НЕВДАЧА ===");
  process.exitCode = 1;
}
