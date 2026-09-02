// Спільна база помилок API (тикет 04): код для клієнта + HTTP-статус.
// Повідомлення завжди без PII — жодних імен, токенів, вмісту файлів (спека TB-0).
export class ApiError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, statusCode: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.statusCode = statusCode;
  }
}
