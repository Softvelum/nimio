import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  base: './',
  build: {
    lib: {
      entry: resolve(__dirname, "src/nimio.js"),
      formats: ["es"],
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
  },
  plugins: [
    {
      // COOP/COEP required for SharedArrayBuffer
      name: "vite-plugin-coop-coep",
      // `npm run dev`
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
          res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
          next();
        });
      },
      // `npm run preview`
      configurePreviewServer(server) {
        server.middlewares.use((req, res, next) => {
          res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
          res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
          next();
        });
      },
    },
  ],
});
