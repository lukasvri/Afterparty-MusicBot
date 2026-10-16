// Compatibility entry point for previously configured installers.
export { NpmCacheProgress, runNpmInstall } from "./npm-install.ts";
import { npmInstallMain } from "./npm-install.ts";
await npmInstallMain(import.meta.url);
