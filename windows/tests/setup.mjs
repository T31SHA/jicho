// Loaded before every test file (see the `test` script in package.json).
// Node runs the island's TypeScript through the compiler; this supplies what
// the webview and the bundler normally would.

import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { internals } from "./tauri.mjs";

// The sources import each other without an extension, which Vite resolves.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const ours = !context.parentURL?.includes("/node_modules/");
    if (ours && specifier.startsWith(".") && !/\.(?:[cm]?[jt]s|json)$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
  // Vite imports JSON (src/i18n/*.json) without `with { type: "json" }`;
  // Node would refuse it, so it is handed over as a module.
  load(url, context, nextLoad) {
    const path = url.startsWith("file:") ? fileURLToPath(url) : "";
    if (path.endsWith(".ts") && !path.includes("/node_modules/")) {
      const source = readFileSync(path, "utf8");
      const compiled = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
        fileName: path,
      });
      return { format: "module", source: compiled.outputText, shortCircuit: true };
    }
    if (path.endsWith(".json") && !path.includes("/node_modules/")) {
      const source = readFileSync(path, "utf8");
      return { format: "module", source: `export default ${source};`, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

// The island reaches timers and Tauri through `window`.
globalThis.window = globalThis;
globalThis.__TAURI_INTERNALS__ = internals;
