import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = fileURLToPath(new URL("../", import.meta.url));

export function loadEnvironment() {
  const envPath = resolve(projectRoot, ".env");
  if (existsSync(envPath)) process.loadEnvFile(envPath);
}
