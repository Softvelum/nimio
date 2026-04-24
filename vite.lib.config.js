import { defineConfig } from "vite";
import { resolve } from "path";
import { execSync } from "child_process";

let version = "unknown";
try {
  version = execSync("git describe --tags").toString().trim();
} catch (e) {
  console.error("No git tags found, using version = unknown");
}

export default defineConfig({
  publicDir: false,
  define: {
    __NIMIO_VERSION__: JSON.stringify(version),
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: "pkg",
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry: resolve(__dirname, "src/nimio.js"),
      formats: ["es"],
      fileName: () => "nimio.js",
      cssFileName: "nimio",
    },
    rollupOptions: {
      output: {
        assetFileNames: (asset) =>
          asset.name && asset.name.endsWith(".css")
            ? "nimio.css"
            : "assets/[name]-[hash][extname]",
        chunkFileNames: "chunks/[name]-[hash].js",
      },
    },
  },
  worker: {
    format: "es",
  },
});
