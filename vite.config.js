import { defineConfig } from "vite";
import { resolve } from "path";
import { execSync } from "child_process";
import copy from "rollup-plugin-copy";

const version = execSync("node scripts/get-version.js").toString().trim();

export default defineConfig({
  base: "./",
  define: {
    __NIMIO_VERSION__: JSON.stringify(version),
  },
  build: {
    lib: {
      entry: resolve(__dirname, "src/nimio.js"),
      formats: ["es"],
      fileName: () => `nimio-v${version}.js`,
      cssFileName: `nimio-v${version}`,
    },
    rollupOptions: {
      plugins: [
        copy({
          targets: [
            {
              src: "public/demo.html",
              dest: "dist",
              rename: "demo.html",
              transform: (contents) =>
                contents
                  .toString()
                  .replace(/nimio\.js/g, `nimio-v${version}.js`)
                  .replace(/nimio\.css/g, `nimio-v${version}.css`),
            },
          ],
          hook: "writeBundle",
        }),
      ],
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
