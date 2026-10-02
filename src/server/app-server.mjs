import http from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ASSESSMENTS, scoreAssessment } from "../shared/assessments.mjs";
import {
  classifySafety,
  crisisResponse,
  mergeRisk,
  SAFETY_CHECK_MESSAGE,
} from "./safety-rules.mjs";
import { buildSummary } from "./assistant-prompts.mjs";
import {
  HttpError,
  fail,
  validateText,
  validateFields,
  validateBoolean,
  validateTopK,
  validateSessionKind,
  validateProviderUrl,
  readJson,
  LOOPBACK_HOSTS,
  MIME_TYPES,
} from "./http-utils.mjs";
import { createModelProvider } from "./model-provider.mjs";
import { createKnowledgeStore } from "./knowledge-store.mjs";
import { parseKnowledgeFile } from "./document-parser.mjs";

const SERVER_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const API_PREFIX = "/api";
function createMessage(role, content) {
  return { id: randomUUID(), role, content, createdAt: new Date().toISOString() };
}
function touchSession(session) {
  session.updatedAt = new Date().toISOString();
}
async function runKnowledgeAction(action) {
  try {
    return await action();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (
      [400, 404, 409, 413, 415, 422, 503].includes(error.status) &&
      typeof error.code === "string"
    )
      fail(error.status, error.code, error.message);
    fail(503, "KNOWLEDGE_UNAVAILABLE", "知识库暂不可用，请检查本地知识库文件和写入权限。");
  }
}

/** Returns a standard, unbound Node HTTP server. All case data and API keys stay in memory. */
export function createAppServer(options = {}) {
  const host = options.host ?? "127.0.0.1";
  if (!LOOPBACK_HOSTS.has(host)) throw new Error("XQ Agent only supports loopback addresses.");
  const env = options.env ?? process.env;
  const webDir = path.resolve(options.webDir ?? path.join(SERVER_DIRECTORY, "../../dist"));
  const sessions = new Map();
  const activeSessions = new Map();
  const maxSessions = options.maxSessions ?? 100;
  const maxMessages = options.maxMessages ?? 200;
  const maxProviderConcurrency = options.maxProviderConcurrency ?? 3;
  const providerTimeoutMs = options.providerTimeoutMs ?? 25_000;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const knowledge =
    options.knowledgeStore ??
    createKnowledgeStore({ directory: options.knowledgeDirectory ?? null });
  const knowledgeStorage = options.knowledgeDirectory ? "local" : "memory";
  let activeImports = 0;
  const allowedOrigins = new Set(
    (options.allowedOrigins ?? []).map((origin) => {
      const url = new URL(origin);
      if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname) || url.origin !== origin)
        throw new Error("Development origins must be exact loopback HTTP origins.");
      return origin;
    }),
  );
  let settings = {
    baseUrl: validateProviderUrl(env.XQ_BASE_URL || "https://api.openai.com/v1"),
    model: validateText(env.XQ_MODEL || "", "模型名称", 150),
    apiKey: validateText(env.XQ_API_KEY || "", "API 密钥", 4096),
  };
  const publicSettings = () => ({
    mode: settings.apiKey && settings.model ? "live" : "demo",
    model: settings.model,
    configured: Boolean(settings.apiKey && settings.model),
    baseUrl: settings.baseUrl,
  });

  const modelProvider = createModelProvider({
    getSettings: () => settings,
    knowledge,
    fetchImpl,
    maxProviderConcurrency,
    providerTimeoutMs,
  });

  const server = http.createServer(async (req, res) => {
    const responseHeaders = {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    };
    for (const [name, value] of Object.entries(responseHeaders)) res.setHeader(name, value);
    const json = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(data));
    };
    try {
      const bound = server.address();
      const expectedPort =
        typeof bound === "object" && bound ? bound.port : Number(options.port ?? 4320);
      let requestUrl;
      try {
        requestUrl = new URL(`http://${req.headers.host ?? ""}`);
      } catch {
        fail(403, "LOCAL_ONLY", "仅允许本机同源访问。");
      }
      if (
        !LOOPBACK_HOSTS.has(requestUrl.hostname) ||
        Number(requestUrl.port || 80) !== expectedPort ||
        requestUrl.username ||
        requestUrl.password ||
        requestUrl.pathname !== "/"
      )
        fail(403, "LOCAL_ONLY", "仅允许本机同源访问。");
      if (req.headers["sec-fetch-site"] === "cross-site" && !allowedOrigins.has(req.headers.origin))
        fail(403, "ORIGIN_REJECTED", "不允许跨站访问本地接诊数据。");
      if (
        req.headers.origin &&
        req.headers.origin !== requestUrl.origin &&
        !allowedOrigins.has(req.headers.origin)
      )
        fail(403, "ORIGIN_REJECTED", "不允许跨域访问本地接诊数据。");
      const rawPath = (req.url ?? "/").split("?")[0];
      let decoded;
      try {
        decoded = decodeURIComponent(rawPath);
      } catch {
        fail(400, "INVALID_PATH", "请求路径无效。");
      }
      if (
        decoded.includes("\\") ||
        decoded.includes("\0") ||
        decoded.split("/").some((part) => part === ".." || part === ".") ||
        decoded.includes(":")
      )
        fail(400, "INVALID_PATH", "请求路径无效。");
      const pathname = new URL(req.url, requestUrl.origin).pathname.replace(/\/+$/, "") || "/";
      if (pathname === "/health" && req.method === "GET")
        return json(200, { status: "ok", service: "xq-agent", storage: "memory" });
      if (pathname === `${API_PREFIX}/status` && req.method === "GET")
        return json(200, { ...publicSettings(), storage: "memory", sessionCount: sessions.size });
      if (pathname === `${API_PREFIX}/settings` && req.method === "GET")
        return json(200, publicSettings());
      if (pathname === `${API_PREFIX}/assessments` && req.method === "GET")
        return json(200, { assessments: ASSESSMENTS });
      if (pathname === `${API_PREFIX}/knowledge/search` && req.method === "POST") {
        const body = await readJson(req, 65_536);
        validateFields(body, ["query", "limit", "unit"]);
        const query = validateText(body.query, "检索问题", 6000, { required: true });
        const unit = "unit" in body ? body.unit : "chunks";
        if (!["chunks", "documents"].includes(unit))
          fail(400, "INVALID_INPUT", "检索单位必须为 chunks 或 documents。");
        const limit = "limit" in body ? body.limit : 5;
        const sources = await runKnowledgeAction(() =>
          unit === "documents"
            ? knowledge.searchDocuments({ query, topK: validateTopK(limit) })
            : knowledge.search({ query, limit }),
        );
        return json(200, { sources, query, method: "bm25", unit });
      }
      if (pathname === `${API_PREFIX}/knowledge`) {
        if (req.method === "GET")
          return json(200, {
            documents: await runKnowledgeAction(() => knowledge.list()),
            retrieval: "bm25",
            storage: knowledgeStorage,
          });
        if (req.method === "POST") {
          if (activeImports >= 2) fail(429, "IMPORT_BUSY", "文档正在导入，请稍后重试。");
          activeImports += 1;
          try {
            const body = await readJson(req, 7_100_000);
            validateFields(body, [
              "title",
              "content",
              "source",
              "filename",
              "dataBase64",
              "enabled",
              "allowExternal",
            ]);
            const isFile = "filename" in body || "dataBase64" in body;
            if (isFile && "content" in body)
              fail(400, "INVALID_INPUT", "请一次导入文件或文本，不能同时提交。");
            const parsed = isFile
              ? await runKnowledgeAction(() => parseKnowledgeFile(body))
              : { content: body.content, format: "text" };
            const document = await runKnowledgeAction(() =>
              knowledge.add({
                ...parsed,
                title: body.title ?? parsed.title,
                source: body.source ?? "",
                enabled: body.enabled ?? true,
                allowExternal: body.allowExternal ?? false,
              }),
            );
            return json(201, { document });
          } finally {
            activeImports -= 1;
          }
        }
        fail(405, "METHOD_NOT_ALLOWED", "此路径不支持该请求方法。");
      }
      const knowledgeMatch = pathname.match(/^\/api\/knowledge\/([^/]+)$/);
      if (knowledgeMatch) {
        const id = knowledgeMatch[1];
        if (req.method === "GET")
          return json(200, { document: await runKnowledgeAction(() => knowledge.get(id)) });
        if (req.method === "PATCH") {
          const body = await readJson(req, 65_536);
          validateFields(body, ["enabled", "allowExternal", "title", "source"]);
          const document = await runKnowledgeAction(() => knowledge.update(id, body));
          if (body.enabled === false || body.allowExternal === false)
            modelProvider.abortAll("knowledge_changed");
          return json(200, { document });
        }
        if (req.method === "DELETE") {
          await runKnowledgeAction(() => knowledge.remove(id));
          modelProvider.abortAll("knowledge_changed");
          return json(200, { deleted: true });
        }
        fail(405, "METHOD_NOT_ALLOWED", "此路径不支持该请求方法。");
      }
      if (pathname === `${API_PREFIX}/settings` && req.method === "POST") {
        const body = await readJson(req, 65_536);
        validateFields(body, ["baseUrl", "model", "apiKey"]);
        const next = { ...settings };
        if ("baseUrl" in body) {
          next.baseUrl = validateProviderUrl(body.baseUrl);
          if (next.baseUrl !== settings.baseUrl && !("apiKey" in body)) next.apiKey = "";
        }
        if ("model" in body) next.model = validateText(body.model, "模型名称", 150);
        if ("apiKey" in body) next.apiKey = validateText(body.apiKey, "API 密钥", 4096);
        if (next.baseUrl !== settings.baseUrl) {
          for (const session of sessions.values()) {
            session.consent = false;
            touchSession(session);
          }
          modelProvider.abortAll();
        }
        settings = next;
        return json(200, publicSettings());
      }
      if (pathname === `${API_PREFIX}/sessions`) {
        if (req.method === "GET")
          return json(200, {
            sessions: [...sessions.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
          });
        if (req.method === "POST") {
          if (sessions.size >= maxSessions)
            fail(409, "SESSION_LIMIT", "本次运行的个案数量已达上限，请先删除不再需要的个案。");
          const body = await readJson(req, 65_536);
          validateFields(body, [
            "name",
            "ageRange",
            "concern",
            "consent",
            "useKnowledge",
            "kind",
            "topK",
          ]);
          if (sessions.size >= maxSessions)
            fail(409, "SESSION_LIMIT", "本次运行的个案数量已达上限，请先删除不再需要的个案。");
          const now = new Date().toISOString();
          const kind = validateSessionKind("kind" in body ? body.kind : "intake");
          const concern = validateText(body.concern ?? "", "主诉", 6000);
          const safety = classifySafety(concern);
          const session = {
            id: randomUUID(),
            name: validateText(
              body.name ?? (kind === "chat" ? "新对话" : "未命名个案"),
              "对话名称",
              80,
              { required: true },
            ),
            kind,
            topK: validateTopK("topK" in body ? body.topK : 5),
            ageRange: validateText(body.ageRange ?? "", "年龄范围", 80),
            concern,
            consent: validateBoolean(body.consent ?? false),
            notes: "",
            createdAt: now,
            updatedAt: now,
            messages: [],
            risk: safety.risk,
            summary: null,
            useKnowledge: validateBoolean(body.useKnowledge ?? true),
          };
          if (safety.risk === "urgent")
            session.messages.push(createMessage("assistant", crisisResponse(safety.reason)));
          else if (safety.risk === "attention")
            session.messages.push(createMessage("assistant", SAFETY_CHECK_MESSAGE));
          sessions.set(session.id, session);
          return json(201, { session });
        }
        fail(405, "METHOD_NOT_ALLOWED", "此路径不支持该请求方法。");
      }
      const match = pathname.match(
        /^\/api\/sessions\/([^/]+)(?:\/(messages|summary|assessment))?$/,
      );
      if (match) {
        const [, id, operation] = match;
        const session = sessions.get(id);
        if (!session) fail(404, "SESSION_NOT_FOUND", "个案不存在或已在服务重启后清除。");
        if (!operation && req.method === "GET") return json(200, { session });
        if (!operation && req.method === "DELETE") {
          activeSessions.get(id)?.abort();
          sessions.delete(id);
          return json(200, { deleted: true });
        }
        if (!operation && req.method === "PATCH") {
          const body = await readJson(req, 65_536);
          validateFields(body, [
            "name",
            "ageRange",
            "concern",
            "consent",
            "notes",
            "useKnowledge",
            "topK",
          ]);
          const changes = {};
          if ("name" in body)
            changes.name = validateText(body.name, "个案代号", 80, { required: true });
          if ("ageRange" in body) changes.ageRange = validateText(body.ageRange, "年龄范围", 80);
          if ("concern" in body) changes.concern = validateText(body.concern, "主诉", 6000);
          if ("notes" in body) changes.notes = validateText(body.notes, "咨询师笔记", 20_000);
          if ("consent" in body) changes.consent = validateBoolean(body.consent);
          if ("useKnowledge" in body) changes.useKnowledge = validateBoolean(body.useKnowledge);
          if ("topK" in body) changes.topK = validateTopK(body.topK);
          const withdrawal = changes.consent === false;
          const safety = classifySafety(`${changes.concern ?? ""}\n${changes.notes ?? ""}`);
          if (activeSessions.has(id) && !withdrawal && safety.risk !== "urgent")
            fail(409, "SESSION_BUSY", "个案正在处理，请稍后再修改。");
          if (withdrawal || safety.risk === "urgent") activeSessions.get(id)?.abort();
          Object.assign(session, changes);
          const increased = mergeRisk(session.risk, safety.risk) !== session.risk;
          session.risk = mergeRisk(session.risk, safety.risk);
          if (increased && session.messages.length < maxMessages)
            session.messages.push(
              createMessage(
                "assistant",
                safety.risk === "urgent" ? crisisResponse(safety.reason) : SAFETY_CHECK_MESSAGE,
              ),
            );
          if (Object.keys(changes).some((key) => key !== "consent")) session.summary = null;
          touchSession(session);
          return json(200, { session });
        }
        if (operation && req.method === "POST") {
          const body = await readJson(req, 65_536);
          if (activeSessions.has(id)) {
            if (
              operation === "messages" &&
              typeof body?.content === "string" &&
              classifySafety(body.content).risk === "urgent"
            )
              activeSessions.get(id).abort();
            else fail(409, "SESSION_BUSY", "此个案正在处理上一条记录，请稍后重试。");
          }
          if (operation === "summary") {
            validateFields(body, []);
            session.summary = buildSummary(session);
            touchSession(session);
            return json(200, { session });
          }
          if (operation === "assessment") {
            validateFields(body, ["instrument", "answers"]);
            let assessment;
            try {
              assessment = scoreAssessment(body.instrument, body.answers);
            } catch {
              fail(
                400,
                "INVALID_ASSESSMENT",
                "量表名称、题目数量或答案无效；每题应选择 0–3 的整数。",
              );
            }
            if (assessment.requiresSafetyCheck && session.messages.length >= maxMessages)
              fail(409, "MESSAGE_LIMIT", "本个案记录已达上限，请创建新的接诊记录。");
            session.assessment = assessment;
            session.summary = null;
            if (assessment.requiresSafetyCheck) {
              session.risk = mergeRisk(session.risk, "attention");
              session.messages.push(createMessage("assistant", SAFETY_CHECK_MESSAGE));
            }
            touchSession(session);
            return json(200, { session });
          }
          validateFields(body, ["content"]);
          const content = validateText(body.content, "访谈记录", 6000, { required: true });
          if (session.messages.length + 2 > maxMessages)
            fail(409, "MESSAGE_LIMIT", "本个案记录已达上限，请创建新的接诊记录。");
          const safety = classifySafety(content);
          const nextRisk = mergeRisk(session.risk, safety.risk);
          const controller = new AbortController();
          activeSessions.set(id, controller);
          const onClose = () => {
            if (!res.writableEnded) controller.abort();
          };
          res.on("close", onClose);
          try {
            let answer;
            let responseMode = "safety";
            let knowledgeDependencies = [];
            let sources = [];
            const isChat = session.kind === "chat";
            const retrieval = {
              status: "safety",
              method: "bm25",
              unit: isChat ? "documents" : "chunks",
              requestedTopK: session.topK,
              matchedDocuments: 0,
              providedDocuments: 0,
            };
            if (nextRisk === "urgent") answer = crisisResponse(safety.reason);
            else {
              retrieval.status = "disabled";
              if (session.useKnowledge) {
                const documents = await runKnowledgeAction(() => knowledge.list());
                retrieval.status = documents.some((document) => document.enabled)
                  ? "no_match"
                  : "empty";
                sources = await runKnowledgeAction(() =>
                  isChat
                    ? knowledge.searchDocuments({ query: content, topK: session.topK })
                    : knowledge.search({ query: content, limit: session.topK }),
                );
                if (sources.length) retrieval.status = "local";
                if (session.consent && settings.apiKey && settings.model) {
                  const externalSources = isChat
                    ? sources.filter((source) => source.allowExternal)
                    : await runKnowledgeAction(() =>
                        knowledge.search({
                          query: content,
                          limit: session.topK,
                          externalOnly: true,
                        }),
                      );
                  retrieval.externalExcluded = sources.filter(
                    (source) => !source.allowExternal,
                  ).length;
                  if (externalSources.length) {
                    if (!isChat) sources = externalSources;
                    retrieval.status = "used";
                  }
                }
              }
              sources = sources.map((source) => ({
                ...source,
                providedToModel: retrieval.status === "used" && source.allowExternal,
              }));
              retrieval.matchedDocuments = new Set(sources.map((source) => source.documentId)).size;
              const providedSources = sources.filter((source) => source.providedToModel);
              retrieval.providedDocuments = new Set(
                providedSources.map((source) => source.documentId),
              ).size;
              const generated = await modelProvider.generateResponse(
                session,
                content,
                controller,
                providedSources,
              );
              answer = generated.content;
              knowledgeDependencies = generated.knowledgeDependencies;
              responseMode = generated.responseMode;
              if (responseMode !== "llm") {
                sources = sources.map((source) => ({ ...source, providedToModel: false }));
                retrieval.providedDocuments = 0;
                if (retrieval.status === "used") retrieval.status = "local";
              }
              if (nextRisk === "attention") answer = `${SAFETY_CHECK_MESSAGE}\n\n${answer}`;
            }
            if (!sessions.has(id)) fail(409, "REQUEST_CANCELLED", "个案已删除，本次处理已取消。");
            if (controller.signal.aborted)
              fail(409, "REQUEST_CANCELLED", "本次处理已取消，请重试。");
            session.messages.push(createMessage("user", content), {
              ...createMessage("assistant", answer),
              sources,
              knowledge: retrieval,
              knowledgeDependencies,
              responseMode,
            });
            session.risk = nextRisk;
            session.summary = null;
            touchSession(session);
            return json(200, { session });
          } finally {
            if (activeSessions.get(id) === controller) activeSessions.delete(id);
            res.removeListener("close", onClose);
          }
        }
        fail(405, "METHOD_NOT_ALLOWED", "此路径不支持该请求方法。");
      }
      if (pathname.startsWith("/api/")) fail(404, "NOT_FOUND", "API 路径不存在。");
      if (!["GET", "HEAD"].includes(req.method))
        fail(405, "METHOD_NOT_ALLOWED", "此路径不支持该请求方法。");
      let rootReal;
      try {
        rootReal = await realpath(webDir);
      } catch {
        fail(404, "WEB_NOT_BUILT", "前端尚未构建，请先运行 pnpm build。");
      }
      let target = path.resolve(rootReal, `.${decoded}`);
      if (target !== rootReal && !target.startsWith(`${rootReal}${path.sep}`))
        fail(403, "INVALID_PATH", "请求路径无效。");
      try {
        if (!(await stat(target)).isFile()) target = path.join(rootReal, "index.html");
      } catch {
        target = path.extname(target) ? target : path.join(rootReal, "index.html");
      }
      let targetReal;
      try {
        targetReal = await realpath(target);
      } catch {
        fail(404, "NOT_FOUND", "资源不存在。");
      }
      if (!targetReal.startsWith(`${rootReal}${path.sep}`))
        fail(403, "INVALID_PATH", "请求路径无效。");
      const bytes = await readFile(targetReal);
      res.writeHead(200, {
        "Content-Type": MIME_TYPES[path.extname(targetReal)] ?? "application/octet-stream",
        "Content-Length": bytes.length,
      });
      res.end(req.method === "HEAD" ? undefined : bytes);
    } catch (error) {
      if (res.destroyed || res.writableEnded) return;
      if (res.headersSent) {
        res.end();
        return;
      }
      json(error instanceof HttpError ? error.status : 500, {
        error: {
          code: error instanceof HttpError ? error.code : "INTERNAL_ERROR",
          message: error instanceof HttpError ? error.message : "本地服务处理失败，请重试。",
        },
      });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 50;
  server.maxConnections = options.maxConnections ?? 64;
  server.on("close", () => {
    modelProvider.abortAll();
    sessions.clear();
    settings.apiKey = "";
  });
  return server;
}

export async function startAppServer(options = {}) {
  const host = options.host ?? "127.0.0.1";
  const env = options.env ?? process.env;
  const port = options.port ?? Number(env.XQ_PORT || 4320);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error("Invalid local port.");
  const knowledgeDirectory =
    options.knowledgeDirectory === undefined
      ? path.resolve(env.XQ_KNOWLEDGE_DIR || path.join(SERVER_DIRECTORY, "../../.local/knowledge"))
      : options.knowledgeDirectory;
  const knowledgeStore =
    options.knowledgeStore ?? createKnowledgeStore({ directory: knowledgeDirectory });
  await knowledgeStore.list();
  const server = createAppServer({ ...options, host, port, knowledgeDirectory, knowledgeStore });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const server = await startAppServer();
  console.log(
    `心理咨询接诊工作台已启动：http://127.0.0.1:${server.address().port}（个案仅保存在内存；知识库保存在本机）`,
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      server.close();
      server.closeAllConnections();
    });
}
