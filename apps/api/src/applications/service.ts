import { BOOKLET_SLOTS, type BookletSlot } from "../checklist.js";
import type { DriveClient } from "../drive/client.js";
import { generateToken, hashToken } from "../tokens.js";
import type { ApplicationRepo } from "./repo.js";

// Створення заявки й доступ за токеном (тикет 03):
// токен випадковий, у БД — лише hash; папка «ПІБ — Компанія» у тестовій папці Drive
// одразу; існуюча папка для іншої заявки — hard error без суфіксів (Architecture §6).

export class FolderExistsError extends Error {
  readonly code = "folder_exists";

  constructor() {
    super("Папка для такої заявки вже існує в тестовому Drive");
    this.name = "FolderExistsError";
  }
}

export interface CreateApplicationInput {
  company: string;
  fullName: string;
}

export interface ApplicationView {
  company: string;
  fullName: string;
  checklist: BookletSlot[];
}

export interface ApplicationService {
  createApplication(input: CreateApplicationInput): Promise<{ link: string }>;
  getApplicationByToken(token: string): Promise<ApplicationView | null>;
}

export interface ApplicationServiceDeps {
  repo: ApplicationRepo;
  drive: DriveClient;
  testFolderId: string;
  appBaseUrl: string;
}

// Ім'я папки заявки в тестовому Drive — єдине джерело правди: сервіс створює,
// наскрізний сценарій (scripts/e2e) шукає і прибирає за тим самим форматом.
export function applicationFolderName(fullName: string, company: string): string {
  return `${fullName} — ${company}`;
}

export function createApplicationService(deps: ApplicationServiceDeps): ApplicationService {
  return {
    async createApplication({ company, fullName }) {
      if (!deps.testFolderId) {
        throw new Error("Google Drive не налаштований: задайте GOOGLE_DRIVE_TEST_FOLDER_ID");
      }
      const token = generateToken();
      const folderName = applicationFolderName(fullName, company);
      const existing = await deps.drive.findFoldersByName(folderName, deps.testFolderId);
      if (existing.length > 0) {
        throw new FolderExistsError();
      }
      const folderId = await deps.drive.createFolder(folderName, deps.testFolderId);
      try {
        // Повторна перевірка після створення: конкурентна заявка могла створити папку
        // з тим самим ім'ям у проміжку — тоді це теж hard error, без дублікатів.
        const after = await deps.drive.findFoldersByName(folderName, deps.testFolderId);
        if (after.some((id) => id !== folderId)) {
          throw new FolderExistsError();
        }
        await deps.repo.insert({ company, fullName, tokenHash: hashToken(token), folderId });
      } catch (err) {
        // Бест-еффорт: щойно створена папка не має блокувати повторну спробу (hard error без суфіксів).
        await deps.drive.deleteFolder(folderId).catch(() => undefined);
        throw err;
      }
      return { link: `${deps.appBaseUrl}/a/${token}` };
    },
    async getApplicationByToken(token) {
      const row = await deps.repo.findByTokenHash(hashToken(token));
      if (!row) {
        return null;
      }
      return { company: row.company, fullName: row.fullName, checklist: [...BOOKLET_SLOTS] };
    },
  };
}
