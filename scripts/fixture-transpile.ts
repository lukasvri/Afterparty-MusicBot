// TypeScript-only module transformation for synthetic Worker test fixtures.
// Keep the loader behavior independent of Node.js' built-in experimental
// TypeScript transform modes, which vary across supported Node versions.
import { readFileSync } from "node:fs";
import ts from "typescript";

export function transpileFixtureModule(url: URL | string) {
  const filename = new URL(url);
  const source = readFileSync(filename, "utf8");
  return ts.transpileModule(source, {
    fileName: filename.pathname,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      isolatedModules: true,
    },
  }).outputText;
}
