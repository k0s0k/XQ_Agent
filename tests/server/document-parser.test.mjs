import assert from "node:assert/strict";
import test from "node:test";
import { zipSync, strToU8 } from "fflate";
import {
  parseKnowledgeFile,
  MAX_KNOWLEDGE_FILE_BYTES,
  MAX_KNOWLEDGE_TEXT_CHARACTERS,
} from "../../src/server/document-parser.mjs";

const upload = (filename, bytes) => ({
  filename,
  dataBase64: Buffer.from(bytes).toString("base64"),
});
const failsWith = (code, status) => (error) => {
  assert.equal(error.code, code);
  assert.equal(error.status, status);
  assert.ok(error.message);
  return true;
};

function docx(paragraphs, extra = {}) {
  return Buffer.from(
    zipSync({
      "[Content_Types].xml": strToU8("<Types/>"),
      "word/document.xml": strToU8(
        `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`,
      ),
      ...extra,
    }),
  );
}

function centralEntry(bytes, name) {
  for (let offset = 0; offset + 46 < bytes.length; offset++) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) continue;
    const length = bytes.readUInt16LE(offset + 28);
    if (bytes.subarray(offset + 46, offset + 46 + length).toString("utf8") === name) return offset;
  }
  throw new Error("Fixture entry missing");
}

function pdf(text = "", { encrypted = false } = {}) {
  const stream = text ? `BT /F1 12 Tf 50 700 Td (${text.replace(/[()\\]/gu, "\\$&")}) Tj ET` : "";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  if (encrypted)
    objects.push(
      `<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${"00".repeat(32)}> /U <${"00".repeat(32)}> /P -4 >>`,
    );
  let result = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index++) {
    offsets.push(Buffer.byteLength(result));
    result += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(result);
  result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) result += `${String(offset).padStart(10, "0")} 00000 n \n`;
  result += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${encrypted ? ` /Encrypt 6 0 R /ID [<${"01".repeat(16)}> <${"01".repeat(16)}>]` : ""} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(result);
}

test("imports UTF-8 Chinese Markdown and BOM text while keeping document metadata", async () => {
  assert.deepEqual(
    await parseKnowledgeFile(upload("接诊指南.MD", "\uFEFF# 初次接诊\r\n\r\n先了解来访目标。")),
    {
      title: "接诊指南",
      filename: "接诊指南.MD",
      format: "md",
      content: "# 初次接诊\n\n先了解来访目标。",
    },
  );
  assert.equal(
    (await parseKnowledgeFile(upload("记录.txt", "咨询记录\n第二段"))).content,
    "咨询记录\n第二段",
  );
});

test("rejects paths, unsupported formats, noncanonical base64, binary text, and invalid UTF-8", async () => {
  await assert.rejects(parseKnowledgeFile(null), failsWith("INVALID_FILENAME", 400));
  for (const filename of ["../secret.txt", "C:\\secret.txt", "/secret.txt", "test\u0000.txt"]) {
    await assert.rejects(
      parseKnowledgeFile(upload(filename, "text")),
      failsWith("INVALID_FILENAME", 400),
    );
  }
  await assert.rejects(
    parseKnowledgeFile(upload("guide.doc", "text")),
    failsWith("UNSUPPORTED_FILE_TYPE", 415),
  );
  for (const dataBase64 of ["aA", "aA==\n", "a?==", "aB==", "=AAA"]) {
    await assert.rejects(
      parseKnowledgeFile({ filename: "test.txt", dataBase64 }),
      failsWith("INVALID_FILE_DATA", 400),
    );
  }
  await assert.rejects(
    parseKnowledgeFile(upload("test.txt", Buffer.from([0xff, 0xfe]))),
    failsWith("INVALID_TEXT_ENCODING", 400),
  );
  await assert.rejects(
    parseKnowledgeFile(upload("test.txt", "abc\u0000def")),
    failsWith("INVALID_TEXT_CONTENT", 400),
  );
  await assert.rejects(
    parseKnowledgeFile(upload("test.txt", " \n\t ")),
    failsWith("EMPTY_DOCUMENT", 400),
  );
});

test("enforces file and extracted text limits before indexing", async () => {
  await assert.rejects(
    parseKnowledgeFile(upload("huge.txt", Buffer.alloc(MAX_KNOWLEDGE_FILE_BYTES + 1, 65))),
    failsWith("FILE_TOO_LARGE", 413),
  );
  await assert.rejects(
    parseKnowledgeFile(upload("long.txt", "中".repeat(MAX_KNOWLEDGE_TEXT_CHARACTERS + 1))),
    failsWith("EXTRACTED_TEXT_TOO_LARGE", 413),
  );
});

test("extracts DOCX headings, paragraphs, table text, tabs and XML entities without importing attachments", async () => {
  const bytes = docx(
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>初次接诊</w:t></w:r></w:p>' +
      "<w:p><w:r><w:t>目标 &amp; 支持</w:t><w:tab/><w:t>&#x4E2D;&#25991;</w:t><w:br/><w:t>第二行</w:t></w:r></w:p>" +
      "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格内容</w:t></w:r></w:p></w:tc></w:tr></w:tbl>",
    {
      "word/media/unused.txt": strToU8("不应读取的附件"),
    },
  );
  const parsed = await parseKnowledgeFile(upload("接诊手册.docx", bytes));
  assert.equal(parsed.format, "docx");
  assert.equal(parsed.content, "# 初次接诊\n\n目标 & 支持\t中文\n第二行\n\n表格内容");
});

test("rejects DOCX archive expansion metadata and forged short output size", async () => {
  const bytes = docx("<w:p><w:r><w:t>正文</w:t></w:r></w:p>");
  const entry = centralEntry(bytes, "word/document.xml");
  const oversized = Buffer.from(bytes);
  oversized.writeUInt32LE(5 * 1024 * 1024, entry + 24);
  await assert.rejects(
    parseKnowledgeFile(upload("bomb.docx", oversized)),
    failsWith("DOCX_XML_TOO_LARGE", 413),
  );
  const forged = Buffer.from(bytes);
  forged.writeUInt32LE(10, entry + 24);
  await assert.rejects(
    parseKnowledgeFile(upload("forged.docx", forged)),
    failsWith("INVALID_DOCX", 400),
  );
});

test("rejects custom XML entities and damaged DOCX archives", async () => {
  const entityXml =
    '<!DOCTYPE w:document [<!ENTITY secret SYSTEM "file:///etc/passwd">]><w:document><w:p><w:r><w:t>&secret;</w:t></w:r></w:p></w:document>';
  const bytes = zipSync({ "word/document.xml": strToU8(entityXml) });
  await assert.rejects(
    parseKnowledgeFile(upload("entity.docx", bytes)),
    failsWith("UNSUPPORTED_DOCX_XML", 415),
  );
  await assert.rejects(
    parseKnowledgeFile(upload("broken.docx", Buffer.from("not a zip"))),
    failsWith("INVALID_DOCX", 400),
  );
  await assert.rejects(
    parseKnowledgeFile(upload("missing.docx", zipSync({ "other.xml": strToU8("<data/>") }))),
    failsWith("INVALID_DOCX", 400),
  );
  await assert.rejects(
    parseKnowledgeFile(
      upload("encrypted.docx", Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
    ),
    failsWith("ENCRYPTED_DOCUMENT", 415),
  );
});

test("extracts a real PDF text stream with a page marker in the worker", async () => {
  const result = await parseKnowledgeFile(
    upload("interview.pdf", pdf("Counselor intake reference")),
  );
  assert.equal(result.format, "pdf");
  assert.match(result.content, /【第 1 页】/u);
  assert.match(result.content, /Counselor intake reference/u);
});

test("rejects empty/scanned, encrypted, and invalid PDFs with actionable errors", async () => {
  await assert.rejects(
    parseKnowledgeFile(upload("scan.pdf", pdf())),
    failsWith("PDF_NO_TEXT", 415),
  );
  await assert.rejects(
    parseKnowledgeFile(upload("encrypted.pdf", pdf("secret", { encrypted: true }))),
    failsWith("ENCRYPTED_DOCUMENT", 415),
  );
  await assert.rejects(
    parseKnowledgeFile(upload("fake.pdf", "not PDF")),
    failsWith("INVALID_PDF", 400),
  );
});
