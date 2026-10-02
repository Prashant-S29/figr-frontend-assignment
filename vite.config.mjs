// Configures the SPA build and host ports; the fixed backend remains a separate process.
import { defineConfig } from "vite";

export default defineConfig({
  root: "frontend",
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  preview: { host: "127.0.0.1", port: 5173, strictPort: true },
});
