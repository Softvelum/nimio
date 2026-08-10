import { mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(viteConfig, {
  test: {
    include: ["tests/**/*.test.js"],
    // Real-browser tests run separately via vitest.browser.config.js.
    exclude: ["tests/browser/**"],
    silent: "passed-only",
    globals: true,
    environment: "jsdom",
    coverage: {
      include: ["src/**/**.js"],
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
