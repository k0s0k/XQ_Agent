import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const LIMITS = {
  documents: 100,
  characters: 200_000,
  totalCharacters: 5_000_000,
  chunks: 10_000,
  fileBytes: 24_000_000,
};
const FORMATS = new Set(["text", "txt", "markdown", "md", "pdf", "docx"]);
const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
const STOP_WORDS = new Set(
  "的 了 是 和 与 或 在 有 为 对 将 及 等 我 你 他 她 它 我们 你们 他们 一个 这个 那个 这些 那些 什么 怎么 如何 为什么 是否 可以 可能 需要 进行 通过 关于 根据 使用 如果 因为 所以 但是 以及 还有 已经 目前 最近 现在 一些 比较 非常 一般 相关 问题 内容 情况 方面 时候 时候 时间 帮助 帮我 请问 想问 知道 提供 建议 了解 说明 介绍 一下 这样 那样 来访者 咨询师 助手 接诊 心理咨询 请 the a an and or of to in is are was were be been being for with on at by from as that this it its i you we they how what when where why can could should would please about help have has had not".split(
    /\s+/,
  ),
);

function fail(status, code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.status = status;
  error.code = code;
  throw error;
}
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function validateText(value, name, max, required = false) {
  if (typeof value !== "string") fail(400, "INVALID_KNOWLEDGE", `${name}必须为文本。`);
  const clean = value.replace(/\r\n?/g, "\n").trim();
  if (
    (required && !clean) ||
    clean.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(clean)
  )
    fail(400, "INVALID_KNOWLEDGE", `${name}为空、过长或包含无效字符。`);
  return clean;
}
function validateBoolean(value, name) {
  if (typeof value !== "boolean") fail(400, "INVALID_KNOWLEDGE", `${name}必须为布尔值。`);
  return value;
}
function validateSourceUrl(value) {
  const clean = validateText(value, "资料来源", 2_000);
  if (!clean) return "";
  let url;
  try {
    url = new URL(clean);
  } catch {
    fail(400, "INVALID_KNOWLEDGE", "资料来源必须是完整的 HTTP 或 HTTPS 链接。");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    fail(400, "INVALID_KNOWLEDGE", "资料来源只接受不含账号密码的 HTTP 或 HTTPS 链接。");
  return url.href;
}
function validateFields(input, allowed) {
  if (!isPlainObject(input) || Object.keys(input).some((key) => !allowed.includes(key)))
    fail(400, "INVALID_KNOWLEDGE", "知识库请求包含无效字段。");
}

// These are overlapping slices of the original text, so quotations never invent text.
// Prefer paragraph/heading boundaries, then sentence boundaries, near the target size.
function splitChunks(content) {
  const chunks = [];
  let start = 0;
  while (start < content.length) {
    let end = Math.min(start + 900, content.length);
    if (content.length - start <= 1_000) end = content.length;
    else {
      const window = content.slice(start + 600, end);
      const paragraphEnds = [
        ...window.matchAll(
          /\n\s*\n|\n(?=#{1,6}\s|第[一二三四五六七八九十百\d]+[章节]|[一二三四五六七八九十]+[、．])/gu,
        ),
      ];
      const sentenceEnds = [...window.matchAll(/[。！？.!?](?:[”’"])?\s*|\n/gu)];
      const boundary = paragraphEnds.at(-1) ?? sentenceEnds.at(-1);
      if (boundary) end = start + 600 + boundary.index + boundary[0].length;
    }
    if (end < content.length && /[\uD800-\uDBFF]/u.test(content[end - 1])) end -= 1;
    const excerpt = content.slice(start, end).trim();
    if (excerpt) chunks.push(excerpt);
    if (end === content.length) break;
    start = Math.max(start + 1, end - 120);
    // Do not split surrogate pairs (e.g. emoji) at an overlap boundary.
    if (/[\uDC00-\uDFFF]/u.test(content[start])) start += 1;
  }
  return chunks;
}

function tokenizeText(text) {
  const normalized = text.normalize("NFKC").toLowerCase();
  const counts = new Map();
  const words = new Set();
  const add = (token, weight, word = false) => {
    if (token.length < 2 || STOP_WORDS.has(token) || /^\d+$/u.test(token)) return;
    counts.set(token, (counts.get(token) ?? 0) + weight);
    if (word) words.add(token);
  };
  for (const { segment, isWordLike } of segmenter.segment(normalized)) {
    if (isWordLike && /^[\p{Script=Han}a-z\d_-]+$/u.test(segment)) add(segment, 1, true);
  }
  for (const match of normalized.matchAll(/[a-z][a-z\d]*(?:[-_][a-z\d]+)*/gu))
    add(match[0], 1, true);
  for (const match of normalized.matchAll(/[\p{Script=Han}]{2,}/gu)) {
    const chars = [...match[0]];
    for (let index = 0; index < chars.length - 1; index += 1)
      add(chars[index] + chars[index + 1], 0.3);
  }
  return { counts, words };
}
function indexDocument(document) {
  const titleTokens = tokenizeText(document.title).counts;
  const chunks = splitChunks(document.content).map((excerpt, index) => {
    const counts = tokenizeText(excerpt).counts;
    const length = [...counts.values()].reduce((sum, count) => sum + count, 0);
    for (const [term, count] of titleTokens)
      counts.set(term, (counts.get(term) ?? 0) + count * 2.5);
    return {
      excerpt,
      chunkIndex: index + 1,
      chunkId: `${document.id}:${index + 1}`,
      counts,
      length: Math.max(1, length),
    };
  });
  return { ...document, _chunks: chunks };
}
function documentMetadata(document) {
  const { id, title, source, filename, format, enabled, allowExternal, createdAt, updatedAt } =
    document;
  return {
    id,
    title,
    source,
    filename,
    format,
    enabled,
    allowExternal,
    chunkCount: document._chunks.length,
    characterCount: document.content.length,
    createdAt,
    updatedAt,
  };
}
function documentRecord(document) {
  const {
    id,
    title,
    content,
    source,
    filename,
    format,
    enabled,
    allowExternal,
    createdAt,
    updatedAt,
  } = document;
  return {
    id,
    title,
    content,
    source,
    filename,
    format,
    enabled,
    allowExternal,
    createdAt,
    updatedAt,
  };
}
function validateContent(input) {
  const title = validateText(input.title, "资料标题", 200, true);
  const content = validateText(input.content, "资料正文", LIMITS.characters, true);
  const source = validateSourceUrl(input.source ?? "");
  const filename = validateText(input.filename ?? "", "文件名", 255);
  const format = input.format ?? "text";
  if (!FORMATS.has(format)) fail(400, "INVALID_KNOWLEDGE", "资料格式不受支持。");
  const enabled = validateBoolean(input.enabled ?? true, "enabled");
  const allowExternal = validateBoolean(input.allowExternal ?? false, "allowExternal");
  return { title, content, source, filename, format, enabled, allowExternal };
}
function checkCapacity(documents) {
  let characters = 0;
  let chunks = 0;
  for (const document of documents.values()) {
    characters += document.content.length;
    chunks += document._chunks.length;
  }
  if (
    documents.size > LIMITS.documents ||
    characters > LIMITS.totalCharacters ||
    chunks > LIMITS.chunks
  )
    fail(
      413,
      "KNOWLEDGE_CAPACITY",
      "知识库容量已满（最多 100 份资料、500 万字符）；请先删除不需要的资料。",
    );
}

// Rank the full eligible corpus before either chunk limits or document grouping.
// This prevents a long document from hiding other relevant documents in Top K.
function rankChunks(documents, query, externalOnly) {
  const queryTokens = tokenizeText(query);
  const terms = [...queryTokens.counts.keys()];
  if (!terms.length) return [];
  const rows = [...documents.values()]
    .filter((document) => document.enabled && (!externalOnly || document.allowExternal))
    .flatMap((document) => document._chunks.map((chunk) => ({ document, chunk })));
  if (!rows.length) return [];
  const averageLength = rows.reduce((sum, row) => sum + row.chunk.length, 0) / rows.length;
  const frequencies = new Map(
    terms.map((term) => [
      term,
      rows.reduce((sum, row) => sum + Number(row.chunk.counts.has(term)), 0),
    ]),
  );
  const ranked = [];
  for (const { document, chunk } of rows) {
    let score = 0;
    let wordMatches = 0;
    let fragmentMatches = 0;
    for (const term of terms) {
      const tf = chunk.counts.get(term);
      if (!tf) continue;
      const fullWord = queryTokens.words.has(term);
      if (fullWord) wordMatches += 1;
      else fragmentMatches += 1;
      const df = frequencies.get(term);
      const idf = Math.log(1 + (rows.length - df + 0.5) / (df + 0.5));
      score +=
        idf *
        ((tf * 2.2) / (tf + 1.2 * (0.25 + (0.75 * chunk.length) / averageLength))) *
        (fullWord ? 1 : 0.35);
    }
    // A lone accidental bigram is not enough evidence for a long compound query.
    if (score > 0 && (wordMatches > 0 || fragmentMatches >= Math.min(2, terms.length)))
      ranked.push({ document, chunk, score });
  }
  return ranked.sort(
    (a, b) =>
      b.score - a.score ||
      a.document.id.localeCompare(b.document.id) ||
      a.chunk.chunkIndex - b.chunk.chunkIndex,
  );
}
function buildSourceReferences(rows) {
  return rows.map(({ document, chunk, score }, index) => ({
    label: `K${index + 1}`,
    documentId: document.id,
    chunkId: chunk.chunkId,
    title: document.title,
    source: document.source,
    excerpt: chunk.excerpt,
    chunkIndex: chunk.chunkIndex,
    score: Number(score.toFixed(6)),
    allowExternal: document.allowExternal,
  }));
}

export function createKnowledgeStore({ directory = null } = {}) {
  if (directory !== null && (typeof directory !== "string" || !directory.trim()))
    fail(500, "KNOWLEDGE_STORAGE_ERROR", "知识库存储目录无效。");
  const storageFile = directory === null ? null : path.join(directory, "knowledge.json");
  let documents = new Map();
  let queue = Promise.resolve();
  const ready = initialize();
  // Keep a failed initialization observable to every method without an unhandled rejection.
  ready.catch(() => {});

  async function initialize() {
    if (!storageFile) return;
    let serialized;
    try {
      const info = await stat(storageFile);
      if (!info.isFile() || info.size > LIMITS.fileBytes)
        fail(500, "KNOWLEDGE_CORRUPT", "知识库文件无效或超过容量限制，请检查 knowledge.json。");
      serialized = await readFile(storageFile, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return;
      if (error.code === "KNOWLEDGE_CORRUPT") throw error;
      fail(500, "KNOWLEDGE_STORAGE_ERROR", "无法读取本地知识库，请检查目录权限。", error);
    }
    try {
      const parsed = JSON.parse(serialized);
      if (
        !isPlainObject(parsed) ||
        parsed.version !== 1 ||
        !Array.isArray(parsed.documents) ||
        parsed.documents.length > LIMITS.documents
      )
        throw new Error("Invalid knowledge file structure");
      const loaded = new Map();
      for (const raw of parsed.documents) {
        if (
          !isPlainObject(raw) ||
          typeof raw.id !== "string" ||
          !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/iu.test(raw.id) ||
          loaded.has(raw.id)
        )
          throw new Error("Invalid or duplicate document ID");
        if (
          ![raw.createdAt, raw.updatedAt].every(
            (value) => typeof value === "string" && Number.isFinite(Date.parse(value)),
          )
        )
          throw new Error("Invalid document timestamps");
        if (typeof raw.enabled !== "boolean" || typeof raw.allowExternal !== "boolean")
          throw new Error("Invalid document permissions");
        const document = indexDocument({
          ...validateContent(raw),
          id: raw.id,
          createdAt: raw.createdAt,
          updatedAt: raw.updatedAt,
        });
        loaded.set(document.id, document);
      }
      checkCapacity(loaded);
      documents = loaded;
    } catch (error) {
      fail(
        500,
        "KNOWLEDGE_CORRUPT",
        "本地知识库文件损坏或格式不兼容；原文件已保留，请检查 knowledge.json。",
        error,
      );
    }
  }
  function enqueueOperation(operation) {
    const result = queue.then(() => ready).then(operation);
    queue = result.catch(() => {});
    return result;
  }
  async function persistDocuments(nextDocuments) {
    checkCapacity(nextDocuments);
    if (storageFile) {
      const temporary = path.join(directory, `knowledge.${randomUUID()}.tmp`);
      try {
        await mkdir(directory, { recursive: true });
        await writeFile(
          temporary,
          JSON.stringify({
            version: 1,
            documents: [...nextDocuments.values()].map(documentRecord),
          }),
          { encoding: "utf8", flag: "wx", mode: 0o600 },
        );
        await rename(temporary, storageFile);
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => {});
        fail(500, "KNOWLEDGE_STORAGE_ERROR", "知识库保存失败，请检查磁盘空间和目录权限。", error);
      }
    }
    documents = nextDocuments;
  }
  function requireDocument(id) {
    const document = documents.get(id);
    if (!document) fail(404, "KNOWLEDGE_NOT_FOUND", "未找到这份知识库资料。");
    return document;
  }

  return {
    list() {
      return enqueueOperation(() => [...documents.values()].reverse().map(documentMetadata));
    },
    get(id) {
      return enqueueOperation(() => {
        const document = requireDocument(id);
        return { ...documentMetadata(document), content: document.content };
      });
    },
    add(input) {
      return enqueueOperation(async () => {
        validateFields(input, [
          "title",
          "content",
          "source",
          "filename",
          "format",
          "enabled",
          "allowExternal",
        ]);
        const now = new Date().toISOString();
        const document = indexDocument({
          ...validateContent(input),
          id: randomUUID(),
          createdAt: now,
          updatedAt: now,
        });
        const next = new Map(documents);
        next.set(document.id, document);
        await persistDocuments(next);
        return documentMetadata(document);
      });
    },
    update(id, input) {
      return enqueueOperation(async () => {
        validateFields(input, ["title", "source", "enabled", "allowExternal"]);
        const previous = requireDocument(id);
        const changed = { ...documentRecord(previous), updatedAt: new Date().toISOString() };
        if ("title" in input) changed.title = validateText(input.title, "资料标题", 200, true);
        if ("source" in input) changed.source = validateSourceUrl(input.source);
        if ("enabled" in input) changed.enabled = validateBoolean(input.enabled, "enabled");
        if ("allowExternal" in input)
          changed.allowExternal = validateBoolean(input.allowExternal, "allowExternal");
        const document =
          input.title === undefined
            ? { ...changed, _chunks: previous._chunks }
            : indexDocument(changed);
        const next = new Map(documents);
        next.set(id, document);
        await persistDocuments(next);
        return documentMetadata(document);
      });
    },
    remove(id) {
      return enqueueOperation(async () => {
        requireDocument(id);
        const next = new Map(documents);
        next.delete(id);
        await persistDocuments(next);
        return { deleted: true };
      });
    },
    search(input) {
      return enqueueOperation(() => {
        validateFields(input, ["query", "limit", "externalOnly"]);
        const query = validateText(input.query, "检索问题", 6_000, true);
        const limit = input.limit ?? 5;
        const externalOnly = validateBoolean(input.externalOnly ?? false, "externalOnly");
        if (!Number.isInteger(limit) || limit < 1 || limit > 20)
          fail(400, "INVALID_KNOWLEDGE", "检索条数必须是 1 至 20 的整数。");
        return buildSourceReferences(rankChunks(documents, query, externalOnly).slice(0, limit));
      });
    },
    searchDocuments(input) {
      return enqueueOperation(() => {
        validateFields(input, ["query", "topK", "externalOnly"]);
        const query = validateText(input.query, "检索问题", 6_000, true);
        const topK = input.topK === undefined ? 5 : input.topK;
        const externalOnly = validateBoolean(input.externalOnly ?? false, "externalOnly");
        if (!Number.isInteger(topK) || topK < 1 || topK > 10)
          fail(400, "INVALID_KNOWLEDGE", "检索文档数必须是 1 至 10 的整数。");
        const seen = new Set();
        const distinct = [];
        for (const row of rankChunks(documents, query, externalOnly)) {
          if (seen.has(row.document.id)) continue;
          seen.add(row.document.id);
          distinct.push(row);
          if (distinct.length === topK) break;
        }
        return buildSourceReferences(distinct);
      });
    },
  };
}
