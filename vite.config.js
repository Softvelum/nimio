import { defineConfig } from "vite";
import { resolve } from "path";
import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import copy from "rollup-plugin-copy";

let version = "unknown";
try {
  version = execSync("git describe --tags").toString().trim();
} catch (e) {
  console.error("No git tags found, using version = unknown");
}

const sslKeyPath = resolve(__dirname, "ssl/dev.key");
const sslCertPath = resolve(__dirname, "ssl/dev.crt");
const httpsConfig =
  existsSync(sslKeyPath) && existsSync(sslCertPath)
    ? {
        key: readFileSync(sslKeyPath),
        cert: readFileSync(sslCertPath),
      }
    : false;

export default defineConfig({
  base: "./",
  define: {
    __NIMIO_VERSION__: JSON.stringify(version),
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    lib: {
      entry: resolve(__dirname, "src/nimio.js"),
      formats: ["es"],
      fileName: () => `nimio-${version}.js`,
      cssFileName: `nimio-${version}`,
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
                  .replace(/\.\.\/src\/nimio\.js/g, `./nimio-${version}.js`)
                  .replace(/nimio\.css/g, `./nimio-${version}.css`),
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
    https: httpsConfig,
  },
  plugins: [
    // {
    //   // COOP/COEP required for SharedArrayBuffer
    //   name: "vite-plugin-coop-coep",
    //   // `npm run dev`
    //   configureServer(server) {
    //     server.middlewares.use((req, res, next) => {
    //       res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    //       res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    //       next();
    //     });
    //   },
    //   // `npm run preview`
    //   configurePreviewServer(server) {
    //     server.middlewares.use((req, res, next) => {
    //       res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    //       res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    //       next();
    //     });
    //   },
    // },
  ],
});
