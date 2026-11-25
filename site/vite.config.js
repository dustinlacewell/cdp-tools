import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rolldownOptions: {
      input: ["index.html", "trace-query/index.html"].map(path =>
        fileURLToPath(new URL(path, import.meta.url))),
    },
  },
});
