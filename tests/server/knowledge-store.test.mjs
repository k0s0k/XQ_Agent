import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createKnowledgeStore } from "../../src/server/knowledge-store.mjs";

async function temporaryDirectory(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "xq-agent-knowledge-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("Chinese BM25 ranks the relevant document and preserves stable source references", async () => {
  const store = createKnowledgeStore();
  await store.add({ title: "放松练习", content: "介绍缓慢呼吸、肌肉放松练习和练习记录方法。" });
  const sleep = await store.add({
    title: "失眠的接诊提问",
    source: "https://example.org/sleep",
    content:
      "失眠接诊时核实入睡困难、夜间醒来、早醒和白天困倦。了解睡眠持续时间、作息变化以及对日常功能的影响。",
  });
  const sources = await store.search({ query: "入睡困难，睡眠不好，白天困倦应该问些什么？" });
  assert.equal(sources[0].documentId, sleep.id);
  assert.equal(sources[0].label, "K1");
  assert.equal(sources[0].chunkIndex, 1);
  assert.equal(sources[0].chunkId, `${sleep.id}:1`);
  assert.equal(sources[0].source, "https://example.org/sleep");
  assert.ok(sources[0].score > 0);
  assert.match(sources[0].excerpt, /入睡困难/);
  assert.equal(sources[0].allowExternal, false);
  assert.equal((await store.search({ query: "睡眠" }))[0].chunkId, sources[0].chunkId);
});

test("irrelevant and stopword-only queries return no sources; Latin matching ignores case", async () => {
  const store = createKnowledgeStore();
  await store.add({
    title: "量表使用",
    content: "PHQ-9 是抑郁症状筛查量表。筛查结果需要结合访谈进行解释。",
  });
  assert.deepEqual(await store.search({ query: "卫星轨道的周期与火箭发动机的推力" }), []);
  assert.deepEqual(await store.search({ query: "请问这个是什么，帮我介绍一下相关内容。" }), []);
  assert.equal((await store.search({ query: "phq-9" })).length, 1);
  assert.equal((await store.search({ query: "PHQ-9" })).length, 1);
});

test("chunking retains source text, bounded size, headings and useful overlap", async () => {
  const store = createKnowledgeStore();
  const content = Array.from(
    { length: 24 },
    (_, index) =>
      `## 第${index + 1}节 睡眠资料\n这是原始资料的第${index + 1}段。${"描述睡眠节律、生活习惯与白天活动的记录方法。".repeat(5)}`,
  ).join("\n\n");
  const document = await store.add({ title: "睡眠资料", content });
  assert.ok(document.chunkCount > 2);
  const hits = (await store.search({ query: "睡眠资料", limit: 20 })).sort(
    (a, b) => a.chunkIndex - b.chunkIndex,
  );
  assert.equal(hits.length, document.chunkCount);
  let previousEnd = 0;
  for (const [index, hit] of hits.entries()) {
    assert.ok(hit.excerpt.length <= 1_000);
    const start = content.indexOf(hit.excerpt);
    assert.ok(start >= 0, "every excerpt is an exact substring of the source");
    if (index > 0)
      assert.ok(previousEnd - start >= 100, "neighboring chunks preserve overlapping context");
    previousEnd = start + hit.excerpt.length;
  }
  assert.equal(previousEnd, content.length);
  assert.equal(hits[0].excerpt.startsWith("## 第1节"), true);
});

test("disabled and local-only sources are excluded as requested, and deletion removes matches", async () => {
  const store = createKnowledgeStore();
  const local = await store.add({ title: "本地睡眠资料", content: "失眠包括入睡困难和早醒。" });
  const external = await store.add({
    title: "共享睡眠资料",
    content: "睡眠日记记录作息和入睡时间。",
    allowExternal: true,
  });
  assert.equal((await store.search({ query: "睡眠" })).length, 2);
  assert.deepEqual(
    (await store.search({ query: "睡眠", externalOnly: true })).map((source) => source.documentId),
    [external.id],
  );
  await store.update(external.id, { enabled: false });
  assert.deepEqual(await store.search({ query: "睡眠", externalOnly: true }), []);
  await store.update(local.id, {
    allowExternal: true,
    title: "作息参考",
    source: "https://example.org/reference",
  });
  const renamed = await store.search({ query: "作息参考", externalOnly: true });
  assert.equal(renamed[0].title, "作息参考");
  assert.equal(renamed[0].source, "https://example.org/reference");
  await store.remove(local.id);
  assert.deepEqual(await store.search({ query: "睡眠" }), []);
  await assert.rejects(store.get(local.id), { status: 404, code: "KNOWLEDGE_NOT_FOUND" });
});

test("chunk boundaries preserve surrogate pairs and Unicode citation URLs remain usable", async () => {
  const store = createKnowledgeStore();
  const content = `${"a".repeat(899)}😀${"b".repeat(950)}𠮷${"c".repeat(200)}`;
  const source = "https://example.org/资料?主题=睡眠";
  await store.add({ title: "睡眠参考", content, source });
  const sources = await store.search({ query: "睡眠参考", limit: 20 });
  assert.ok(sources.length > 1);
  for (const hit of sources) {
    assert.equal(hit.excerpt.isWellFormed(), true);
    assert.equal(content.includes(hit.excerpt), true);
    assert.equal(hit.source, new URL(source).href);
  }
});

test("list returns metadata only; callers cannot mutate the store through returned values", async () => {
  const store = createKnowledgeStore();
  const document = await store.add({
    title: "资料",
    content: "睡眠记录。",
    filename: "资料.txt",
    format: "txt",
  });
  const listed = await store.list();
  assert.equal(listed[0].content, undefined);
  assert.equal(listed[0].characterCount, 5);
  assert.equal(listed[0].chunkCount, 1);
  listed[0].title = "改变";
  const returned = await store.get(document.id);
  assert.equal(returned.title, "资料");
  assert.equal(returned.content, "睡眠记录。");
  returned.content = "覆盖";
  assert.equal((await store.get(document.id)).content, "睡眠记录。");
});

test("concurrent mutations persist atomically; reopen preserves IDs and permissions without search queries", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = createKnowledgeStore({ directory });
  const added = await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      store.add({ title: `睡眠资料${index}`, content: `这是第${index}份睡眠日记的填写说明。` }),
    ),
  );
  await Promise.all([
    store.update(added[0].id, { enabled: false }),
    store.update(added[1].id, { allowExternal: true }),
    store.remove(added[2].id),
    store.add({ title: "访谈资料", content: "了解生活作息和睡眠记录。" }),
  ]);
  await store.search({ query: "不应保存的查询内容493017" });
  const serialized = await readFile(path.join(directory, "knowledge.json"), "utf8");
  assert.doesNotMatch(serialized, /不应保存的查询内容493017|_chunks|counts/);
  assert.deepEqual(await readdir(directory), ["knowledge.json"]);
  const reopened = createKnowledgeStore({ directory });
  assert.equal((await reopened.list()).length, 12);
  assert.equal((await reopened.get(added[0].id)).enabled, false);
  assert.equal((await reopened.get(added[1].id)).allowExternal, true);
  await assert.rejects(reopened.get(added[2].id), { status: 404 });
  const external = await reopened.search({ query: "睡眠", externalOnly: true });
  assert.equal(external.length, 1);
  assert.equal(external[0].documentId, added[1].id);
});

test("invalid documents and unsafe source links are rejected without poisoning later operations", async () => {
  const store = createKnowledgeStore();
  for (const source of [
    "javascript:alert(1)",
    "file:///secret",
    "https://user:pass@example.org/doc",
    "not a url",
  ]) {
    await assert.rejects(store.add({ title: "资料", content: "正文", source }), {
      status: 400,
      code: "INVALID_KNOWLEDGE",
    });
  }
  for (const input of [
    null,
    { title: "", content: "正文" },
    { title: "资料", content: "" },
    { title: "资料", content: "a".repeat(200_001) },
    { title: "资料", content: "正文", enabled: "yes" },
    { title: "资料", content: "正文", format: "exe" },
    { title: "资料", content: "正文", unexpected: true },
  ]) {
    await assert.rejects(store.add(input), { code: "INVALID_KNOWLEDGE" });
  }
  const document = await store.add({ title: "可用资料", content: "入睡困难" });
  assert.equal((await store.get(document.id)).title, "可用资料");
  await assert.rejects(store.search({ query: "入睡", limit: 0 }), { status: 400 });
  await assert.rejects(store.search({ query: "入睡", externalOnly: "yes" }), { status: 400 });
  await assert.rejects(store.update(document.id, { content: "未支持的更新" }), { status: 400 });
});

test("capacity limit rejects the extra document and keeps the existing collection", async () => {
  const store = createKnowledgeStore();
  await Promise.all(
    Array.from({ length: 100 }, (_, index) =>
      store.add({ title: `资料${index}`, content: "睡眠。" }),
    ),
  );
  await assert.rejects(store.add({ title: "溢出", content: "不能保存" }), {
    status: 413,
    code: "KNOWLEDGE_CAPACITY",
  });
  assert.equal((await store.list()).length, 100);
});

test("corrupt storage errors remain visible on every method and preserve the original file", async (t) => {
  const directory = await temporaryDirectory(t);
  const storageFile = path.join(directory, "knowledge.json");
  await writeFile(storageFile, "{malformed original data");
  const store = createKnowledgeStore({ directory });
  await assert.rejects(store.list(), { status: 500, code: "KNOWLEDGE_CORRUPT" });
  await assert.rejects(store.add({ title: "资料", content: "正文" }), {
    status: 500,
    code: "KNOWLEDGE_CORRUPT",
  });
  await assert.rejects(store.search({ query: "睡眠" }), { code: "KNOWLEDGE_CORRUPT" });
  assert.equal(await readFile(storageFile, "utf8"), "{malformed original data");
});

test("persisted permission corruption cannot accidentally authorize external sharing", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = createKnowledgeStore({ directory });
  await store.add({ title: "资料", content: "睡眠记录。", allowExternal: false });
  const file = path.join(directory, "knowledge.json");
  const saved = JSON.parse(await readFile(file, "utf8"));
  saved.documents[0].allowExternal = "false";
  await writeFile(file, JSON.stringify(saved));
  await assert.rejects(createKnowledgeStore({ directory }).list(), { code: "KNOWLEDGE_CORRUPT" });
});

test("document Top K ranks the full corpus before grouping, so one long document cannot crowd out other matches", async () => {
  const store = createKnowledgeStore();
  const long = await store.add({ title: "长篇检索资料", content: "sleepindex ".repeat(2_500) });
  assert.ok(long.chunkCount > 20);
  await Promise.all(
    Array.from({ length: 11 }, (_, index) =>
      store.add({ title: `其他资料${index}`, content: `sleepindex ${"ordinary ".repeat(80)}` }),
    ),
  );
  const chunks = await store.search({ query: "sleepindex", limit: 20 });
  assert.equal(chunks.length, 20);
  assert.deepEqual(
    [...new Set(chunks.map((hit) => hit.documentId))],
    [long.id],
    "the strongest 20 chunks all belong to the long document",
  );
  for (const topK of [1, 3, 10]) {
    const hits = await store.searchDocuments({ query: "sleepindex", topK });
    assert.equal(hits.length, topK);
    assert.equal(new Set(hits.map((hit) => hit.documentId)).size, topK);
    assert.equal(hits[0].documentId, long.id);
    assert.deepEqual(
      hits[0],
      chunks[0],
      "each document is represented by its strongest matching chunk",
    );
    assert.deepEqual(
      hits.map((hit) => hit.label),
      Array.from({ length: topK }, (_, index) => `K${index + 1}`),
    );
    assert.deepEqual(
      await store.searchDocuments({ query: "sleepindex", topK }),
      hits,
      "ties retain deterministic document and chunk ordering",
    );
    for (let index = 1; index < hits.length; index += 1)
      assert.ok(hits[index - 1].score >= hits[index].score);
  }
  assert.equal((await store.searchDocuments({ query: "sleepindex" })).length, 5);
});

test("document Top K preserves relevant sources and permissions without filling missing matches", async () => {
  const store = createKnowledgeStore();
  const local = await store.add({
    title: "睡眠访谈",
    content: "失眠包括入睡困难和早醒。询问白天困倦与作息。",
    source: "https://example.org/sleep",
  });
  const external = await store.add({
    title: "睡眠日记",
    content: "记录睡眠作息和白天活动。",
    allowExternal: true,
  });
  await store.add({
    title: "停用的睡眠资料",
    content: "睡眠访谈与睡眠日记。",
    enabled: false,
    allowExternal: true,
  });
  await store.add({ title: "火箭工程", content: "卫星轨道和发动机推力。", allowExternal: true });
  const all = await store.searchDocuments({ query: "睡眠", topK: 10 });
  assert.equal(all.length, 2);
  assert.deepEqual(new Set(all.map((hit) => hit.documentId)), new Set([local.id, external.id]));
  const localSource = all.find((hit) => hit.documentId === local.id);
  assert.equal(localSource.title, "睡眠访谈");
  assert.equal(localSource.source, "https://example.org/sleep");
  assert.equal(localSource.chunkId, `${local.id}:1`);
  assert.equal(localSource.allowExternal, false);
  assert.match(localSource.excerpt, /入睡困难/);
  assert.deepEqual(
    (await store.searchDocuments({ query: "睡眠", externalOnly: true })).map(
      (hit) => hit.documentId,
    ),
    [external.id],
  );
  await store.update(external.id, { allowExternal: false });
  assert.deepEqual(await store.searchDocuments({ query: "睡眠", externalOnly: true }), []);
  await store.update(local.id, { enabled: false });
  await store.remove(external.id);
  assert.deepEqual(await store.searchDocuments({ query: "睡眠" }), []);
  assert.deepEqual(await store.searchDocuments({ query: "绘画透视" }), []);
  assert.deepEqual(
    await store.searchDocuments({ query: "请问这个是什么，帮我介绍一下相关内容。" }),
    [],
  );
});

test("document Top K strictly validates count, query and fields and recovers after rejected queries", async () => {
  const store = createKnowledgeStore();
  for (const topK of [0, -1, 11, 3.5, "3", null, true, NaN, Infinity]) {
    await assert.rejects(store.searchDocuments({ query: "睡眠", topK }), {
      status: 400,
      code: "INVALID_KNOWLEDGE",
    });
  }
  for (const input of [
    null,
    {},
    { query: "" },
    { query: "a".repeat(6_001) },
    { query: "睡眠", limit: 3 },
    { query: "睡眠", externalOnly: "yes" },
  ]) {
    await assert.rejects(store.searchDocuments(input), { status: 400, code: "INVALID_KNOWLEDGE" });
  }
  await store.add({ title: "睡眠记录", content: "记录睡眠作息。" });
  assert.equal((await store.searchDocuments({ query: "睡眠", topK: 1 })).length, 1);
  assert.deepEqual(await store.searchDocuments({ query: "a".repeat(6_000), topK: 10 }), []);
});
