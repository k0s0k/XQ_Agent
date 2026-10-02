import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

export const MAX_KNOWLEDGE_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_KNOWLEDGE_TEXT_CHARACTERS = 200_000;
const MAX_DOCUMENT_XML_BYTES = 4 * 1024 * 1024;
const PARSE_TIMEOUT_MS = 12_000;
const WORKER_TASK = "xq-agent-knowledge-file";

function fileError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function decodeUtf8(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/u, "");
  } catch {
    throw fileError(
      400,
      "INVALID_TEXT_ENCODING",
      "文本必须采用 UTF-8 编码，请另存为 UTF-8 后上传。",
    );
  }
}

function normalizeContent(text) {
  if (text.length > MAX_KNOWLEDGE_TEXT_CHARACTERS) {
    throw fileError(
      413,
      "EXTRACTED_TEXT_TOO_LARGE",
      "文档提取后的文本不能超过 20 万字，请拆分后上传。",
    );
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(text)) {
    throw fileError(400, "INVALID_TEXT_CONTENT", "文档包含不支持的控制字符，请上传纯文本内容。");
  }
  const normalized = text
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{4,}/gu, "\n\n\n")
    .trim();
  if (!normalized) throw fileError(400, "EMPTY_DOCUMENT", "文档没有可导入的文本。");
  return normalized;
}

// Validate the central directory before asking fflate to allocate an output buffer.
// No archive entry is ever written to disk; only the bounded document XML is read.
function inspectDocxArchive(bytes) {
  const invalid = () =>
    fileError(400, "INVALID_DOCX", "Word 文档结构无效，请使用有效的 .docx 文件。");
  if (bytes.length < 22) throw invalid();
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset--) {
    if (
      bytes.readUInt32LE(offset) === 0x06054b50 &&
      offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length
    ) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw invalid();
  const count = bytes.readUInt16LE(end + 10);
  const directoryLength = bytes.readUInt32LE(end + 12);
  const directoryStart = bytes.readUInt32LE(end + 16);
  if (
    bytes.readUInt16LE(end + 4) ||
    bytes.readUInt16LE(end + 6) ||
    count !== bytes.readUInt16LE(end + 8) ||
    count === 0xffff ||
    directoryStart === 0xffffffff ||
    directoryLength === 0xffffffff
  ) {
    throw fileError(415, "UNSUPPORTED_DOCX_ARCHIVE", "不支持分卷或 ZIP64 格式的 Word 文档。");
  }
  if (count > 2048) throw fileError(413, "DOCX_ARCHIVE_TOO_LARGE", "Word 文档内的文件数量过多。");
  if (directoryStart + directoryLength !== end || directoryStart > bytes.length) throw invalid();
  let cursor = directoryStart;
  let totalExpandedBytes = 0;
  let document;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) throw invalid();
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const originalSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (
      next > end ||
      localOffset + 30 > directoryStart ||
      originalSize === 0xffffffff ||
      compressedSize === 0xffffffff
    )
      throw invalid();
    totalExpandedBytes += originalSize;
    if (totalExpandedBytes > 32 * 1024 * 1024) {
      throw fileError(
        413,
        "DOCX_ARCHIVE_TOO_LARGE",
        "Word 文档解压后的总大小超过限制，请移除大附件后上传。",
      );
    }
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    if (name === "word/document.xml") {
      if (document) throw invalid();
      if (flags & 1)
        throw fileError(415, "ENCRYPTED_DOCUMENT", "暂不支持加密文档，请先解除密码保护。");
      if (![0, 8].includes(method))
        throw fileError(415, "UNSUPPORTED_DOCX_COMPRESSION", "Word 文档使用了不支持的压缩方式。");
      if (originalSize > MAX_DOCUMENT_XML_BYTES)
        throw fileError(413, "DOCX_XML_TOO_LARGE", "Word 正文结构过大，请拆分文档后上传。");
      if (bytes.readUInt32LE(localOffset) !== 0x04034b50) throw invalid();
      const localNameLength = bytes.readUInt16LE(localOffset + 26);
      const localExtraLength = bytes.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      if (
        dataStart + compressedSize > directoryStart ||
        bytes.readUInt16LE(localOffset + 8) !== method ||
        bytes.readUInt16LE(localOffset + 6) !== flags ||
        bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString("utf8") !==
          name
      )
        throw invalid();
      document = { originalSize, crc: bytes.readUInt32LE(cursor + 16) };
    }
    cursor = next;
  }
  if (cursor !== end || !document) throw invalid();
  return document;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function decodeXmlText(text) {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/giu, (entity, value) => {
    const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    if (Object.hasOwn(named, value)) return named[value];
    const codepoint =
      value[1]?.toLowerCase() === "x"
        ? Number.parseInt(value.slice(2), 16)
        : Number.parseInt(value.slice(1), 10);
    if (
      !Number.isInteger(codepoint) ||
      codepoint > 0x10ffff ||
      codepoint < 1 ||
      (codepoint >= 0xd800 && codepoint <= 0xdfff)
    ) {
      throw fileError(400, "INVALID_DOCX_XML", "Word 文档包含无效的 XML 字符。");
    }
    return String.fromCodePoint(codepoint);
  });
}

async function parseDocx(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
    throw fileError(
      415,
      "ENCRYPTED_DOCUMENT",
      "此文件可能是加密或旧版 Word 文档，请解除密码保护并另存为 .docx 后上传。",
    );
  }
  const document = inspectDocxArchive(bytes);
  const { unzipSync } = await import("fflate");
  let extracted;
  try {
    extracted = unzipSync(bytes, { filter: (entry) => entry.name === "word/document.xml" })[
      "word/document.xml"
    ];
  } catch {
    throw fileError(400, "INVALID_DOCX", "Word 文档压缩数据损坏，无法读取正文。");
  }
  if (
    !extracted ||
    extracted.length !== document.originalSize ||
    crc32(extracted) !== document.crc
  ) {
    throw fileError(400, "INVALID_DOCX", "Word 文档正文校验失败，文件可能损坏。");
  }
  const xml = decodeUtf8(extracted);
  if (/<!\s*(?:DOCTYPE|ENTITY)/iu.test(xml)) {
    throw fileError(415, "UNSUPPORTED_DOCX_XML", "不支持包含自定义 XML 实体的 Word 文档。");
  }
  if (!/<w:document(?:\s|>)/u.test(xml) || !/<\/w:document\s*>/u.test(xml)) {
    throw fileError(400, "INVALID_DOCX_XML", "Word 文档缺少有效的正文 XML。");
  }
  const paragraphs = [];
  let length = 0;
  for (const match of xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p\s*>/gu)) {
    const body = match[1];
    const style = body.match(/<w:pStyle\b[^>]*\bw:val=["']([^"']+)["']/u)?.[1] ?? "";
    const headingLevel = Number(style.match(/^(?:Heading|标题)\s*([1-6])$/iu)?.[1] ?? 0);
    const parts = [];
    for (const token of body.matchAll(
      /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t\s*>|<w:(tab|br|cr)\b[^>]*\/?\s*>/gu,
    )) {
      parts.push(
        token[1] !== undefined ? decodeXmlText(token[1]) : token[2] === "tab" ? "\t" : "\n",
      );
    }
    const line = `${headingLevel ? "#".repeat(headingLevel) + " " : ""}${parts.join("")}`.trim();
    if (!line) continue;
    length += line.length + 2;
    if (length > MAX_KNOWLEDGE_TEXT_CHARACTERS)
      throw fileError(
        413,
        "EXTRACTED_TEXT_TOO_LARGE",
        "文档提取后的文本不能超过 20 万字，请拆分后上传。",
      );
    paragraphs.push(line);
  }
  return paragraphs.join("\n\n");
}

async function parsePdf(bytes) {
  if (!bytes.subarray(0, 1024).includes(Buffer.from("%PDF-"))) {
    throw fileError(400, "INVALID_PDF", "文件不是有效的 PDF 文档。");
  }
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({
    data: Uint8Array.from(bytes),
    isEvalSupported: false,
    useWorkerFetch: false,
    disableAutoFetch: true,
    disableFontFace: true,
    useSystemFonts: true,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    stopAtErrors: true,
    verbosity: 0,
  });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 200)
      throw fileError(413, "PDF_TOO_MANY_PAGES", "PDF 不能超过 200 页，请拆分后上传。");
    const pages = [];
    let length = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const text = await page.getTextContent();
      const pieces = [];
      for (const item of text.items) {
        if (typeof item.str !== "string") continue;
        length += item.str.length + 1;
        if (length > MAX_KNOWLEDGE_TEXT_CHARACTERS)
          throw fileError(
            413,
            "EXTRACTED_TEXT_TOO_LARGE",
            "文档提取后的文本不能超过 20 万字，请拆分后上传。",
          );
        pieces.push(item.str + (item.hasEOL ? "\n" : " "));
      }
      const content = pieces.join("").trim();
      if (content) pages.push(`【第 ${pageNumber} 页】\n${content}`);
      page.cleanup();
    }
    if (!pages.length)
      throw fileError(
        415,
        "PDF_NO_TEXT",
        "此 PDF 没有可提取的文字，可能是扫描件。请先 OCR 或转换为 TXT / DOCX 后上传。",
      );
    return pages.join("\n\n");
  } catch (error) {
    if (error.status) throw error;
    if (error.name === "PasswordException")
      throw fileError(415, "ENCRYPTED_DOCUMENT", "暂不支持加密 PDF，请先解除密码保护。");
    throw fileError(
      400,
      "INVALID_PDF",
      "PDF 文档损坏或文本结构不受支持，请转换为 TXT / DOCX 后上传。",
    );
  } finally {
    await task.destroy();
  }
}

function parseInWorker(format, bytes) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { task: WORKER_TASK, format, bytes },
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32 },
    });
    let finished = false;
    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(
      () =>
        finish(fileError(413, "DOCUMENT_PARSE_TIMEOUT", "文档解析超时，请拆分或简化文档后上传。")),
      PARSE_TIMEOUT_MS,
    );
    worker.once("message", (result) =>
      result.error
        ? finish(fileError(result.error.status, result.error.code, result.error.message))
        : finish(null, result.content),
    );
    worker.once("error", () =>
      finish(
        fileError(400, "DOCUMENT_PARSE_FAILED", "文档解析失败，请检查文件或转换为 TXT 后上传。"),
      ),
    );
    worker.once("exit", () => {
      if (!finished)
        finish(
          fileError(400, "DOCUMENT_PARSE_FAILED", "文档解析意外中断，请拆分或转换文档后上传。"),
        );
    });
  });
}

/** Parse uploaded bytes only; never reads a supplied path or fetches remote content. */
export async function parseKnowledgeFile(input = {}) {
  const { filename, dataBase64 } = input ?? {};
  if (
    typeof filename !== "string" ||
    !filename.trim() ||
    filename.length > 240 ||
    filename !== filename.trim() ||
    /[\\/:<>"|?*\u0000-\u001F\u007F]/u.test(filename) ||
    filename === "." ||
    filename === ".."
  ) {
    throw fileError(400, "INVALID_FILENAME", "请提供不含路径或控制字符的有效文件名。");
  }
  const extension = filename.match(/\.([^.]+)$/u)?.[1].toLowerCase();
  const format = extension === "markdown" ? "md" : extension;
  if (!["txt", "md", "docx", "pdf"].includes(format)) {
    throw fileError(
      415,
      "UNSUPPORTED_FILE_TYPE",
      "支持 TXT、Markdown、DOCX 和含文字的 PDF 文件；旧版 .doc 请另存为 .docx。",
    );
  }
  if (typeof dataBase64 !== "string" || !dataBase64)
    throw fileError(400, "INVALID_FILE_DATA", "请提供有效的 Base64 文件内容。");
  if (dataBase64.length > Math.ceil(MAX_KNOWLEDGE_FILE_BYTES / 3) * 4) {
    throw fileError(413, "FILE_TOO_LARGE", "单个文件不能超过 5 MiB。");
  }
  if (dataBase64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(dataBase64)) {
    throw fileError(400, "INVALID_FILE_DATA", "文件 Base64 编码无效。");
  }
  const bytes = Buffer.from(dataBase64, "base64");
  if (bytes.toString("base64") !== dataBase64)
    throw fileError(400, "INVALID_FILE_DATA", "文件 Base64 编码无效。");
  if (bytes.length > MAX_KNOWLEDGE_FILE_BYTES)
    throw fileError(413, "FILE_TOO_LARGE", "单个文件不能超过 5 MiB。");
  const text =
    format === "txt" || format === "md" ? decodeUtf8(bytes) : await parseInWorker(format, bytes);
  const content = normalizeContent(text);
  const title = filename.slice(0, filename.lastIndexOf(".")).trim() || filename;
  return { title, content, format, filename };
}

if (!isMainThread && workerData?.task === WORKER_TASK) {
  try {
    const bytes = Buffer.from(workerData.bytes);
    const content = workerData.format === "docx" ? await parseDocx(bytes) : await parsePdf(bytes);
    parentPort.postMessage({ content });
  } catch (error) {
    parentPort.postMessage({
      error: {
        status: error.status ?? 400,
        code: error.code ?? "DOCUMENT_PARSE_FAILED",
        message: error.status ? error.message : "文档解析失败，请检查文件或转换为 TXT 后上传。",
      },
    });
  }
}
