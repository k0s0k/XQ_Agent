import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { startAppServer } from "../src/server/app-server.mjs";
import { loadEnvironment, projectRoot } from "./environment.mjs";

loadEnvironment();

const require = createRequire(import.meta.url);
const viteCli = resolve(dirname(require.resolve("vite/package.json")), "bin/vite.js");
const server = await startAppServer({
  allowedOrigins: ["http://127.0.0.1:5174", "http://localhost:5174"],
});
const vite = spawn(process.execPath, [viteCli], {
  cwd: projectRoot,
  stdio: "inherit",
  windowsHide: true,
});

console.log("心桥开发服务已启动：http://127.0.0.1:5174");

let closing = false;
function shutdown(exitCode = 0) {
  if (closing) return;
  closing = true;
  if (vite.exitCode === null) vite.kill();
  server.close();
  server.closeAllConnections();
  process.exitCode = exitCode;
}

vite.on("error", (error) => {
  console.error(error.message);
  shutdown(1);
});
vite.on("exit", (code) => shutdown(code ?? 0));
process.once("SIGINT", () => shutdown());
process.once("SIGTERM", () => shutdown());
