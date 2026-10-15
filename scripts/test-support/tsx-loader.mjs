import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";

// Load the actual client component and its aliases without a browser bundler.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/") || specifier.startsWith(".")) {
      const base = specifier.startsWith("@/")
        ? new URL(`../../${specifier.slice(2)}`, import.meta.url)
        : new URL(specifier, context.parentURL);
      for (const extension of [".ts", ".tsx"]) {
        const url = new URL(base.href + extension);
        if (existsSync(url)) return { url: url.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".tsx")) {
      return {
        format: "module",
        source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
          compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
        }).outputText,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});
