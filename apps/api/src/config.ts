// Конфігурація API: дефолти працюють без .env (див. docker-compose.yml і .env.example);
// секрети сервісного акаунта — лише через змінні оточення (GOOGLE_*), ніколи в репо.
const DEFAULT_DATABASE_URL = "postgres://updoc:updoc@localhost:5432/updoc";
const DEFAULT_APP_BASE_URL = "http://localhost:5173";

export interface Config {
  databaseUrl: string;
  /** база лінка форми: {appBaseUrl}/a/{token} */
  appBaseUrl: string;
  /** id тестової папки Drive (не Shared Drive клієнтки) */
  driveTestFolderId: string;
  /** шлях до JSON-ключа сервісного акаунта — поза репо */
  driveCredentialsFile: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    databaseUrl: env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    appBaseUrl: env.APP_BASE_URL ?? DEFAULT_APP_BASE_URL,
    driveTestFolderId: env.GOOGLE_DRIVE_TEST_FOLDER_ID ?? "",
    driveCredentialsFile: env.GOOGLE_APPLICATION_CREDENTIALS ?? "",
  };
}
