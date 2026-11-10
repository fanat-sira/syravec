import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  publicDir: loadEnv(mode, ".", "SYRAVEC_").SYRAVEC_TEST_PUBLIC_DIR || "public",
  server: { proxy: { "/api": "http://127.0.0.1:8080" } },
}));
