import { mergeConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import viteConfig from "./vite.config";

// Real-browser tests for behavior jsdom cannot exercise: CSS layout
// (height definiteness probing) and ResizeObserver feedback loops.
export default mergeConfig(viteConfig, {
  test: {
    include: ["tests/browser/**/*.test.js"],
    silent: "passed-only",
    globals: true,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
      screenshotFailures: false,
    },
  },
});
