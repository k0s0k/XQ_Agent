import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { startAppServer } from "../src/server/app-server.mjs";
import { loadEnvironment, projectRoot } from "./environment.mjs";

loadEnvironment();

const webDir = resolve(projectRoot, "dist");
if (!existsSync(resolve(webDir, "index.html"))) {
  console.error("未找到前端页面。请先运行 pnpm build，再运行 pnpm start。");
  process.exitCode = 1;
} else {
  const server = await startAppServer({ webDir });
  const address = server.address();
  console.log(`心桥 · XQ Agent：http://127.0.0.1:${address.port}`);
  console.log("对话和接诊记录保存在内存中，停止服务后清除。请及时导出需要保留的摘要。");
  console.log("知识库文档保存在本机 .local/knowledge，可用 XQ_KNOWLEDGE_DIR 修改。");

  function shutdown() {
    server.close();
    server.closeAllConnections();
  }
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
