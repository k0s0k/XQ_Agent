import test from "node:test";
import assert from "node:assert/strict";
import { startAppServer } from "../../src/server/app-server.mjs";

const PROVIDER_ENV = {
  XQ_API_KEY: "chat-test-secret",
  XQ_MODEL: "chat-test-model",
  XQ_BASE_URL: "https://provider.example/v1",
};
const createProviderResponse = (content) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    headers: { "Content-Type": "application/json" },
  });

async function createTestServer(t, options = {}) {
  const server = await startAppServer({ port: 0, env: {}, knowledgeDirectory: null, ...options });
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const request = async (route, method = "GET", body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${route}`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, ...(await response.json()) };
  };
  const createChat = async (extra = {}) => {
    const result = await request("/sessions", "POST", { kind: "chat", ...extra });
    assert.equal(result.status, 201, JSON.stringify(result));
    return result.session;
  };
  const addDocument = async (extra = {}) => {
    const result = await request("/knowledge", "POST", {
      title: "睡眠访谈参考（合成测试）",
      content: "睡眠访谈先了解入睡时间、夜间觉醒和白天功能。",
      ...extra,
    });
    assert.equal(result.status, 201, JSON.stringify(result));
    return result.document;
  };
  const send = (session, content) =>
    request(`/sessions/${session.id}/messages`, "POST", { content });
  return { request, createChat, addDocument, send };
}

test("direct chat can be created without intake fields, changed and deleted independently", async (t) => {
  const { request, createChat, send } = await createTestServer(t);
  const intake = await request("/sessions", "POST", {
    name: "接诊合成个案",
    concern: "个案独立资料",
  });
  assert.equal(intake.status, 201);
  assert.equal(intake.session.kind, "intake");
  const chat = await createChat();
  assert.equal(chat.kind, "chat");
  assert.equal(chat.name, "新对话");
  assert.equal(chat.topK, 5);
  assert.equal(chat.consent, false);
  assert.equal(chat.useKnowledge, true);
  assert.deepEqual(chat.messages, []);
  const message = await send(chat, "解释一下开放式提问。");
  assert.equal(message.status, 200);
  assert.equal(message.session.messages.length, 2);
  assert.equal(message.session.messages.at(-1).responseMode, "local");
  assert.match(message.session.messages.at(-1).content, /未调用大模型/);
  assert.doesNotMatch(
    message.session.messages.at(-1).content,
    /建议咨询师选择性追问|1\.[\s\S]*2\.[\s\S]*3\./,
  );
  const patched = await request(`/sessions/${chat.id}`, "PATCH", { name: "资料讨论", topK: 3 });
  assert.equal(patched.status, 200);
  assert.equal(patched.session.name, "资料讨论");
  assert.equal(patched.session.topK, 3);
  assert.equal((await request("/sessions")).sessions.length, 2);
  assert.equal((await request(`/sessions/${chat.id}`, "DELETE")).status, 200);
  assert.equal((await request(`/sessions/${chat.id}`)).status, 404);
  assert.equal((await request(`/sessions/${intake.session.id}`)).session.name, "接诊合成个案");
});

test("chat calls configured LLM with its own conversation history and no intake context", async (t) => {
  const calls = [];
  const { request, createChat, send } = await createTestServer(t, {
    env: PROVIDER_ENV,
    fetchImpl: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      return createProviderResponse(
        `MOCK_CHAT_ANSWER_${calls.length}：开放式提问允许对方自行组织回答。`,
      );
    },
  });
  const intake = await request("/sessions", "POST", {
    name: "PRIVATE_CASE_NAME",
    concern: "PRIVATE_CASE_CONCERN",
  });
  await request(`/sessions/${intake.session.id}`, "PATCH", { notes: "PRIVATE_CASE_NOTES" });
  const chat = await createChat({ consent: true });
  const first = await send(chat, "请解释开放式提问 CHAT_TURN_ONE。");
  assert.equal(first.status, 200);
  assert.equal(first.session.messages.at(-1).responseMode, "llm");
  assert.match(first.session.messages.at(-1).content, /MOCK_CHAT_ANSWER_1/);
  assert.doesNotMatch(first.session.messages.at(-1).content, /未调用大模型|建议咨询师选择性追问/);
  assert.equal(calls[0].model, PROVIDER_ENV.XQ_MODEL);
  assert.equal(calls[0].messages.filter((item) => item.role === "system").length, 1);
  assert.doesNotMatch(calls[0].messages[0].content, /每次回应简洁，最多三个下一步问题/);
  assert.doesNotMatch(
    JSON.stringify(calls[0].messages),
    /PRIVATE_CASE_|录入的背景数据|"concern"|"assessment"|"notes"/,
  );
  assert.equal(calls[0].messages.at(-1).content, "请解释开放式提问 CHAT_TURN_ONE。");
  const second = await send(chat, "用一个简单例子继续解释 CHAT_TURN_TWO。");
  assert.equal(second.status, 200);
  assert.ok(
    calls[1].messages.some(
      (item) => item.role === "user" && item.content.includes("CHAT_TURN_ONE"),
    ),
  );
  assert.ok(
    calls[1].messages.some(
      (item) => item.role === "assistant" && item.content.includes("MOCK_CHAT_ANSWER_1"),
    ),
  );
  assert.equal(calls[1].messages.at(-1).content, "用一个简单例子继续解释 CHAT_TURN_TWO。");
  const isolated = await createChat({ consent: true });
  await send(isolated, "独立对话 CHAT_NEW_SESSION。");
  assert.doesNotMatch(
    JSON.stringify(calls[2].messages),
    /CHAT_TURN_ONE|CHAT_TURN_TWO|MOCK_CHAT_ANSWER_1|PRIVATE_CASE_/,
  );
});

test("Top K counts distinct documents even when one document has many highly matching chunks", async (t) => {
  const { request, createChat, addDocument, send } = await createTestServer(t);
  const long = await addDocument({
    title: "睡眠访谈睡眠观察",
    content: "睡眠访谈记录睡眠时间、睡眠质量与白天状态。".repeat(300),
  });
  assert.ok(long.chunkCount > 3);
  for (let index = 1; index <= 4; index += 1)
    await addDocument({
      title: `参考资料 ${index}`,
      content: `合成资料 ${index}：睡眠访谈涉及睡眠变化与日常活动。`,
    });
  const chat = await createChat();
  const first = (await send(chat, "睡眠访谈")).session.messages.at(-1);
  assert.equal(first.sources.length, 5);
  assert.equal(new Set(first.sources.map((source) => source.documentId)).size, 5);
  assert.equal(first.sources.filter((source) => source.documentId === long.id).length, 1);
  assert.equal(first.knowledge.requestedTopK, 5);
  assert.equal(first.knowledge.matchedDocuments, 5);
  assert.equal(first.knowledge.providedDocuments, 0);
  assert.equal(first.knowledge.unit, "documents");
  assert.equal(first.knowledge.status, "local");
  assert.equal(first.responseMode, "local");
  assert.ok(first.sources.every((source) => source.providedToModel === false));
  assert.deepEqual(
    first.sources.map((source) => source.label),
    ["K1", "K2", "K3", "K4", "K5"],
  );
  for (const limit of [1, 3]) {
    assert.equal((await request(`/sessions/${chat.id}`, "PATCH", { topK: limit })).status, 200);
    const next = (await send(chat, "睡眠访谈")).session.messages.at(-1);
    assert.equal(next.sources.length, limit);
    assert.equal(next.knowledge.requestedTopK, limit);
    assert.equal(next.knowledge.matchedDocuments, limit);
    assert.equal(new Set(next.sources.map((source) => source.documentId)).size, limit);
  }
});

test("Top K and conversation kind reject invalid input without changing existing settings", async (t) => {
  const { request, createChat } = await createTestServer(t);
  const chat = await createChat({ topK: 10 });
  for (const value of [0, 11, -1, 2.5, "3", null, true]) {
    assert.equal(
      (await request("/sessions", "POST", { kind: "chat", topK: value })).status,
      400,
      `create topK=${JSON.stringify(value)}`,
    );
    assert.equal(
      (await request(`/sessions/${chat.id}`, "PATCH", { topK: value })).status,
      400,
      `patch topK=${JSON.stringify(value)}`,
    );
  }
  for (const value of ["other", "", null, true])
    assert.equal((await request("/sessions", "POST", { kind: value })).status, 400);
  assert.equal((await request(`/sessions/${chat.id}`)).session.topK, 10);
});

test("all local Top K documents stay visible, but only permitted documents reach the model with stable labels", async (t) => {
  const calls = [];
  const { request, createChat, addDocument, send } = await createTestServer(t, {
    env: PROVIDER_ENV,
    fetchImpl: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      return createProviderResponse("引用本轮资料 [K1] [K2] [K3]，无效引用 [K99]。");
    },
  });
  for (let index = 1; index <= 6; index += 1)
    await addDocument({
      title: `睡眠访谈资料 ${index}`,
      content: `睡眠访谈了解持续时间以及功能变化。DOCUMENT_MARKER_${index}`,
    });
  const chat = await createChat({ topK: 3 });
  const local = (await send(chat, "睡眠访谈")).session.messages.at(-1);
  assert.equal(calls.length, 0);
  assert.equal(local.sources.length, 3);
  const excluded = local.sources[0];
  const documents = (await request("/knowledge")).documents;
  // Permit every other document, including lower-ranked documents outside the local Top K.
  for (const doc of documents.filter((item) => item.id !== excluded.documentId))
    await request(`/knowledge/${doc.id}`, "PATCH", { allowExternal: true });
  await request(`/sessions/${chat.id}`, "PATCH", { consent: true });
  const live = (await send(chat, "睡眠访谈")).session.messages.at(-1);
  assert.deepEqual(
    live.sources.map((source) => source.documentId),
    local.sources.map((source) => source.documentId),
  );
  assert.deepEqual(
    live.sources.map((source) => source.label),
    ["K1", "K2", "K3"],
  );
  assert.deepEqual(
    live.sources.map((source) => source.providedToModel),
    [false, true, true],
  );
  assert.equal(live.knowledge.status, "used");
  assert.equal(live.responseMode, "llm");
  assert.equal(live.knowledge.matchedDocuments, 3);
  assert.equal(live.knowledge.providedDocuments, 2);
  assert.equal(live.knowledge.externalExcluded, 1);
  const payload = JSON.stringify(calls.at(-1).messages);
  assert.ok(!payload.includes(excluded.excerpt));
  for (const source of live.sources.slice(1)) assert.ok(payload.includes(source.excerpt));
  for (const doc of documents.filter(
    (item) => !local.sources.some((source) => source.documentId === item.id),
  )) {
    const content = (await request(`/knowledge/${doc.id}`)).document.content;
    assert.ok(
      !payload.includes(content),
      "lower-ranked external documents must not refill or replace local Top K",
    );
  }
  assert.match(live.content, /\[K2\].*\[K3\]/);
  assert.doesNotMatch(live.content, /\[K1\]|\[K99\]/);
  assert.match(live.content, /来源未核实/);
});

test("chat still calls the model without usable knowledge and reports empty, no-match and disabled honestly", async (t) => {
  let calls = 0;
  const { request, createChat, addDocument, send } = await createTestServer(t, {
    env: PROVIDER_ENV,
    fetchImpl: async () => {
      calls += 1;
      return createProviderResponse("模型直接回答。");
    },
  });
  const chat = await createChat({ consent: true });
  const empty = (await send(chat, "解释开放式提问。")).session.messages.at(-1);
  assert.equal(empty.knowledge.status, "empty");
  assert.equal(empty.knowledge.matchedDocuments, 0);
  await addDocument();
  const unmatched = (await send(chat, "量子发动机")).session.messages.at(-1);
  assert.equal(unmatched.knowledge.status, "no_match");
  await request(`/sessions/${chat.id}`, "PATCH", { useKnowledge: false });
  const disabled = (await send(chat, "睡眠访谈")).session.messages.at(-1);
  assert.equal(disabled.knowledge.status, "disabled");
  for (const answer of [empty, unmatched, disabled]) {
    assert.deepEqual(answer.sources, []);
    assert.equal(answer.responseMode, "llm");
    assert.equal(answer.knowledge.providedDocuments, 0);
    assert.match(answer.content, /模型直接回答/);
  }
  assert.equal(calls, 3);
});

test("chat model permission is independent of document permission and can be withdrawn", async (t) => {
  let calls = 0;
  const { request, createChat, addDocument, send } = await createTestServer(t, {
    env: PROVIDER_ENV,
    fetchImpl: async () => {
      calls += 1;
      return createProviderResponse("已调用模型 [K1]。");
    },
  });
  await addDocument({ allowExternal: true });
  const chat = await createChat();
  const local = (await send(chat, "睡眠访谈")).session.messages.at(-1);
  assert.equal(calls, 0);
  assert.equal(local.sources.length, 1);
  assert.equal(local.sources[0].providedToModel, false);
  assert.equal(local.responseMode, "local");
  assert.match(local.content, /未调用大模型/);
  await request(`/sessions/${chat.id}`, "PATCH", { consent: true });
  const live = (await send(chat, "睡眠访谈")).session.messages.at(-1);
  assert.equal(calls, 1);
  assert.equal(live.sources[0].providedToModel, true);
  assert.equal(live.responseMode, "llm");
  await request(`/sessions/${chat.id}`, "PATCH", { consent: false });
  const withdrawn = (await send(chat, "睡眠访谈")).session.messages.at(-1);
  assert.equal(calls, 1);
  assert.equal(withdrawn.sources[0].providedToModel, false);
  assert.equal(withdrawn.knowledge.providedDocuments, 0);
  assert.equal(withdrawn.responseMode, "local");
  assert.match(withdrawn.content, /未调用大模型/);
  const history = (await request(`/sessions/${chat.id}`)).session.messages;
  assert.equal(history[1].responseMode, "local");
  assert.equal(history[3].responseMode, "llm");
});

test("failed live chat returns an error without saving a fabricated model answer", async (t) => {
  const { request, createChat, send } = await createTestServer(t, {
    env: PROVIDER_ENV,
    fetchImpl: async () =>
      new Response("private upstream payload chat-test-secret", { status: 503 }),
  });
  const chat = await createChat({ consent: true });
  const failure = await send(chat, "解释开放式提问。");
  assert.equal(failure.status, 502);
  assert.doesNotMatch(JSON.stringify(failure), /private upstream payload|chat-test-secret/);
  assert.equal((await request(`/sessions/${chat.id}`)).session.messages.length, 0);
});

test("urgent chat bypasses both the provider and knowledge retrieval output", async (t) => {
  let calls = 0;
  const { createChat, addDocument, send } = await createTestServer(t, {
    env: PROVIDER_ENV,
    fetchImpl: async () => {
      calls += 1;
      return createProviderResponse("must not run");
    },
  });
  await addDocument({
    title: "安全提示（合成测试）",
    content: "自伤或跳楼的紧迫危险需要立即现场处置。",
    allowExternal: true,
  });
  const chat = await createChat({ consent: true });
  const result = await send(chat, "我现在准备跳楼");
  assert.equal(result.status, 200);
  assert.equal(result.session.risk, "urgent");
  const answer = result.session.messages.at(-1);
  assert.equal(answer.knowledge.status, "safety");
  assert.equal(answer.responseMode, "safety");
  assert.deepEqual(answer.sources, []);
  assert.equal(answer.knowledge.providedDocuments, 0);
  assert.match(answer.content, /未向模型发送/);
  assert.equal(calls, 0);
});
