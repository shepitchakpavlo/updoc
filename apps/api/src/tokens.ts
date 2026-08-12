import { createHash, randomBytes } from "node:crypto";

// Access token заявки (тикет 03): криптографічно випадковий, 256 біт (base64url).
// У БД зберігається лише sha256-хеш (Architecture §5) — сирий токен незворотний.

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
