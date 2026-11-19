import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const test = await Bun.build({
  entrypoints: [fileURLToPath(new URL("../tests/browser-entry.ts", import.meta.url))],
  target: "browser",
  format: "iife",
});
if (!test.success) throw new AggregateError(test.logs, "Browser build failed");

runInNewContext(await test.outputs[0].text(), { TextEncoder, TextDecoder, crypto }, { timeout: 5000 });
console.log("Browser-target core passed with Web APIs only");
