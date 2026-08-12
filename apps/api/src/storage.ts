// Контракт TemporaryStorage (Architecture §5): зберігання файла між upload
// і записом у Drive. У TB-0 НЕ реалізується — файл тримається в пам'яті
// процесу під час запиту (Buffer у upload-потоці). Реалізація — Phase 1.
export interface TemporaryStorage {
  put(key: string, data: Buffer): Promise<void>;
  read(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}
