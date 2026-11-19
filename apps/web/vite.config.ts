import { readFile } from "node:fs/promises";
import { defineConfig } from "vite";

export default defineConfig({
  build: { license: { fileName: "licenses/dependencies.md" } },
  plugins: [{
    name: "stillish-core-license",
    apply: "build",
    async generateBundle() {
      for (const file of ["Apache-2.0.txt", "NOTICE.txt"]) {
        const source = await readFile(new URL("../../packages/core/licenses/" + file, import.meta.url));
        this.emitFile({ type: "asset", fileName: "licenses/" + file, source });
      }
    },
  }],
});
