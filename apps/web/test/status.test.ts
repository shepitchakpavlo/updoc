import { describe, expect, it } from "vitest";
import { SLOT_STATUS_LABELS } from "../src/status";

// Мітки чотирьох станів слота зі спеки TB-0 / Architecture §4:
// очікується → перевіряється → прийнято | потрібно перезавантажити.
describe("SLOT_STATUS_LABELS", () => {
  it("покриває всі стани слота", () => {
    expect(SLOT_STATUS_LABELS).toEqual({
      pending: "Очікується",
      checking: "Перевіряється",
      accepted: "Прийнято",
      needs_reupload: "Потрібно перезавантажити",
    });
  });
});
