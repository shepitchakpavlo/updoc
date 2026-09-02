import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // У dev SPA і API на різних портах; відносні шляхи форми проксіюються
    // на API (:3000), у проді SPA сервиться тим самим origin (Phase 1).
    proxy: {
      "/applications": "http://localhost:3000",
    },
  },
});
