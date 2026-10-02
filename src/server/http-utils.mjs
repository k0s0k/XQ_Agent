export const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
export const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
};

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export function fail(status, code, message) {
  throw new HttpError(status, code, message);
}
export function validateText(value, name, max, { required = false } = {}) {
  if (typeof value !== "string") fail(400, "INVALID_INPUT", `${name}必须为文本。`);
  const clean = value.trim();
  if ((required && !clean) || clean.length > max || /\u0000/.test(clean))
    fail(400, "INVALID_INPUT", `${name}为空、过长或包含无效字符。`);
  return clean;
}
export function validateFields(body, allowed) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    fail(400, "INVALID_INPUT", "请求必须为 JSON 对象。");
  if (Object.keys(body).some((key) => !allowed.includes(key)))
    fail(400, "INVALID_INPUT", "请求包含不支持的字段。");
}
export function validateBoolean(value) {
  if (typeof value !== "boolean") fail(400, "INVALID_INPUT", "consent 必须为布尔值。");
  return value;
}
export function validateTopK(value) {
  if (!Number.isInteger(value) || value < 1 || value > 10)
    fail(400, "INVALID_TOP_K", "Top K 必须是 1 至 10 的整数。");
  return value;
}
export function validateSessionKind(value) {
  if (!["intake", "chat"].includes(value))
    fail(400, "INVALID_SESSION_KIND", "对话类型必须是 chat 或 intake。");
  return value;
}
export function validateProviderUrl(value) {
  let url;
  try {
    url = new URL(validateText(value, "模型服务地址", 500, { required: true }));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    fail(400, "INVALID_PROVIDER", "模型服务地址无效。");
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)))
  ) {
    fail(
      400,
      "INVALID_PROVIDER",
      "模型服务需使用 HTTPS；本机模型可使用 HTTP。地址不能包含密钥、查询参数或账号。",
    );
  }
  return url.href.replace(/\/+$/, "");
}
export async function readJson(req, maximum) {
  if (!(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json"))
    fail(415, "JSON_REQUIRED", "请使用 application/json 请求。");
  if (Number(req.headers["content-length"]) > maximum)
    fail(413, "BODY_TOO_LARGE", "请求内容超过大小限制。");
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maximum) fail(413, "BODY_TOO_LARGE", "请求内容超过大小限制。");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    fail(400, "INVALID_JSON", "JSON 内容无效。");
  }
}
