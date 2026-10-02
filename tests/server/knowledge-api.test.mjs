import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startAppServer } from "../../src/server/app-server.mjs";

const PROVIDER_ENV = {
  XQ_API_KEY: "test-secret",
  XQ_MODEL: "mock",
  XQ_BASE_URL: "https://provider.example/v1",
};
async function createTestServer(t, options = {}) {
  const server = await startAppServer({ port: 0, env: {}, knowledgeDirectory: null, ...options });
  const close = () =>
    new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  t.after(() => (server.listening ? close() : undefined));
  const request = async (route, method = "GET", body) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api${route}`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, ...(await res.json()) };
  };
  const create = async (extra = {}) =>
    (await request("/sessions", "POST", { name: "合成测试", ...extra })).session;
  const send = (session, content) =>
    request(`/sessions/${session.id}/messages`, "POST", { content });
  return { request, create, send, close };
}
const DOCUMENT = {
  title: "睡眠访谈手册（测试）",
  content: "睡眠访谈：询问入睡所需时间、夜间觉醒次数以及白天功能影响。记录睡眠变化的持续时间。",
  source: "https://example.org/sleep",
};

test("knowledge API imports files/text, searches, previews, toggles, deletes and validates input", async (t) => {
  const { request } = await createTestServer(t);
  assert.deepEqual((await request("/knowledge")).documents, []);
  const created = await request("/knowledge", "POST", DOCUMENT);
  assert.equal(created.status, 201);
  assert.equal(created.document.allowExternal, false);
  assert.equal(created.document.enabled, true);
  const id = created.document.id;
  assert.equal((await request(`/knowledge/${id}`)).document.content, DOCUMENT.content);
  const found = await request("/knowledge/search", "POST", { query: "如何进行睡眠访谈？" });
  assert.equal(found.sources[0].documentId, id);
  assert.equal(found.sources[0].source, DOCUMENT.source);
  assert.equal(found.sources[0].label, "K1");
  const documentPreview = await request("/knowledge/search", "POST", {
    query: "睡眠访谈",
    unit: "documents",
    limit: 1,
  });
  assert.equal(documentPreview.unit, "documents");
  assert.deepEqual(
    documentPreview.sources.map((source) => source.documentId),
    [id],
  );
  assert.equal(
    (await request("/knowledge/search", "POST", { query: "睡眠", unit: "documents", limit: null }))
      .status,
    400,
  );
  assert.equal(
    (await request("/knowledge/search", "POST", { query: "睡眠", unit: null })).status,
    400,
  );
  assert.equal(
    (await request("/knowledge/search", "POST", { query: "量子火箭引擎" })).sources.length,
    0,
  );
  assert.equal(
    (await request("/knowledge/search", "POST", { query: "睡眠", limit: -1 })).status,
    400,
  );
  await request(`/knowledge/${id}`, "PATCH", { enabled: false });
  assert.equal((await request("/knowledge/search", "POST", { query: "睡眠" })).sources.length, 0);
  await request(`/knowledge/${id}`, "PATCH", { enabled: true });
  const upload = await request("/knowledge", "POST", {
    filename: "压力访谈.md",
    dataBase64: Buffer.from("# 压力访谈\n了解压力发生情境，记录支持资源。").toString("base64"),
  });
  assert.equal(upload.status, 201);
  assert.equal(
    (await request("/knowledge", "POST", { ...DOCUMENT, source: "javascript:alert(1)" })).status,
    400,
  );
  assert.equal(
    (await request("/knowledge", "POST", { filename: "../bad.md", dataBase64: "YQ==" })).status,
    400,
  );
  assert.equal(
    (await request("/knowledge", "POST", { filename: "bad.exe", dataBase64: "YQ==" })).status,
    415,
  );
  assert.equal(
    (await request("/knowledge", "POST", { ...DOCUMENT, filename: "a.md", dataBase64: "YQ==" }))
      .status,
    400,
  );
  assert.equal(
    (await request("/knowledge", "POST", { ...DOCUMENT, allowExternal: "yes" })).status,
    400,
  );
  await request(`/knowledge/${id}`, "DELETE");
  assert.equal((await request(`/knowledge/${id}`)).status, 404);
  assert.equal((await request("/knowledge/search", "POST", { query: "睡眠" })).sources.length, 0);
});

test("demo retrieval is local with traceable snapshots; empty/disabled/no-match are explicit", async (t) => {
  const { request, create, send } = await createTestServer(t, {
    fetchImpl: () => {
      throw new Error("must stay local");
    },
  });
  const session = await create();
  assert.equal(session.useKnowledge, true);
  assert.equal((await send(session, "睡眠访谈")).session.messages.at(-1).knowledge.status, "empty");
  await request("/knowledge", "POST", DOCUMENT);
  const matched = (await send(session, "睡眠访谈")).session.messages.at(-1);
  assert.equal(matched.knowledge.status, "local");
  assert.equal(matched.sources.length, 1);
  assert.match(matched.sources[0].excerpt, /夜间觉醒/);
  assert.equal(
    (await send(session, "天文学望远镜")).session.messages.at(-1).knowledge.status,
    "no_match",
  );
  await request(`/sessions/${session.id}`, "PATCH", { useKnowledge: false });
  const disabled = (await send(session, "睡眠访谈")).session.messages.at(-1);
  assert.equal(disabled.knowledge.status, "disabled");
  assert.deepEqual(disabled.sources, []);
});

test("live RAG requires case consent and document permission; only real labels survive", async (t) => {
  const calls = [];
  const { request, create, send } = await createTestServer(t, {
    env: PROVIDER_ENV,
    fetchImpl: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: `${options.body.includes("REFERENCE_SENTINEL_ONLY_DOC") ? "ACTUAL_SOURCE_DERIVED_REPLY " : ""}先了解睡眠情况 [K1]，虚构来源 [K99]。`,
              },
            },
          ],
        }),
      );
    },
  });
  const doc = (
    await request("/knowledge", "POST", {
      ...DOCUMENT,
      content: DOCUMENT.content + "\nREFERENCE_SENTINEL_ONLY_DOC",
    })
  ).document;
  const session = await create();
  await send(session, "睡眠访谈");
  assert.equal(calls.length, 0);
  await request(`/sessions/${session.id}`, "PATCH", { consent: true });
  const localOnly = (await send(session, "睡眠访谈")).session.messages.at(-1);
  assert.equal(localOnly.knowledge.status, "local");
  assert.doesNotMatch(JSON.stringify(calls.at(-1)), /REFERENCE_SENTINEL_ONLY_DOC/);
  assert.doesNotMatch(localOnly.content, /\[K1\]/);
  await request(`/knowledge/${doc.id}`, "PATCH", { allowExternal: true });
  const live = (await send(session, "睡眠访谈")).session.messages.at(-1);
  assert.equal(live.knowledge.status, "used");
  const payload = calls.at(-1);
  assert.equal(payload.messages.filter((item) => item.role === "system").length, 1);
  assert.match(
    JSON.stringify(payload.messages.filter((item) => item.role === "user")),
    /REFERENCE_SENTINEL_ONLY_DOC/,
  );
  assert.match(live.content, /\[K1\]/);
  assert.doesNotMatch(live.content, /\[K99\]/);
  assert.match(live.content, /来源未核实/);
  await request(`/knowledge/${doc.id}`, "PATCH", { allowExternal: false });
  await send(session, "睡眠访谈");
  assert.doesNotMatch(
    JSON.stringify(calls.at(-1)),
    /REFERENCE_SENTINEL_ONLY_DOC|ACTUAL_SOURCE_DERIVED_REPLY/,
  );
  const previousCalls = calls.length;
  const urgent = (await send(session, "我准备今晚跳楼")).session.messages.at(-1);
  assert.equal(urgent.knowledge.status, "safety");
  assert.deepEqual(urgent.sources, []);
  assert.equal(calls.length, previousCalls);
});

test("documents survive service restart while case and query data are not persisted", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "xq-agent-rag-api-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const first = await createTestServer(t, { knowledgeDirectory: directory });
  await first.request("/knowledge", "POST", DOCUMENT);
  await first.create({ concern: "UNPERSISTED_CASE_MARKER" });
  await first.close();
  const second = await createTestServer(t, { knowledgeDirectory: directory });
  assert.equal((await second.request("/knowledge")).storage, "local");
  assert.equal((await second.request("/knowledge")).documents.length, 1);
  assert.equal((await second.request("/sessions")).sessions.length, 0);
  assert.equal(
    (await second.request("/knowledge/search", "POST", { query: "睡眠" })).sources.length,
    1,
  );
});

test("revoking source permission also excludes indirect source-derived assistant history", async (t) => {
  const calls = [];
  const { request, create, send } = await createTestServer(t, {
    env: PROVIDER_ENV,
    fetchImpl: async (_url, options) => {
      const payload = JSON.parse(options.body);
      calls.push(payload);
      const hasReference = JSON.stringify(payload.messages).includes(
        "PRIVATE_REFERENCE_ECHO_493017",
      );
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: hasReference
                  ? "从参考资料得到 PRIVATE_REFERENCE_ECHO_493017。"
                  : "没有参考资料。",
              },
            },
          ],
        }),
      );
    },
  });
  const doc = (
    await request("/knowledge", "POST", {
      ...DOCUMENT,
      content: `${DOCUMENT.content}\nPRIVATE_REFERENCE_ECHO_493017`,
      allowExternal: true,
    })
  ).document;
  const session = await create({ consent: true });
  await send(session, "睡眠访谈");
  const intermediate = await send(session, "继续说明");
  assert.equal(intermediate.status, 200);
  assert.deepEqual(intermediate.session.messages.at(-1).sources, []);
  await request(`/knowledge/${doc.id}`, "PATCH", { allowExternal: false });
  const final = await send(session, "继续说明");
  assert.equal(final.status, 200);
  assert.doesNotMatch(JSON.stringify(calls.at(-1).messages), /PRIVATE_REFERENCE_ECHO_493017/);
});

test("disabling a source during a model call aborts the request and saves no response", async (t) => {
  let providerStarted;
  const started = new Promise((resolve) => {
    providerStarted = resolve;
  });
  const { request, create, send } = await createTestServer(t, {
    env: PROVIDER_ENV,
    fetchImpl: async (_url, options) => {
      providerStarted();
      return new Promise((_resolve, reject) =>
        options.signal.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        ),
      );
    },
  });
  const doc = (await request("/knowledge", "POST", { ...DOCUMENT, allowExternal: true })).document;
  const session = await create({ consent: true });
  const pending = send(session, "睡眠访谈");
  await started;
  assert.equal((await request(`/knowledge/${doc.id}`, "PATCH", { enabled: false })).status, 200);
  const aborted = await pending;
  assert.ok([409, 504].includes(aborted.status));
  assert.equal((await request(`/sessions/${session.id}`)).session.messages.length, 0);
});
