import assert from "node:assert/strict";
import { test } from "node:test";
import { generateToken, hashToken } from "../src/tokens.js";

// Контракт токена (тикет 03): криптографічно випадковий токен,
// у БД — лише sha256-хеш (Architecture §5: access token — випадковий, зберігається hash).

test("generateToken повертає унікальний токен достатньої ентропії", () => {
  const token = generateToken();
  assert.equal(typeof token, "string");
  assert.ok(token.length >= 32, "токен має бути не коротшим за 32 символи");
  const seen = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    seen.add(generateToken());
  }
  assert.equal(seen.size, 1000, "1000 токенів — жодного збігу");
});

test("hashToken — sha256 hex 64 символи, незворотний і детермінований", () => {
  assert.equal(hashToken("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.match(hashToken("token"), /^[0-9a-f]{64}$/);
  assert.equal(hashToken("token"), hashToken("token"));
  assert.notEqual(hashToken("token"), hashToken("token2"));
});

test("hashToken не повертає сирий токен", () => {
  const token = generateToken();
  assert.notEqual(hashToken(token), token);
});
