import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // Read only the port here. Provider credentials stay on the server.
  const env = loadEnv(mode, process.cwd(), "XQ_PORT");
  const port = process.env.XQ_PORT || env.XQ_PORT || "4320";
  const apiTarget = `http://127.0.0.1:${port}`;

  return {
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 5174,
      strictPort: true,
      proxy: {
        "/api": { target: apiTarget, changeOrigin: true },
        "/health": { target: apiTarget, changeOrigin: true },
      },
    },
    build: { outDir: "dist", emptyOutDir: true, license: true },
  };
});
