import { defineConfig } from "drizzle-kit";

// Той самий дефолт, що в docker-compose.yml; перевизначення — через .env (див. .env.example).
const DEFAULT_DATABASE_URL = "postgres://updoc:updoc@localhost:5432/updoc";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  },
});
