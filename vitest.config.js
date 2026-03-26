import { mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(viteConfig, {
  test: {
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
