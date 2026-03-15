/**
 * 文档文本提取模块
 *
 * 移植自 Pi 的 attachment-utils.ts，适配 Node.js。
 * 支持 PDF / DOCX / PPTX / XLSX(XLS) 与常见文本/代码文件格式。
 */

import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';

const MAX_DOCUMENT_SIZE = 50 * 1024 * 1024; // 50MB

export interface DocumentInput {
  fileName: string;
  mimeType: string;
  data: string; // base64
}

export interface ExtractedDocument {
  fileName: string;
  text: string;
  success: boolean;
  error?: string;
}

const SUPPORTED_BINARY_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);

const SUPPORTED_TEXT_MIME_TYPES = new Set([
  'text/markdown',
  'text/x-markdown',
  'application/json',
  'application/ld+json',
  'application/xml',
  'image/svg+xml',
  'application/x-yaml',
  'text/yaml',
  'text/x-yaml',
  'application/toml',
  'text/x-toml',
  'application/javascript',
  'text/javascript',
  'application/x-javascript',
  'application/x-sh',
  'application/x-shellscript',
  'application/sql',
]);

const EXTENSION_TO_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.json': 'application/json',
  '.jsonc': 'application/json',
  '.yaml': 'application/x-yaml',
  '.yml': 'application/x-yaml',
  '.toml': 'application/toml',
  '.ini': 'text/plain',
  '.cfg': 'text/plain',
  '.conf': 'text/plain',
  '.env': 'text/plain',
  '.xml': 'application/xml',
  '.svg': 'image/svg+xml',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.log': 'text/plain',
  '.py': 'text/x-python',
  '.js': 'application/javascript',
  '.jsx': 'text/javascript',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.mjs': 'application/javascript',
  '.cjs': 'application/javascript',
  '.java': 'text/x-java-source',
  '.c': 'text/x-c',
  '.h': 'text/x-c',
  '.cpp': 'text/x-c++src',
  '.hpp': 'text/x-c++src',
  '.cc': 'text/x-c++src',
  '.cs': 'text/plain',
  '.go': 'text/plain',
  '.rs': 'text/plain',
  '.php': 'application/x-httpd-php',
  '.rb': 'text/plain',
  '.sh': 'application/x-sh',
  '.bash': 'application/x-sh',
  '.zsh': 'application/x-sh',
  '.ps1': 'text/plain',
  '.sql': 'application/sql',
  '.css': 'text/css',
  '.scss': 'text/plain',
  '.less': 'text/plain',
  '.vue': 'text/plain',
};

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.md': 'markdown', '.markdown': 'markdown',
  '.json': 'json', '.jsonc': 'json',
  '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml',
  '.xml': 'xml', '.svg': 'xml', '.html': 'html', '.htm': 'html',
  '.py': 'python', '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript',
  '.java': 'java', '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.hpp': 'cpp', '.cc': 'cpp',
  '.cs': 'csharp', '.go': 'go', '.rs': 'rust', '.php': 'php', '.rb': 'ruby',
  '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash', '.ps1': 'powershell',
  '.sql': 'sql', '.css': 'css', '.scss': 'scss', '.less': 'less', '.vue': 'vue',
  '.csv': 'csv', '.tsv': 'tsv',
};

function normalizeMimeType(mimeType: string): string {
  return mimeType.split(';', 1)[0].trim().toLowerCase();
}

function getFileExtension(fileName?: string): string {
  return fileName?.toLowerCase().match(/\.[^.]+$/)?.[0] ?? '';
}

function isSupportedTextMime(mimeType: string): boolean {
  return mimeType.startsWith('text/') || SUPPORTED_TEXT_MIME_TYPES.has(mimeType);
}

function resolveSupportedDocumentMime(mimeType: string, fileName?: string): string | null {
  const normalizedMimeType = normalizeMimeType(mimeType);

  if (SUPPORTED_BINARY_MIME_TYPES.has(normalizedMimeType) || isSupportedTextMime(normalizedMimeType)) {
    return normalizedMimeType;
  }

  const ext = getFileExtension(fileName);
  if (!ext) return null;
  return EXTENSION_TO_MIME[ext] ?? null;
}

/**
 * Check if a MIME type (or file extension) is supported for document extraction.
 */
export function isSupportedDocumentMime(mimeType: string, fileName?: string): boolean {
  return resolveSupportedDocumentMime(mimeType, fileName) !== null;
}

/**
 * Extract text from a document.
 */
export async function extractDocument(doc: DocumentInput): Promise<ExtractedDocument> {
  try {
    const buffer = Buffer.from(doc.data, 'base64');

    if (buffer.length > MAX_DOCUMENT_SIZE) {
      return {
        fileName: doc.fileName,
        text: '',
        success: false,
        error: `文件过大 (${(buffer.length / 1024 / 1024).toFixed(1)}MB)，最大支持 50MB`,
      };
    }

    const effectiveMime = resolveSupportedDocumentMime(doc.mimeType, doc.fileName);

    switch (effectiveMime) {
      case 'application/pdf':
        return await processPdf(buffer, doc.fileName);
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        return await processDocx(buffer, doc.fileName);
      case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
        return await processPptx(buffer, doc.fileName);
      case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      case 'application/vnd.ms-excel':
        return await processExcel(buffer, doc.fileName);
      case null:
        return unsupportedDocument(doc.fileName, doc.mimeType);
      default:
        return await processTextDocument(buffer, doc.fileName, effectiveMime);
    }
  } catch (err) {
    return {
      fileName: doc.fileName,
      text: '',
      success: false,
      error: `文档处理失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function unsupportedDocument(fileName: string, mimeType: string): ExtractedDocument {
  return {
    fileName,
    text: '',
    success: false,
    error: `不支持的文档格式: ${mimeType}`,
  };
}

async function processTextDocument(buffer: Buffer, fileName: string, mimeType: string): Promise<ExtractedDocument> {
  try {
    if (looksLikeBinaryBuffer(buffer)) {
      return {
        fileName,
        text: '',
        success: false,
        error: '检测到疑似二进制内容，无法按文本文件读取',
      };
    }

    const ext = getFileExtension(fileName);
    const language = EXTENSION_TO_LANGUAGE[ext] ?? 'text';
    const decoded = decodeTextBuffer(buffer)
      .replace(/^\uFEFF/, '')
      .replace(/\u0000/g, '')
      .replace(/\r\n?/g, '\n');

    const content = decoded.trim().length > 0 ? decoded.trimEnd() : '(空文件)';
    const extractedText = [
      `[MimeType: ${mimeType || 'text/plain'}]`,
      `[Language: ${language}]`,
      '````' + (language === 'text' ? '' : language),
      content,
      '````',
    ].join('\n');

    return { fileName, text: extractedText, success: true };
  } catch (err) {
    throw new Error(`文本文件处理失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function decodeTextBuffer(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.toString('utf8', 3);
  }

  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString('utf16le');
  }

  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2));
    for (let index = 0; index + 1 < swapped.length; index += 2) {
      const first = swapped[index];
      swapped[index] = swapped[index + 1];
      swapped[index + 1] = first;
    }
    return swapped.toString('utf16le');
  }

  return buffer.toString('utf8');
}

function looksLikeBinaryBuffer(buffer: Buffer): boolean {
  let startIndex = 0;
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    startIndex = 3;
  } else if (
    buffer.length >= 2
    && ((buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0xfe && buffer[1] === 0xff))
  ) {
    startIndex = 2;
  }

  const sample = buffer.subarray(startIndex, Math.min(buffer.length, startIndex + 2048));
  let suspiciousBytes = 0;

  for (const byte of sample) {
    if (byte === 0) return true;
    const isAllowedControl = byte === 9 || byte === 10 || byte === 13;
    if (!isAllowedControl && ((byte >= 0 && byte < 8) || (byte > 13 && byte < 32))) {
      suspiciousBytes += 1;
    }
  }

  return sample.length > 0 && suspiciousBytes / sample.length > 0.1;
}

// ============ PDF ============

async function processPdf(buffer: Buffer, fileName: string): Promise<ExtractedDocument> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const textResult = await parser.getText();

    let extractedText = `<pdf filename="${escapeXml(fileName)}">`;

    if (textResult.pages.length === 0) {
      extractedText += `\n<page number="1">\n${textResult.text.trim()}\n</page>`;
    } else {
      for (const page of textResult.pages) {
        const pageText = page.text.trim();
        if (pageText) {
          extractedText += `\n<page number="${page.num}">\n${pageText}\n</page>`;
        }
      }
    }

    extractedText += '\n</pdf>';

    return { fileName, text: extractedText, success: true };
  } catch (err) {
    throw new Error(`PDF 处理失败: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await parser.destroy().catch(() => {});
  }
}

// ============ DOCX ============

async function processDocx(buffer: Buffer, fileName: string): Promise<ExtractedDocument> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value.trim();

    let extractedText = `<docx filename="${escapeXml(fileName)}">`;
    extractedText += `\n<page number="1">\n${text}\n</page>`;
    extractedText += '\n</docx>';

    return { fileName, text: extractedText, success: true };
  } catch (err) {
    throw new Error(`DOCX 处理失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ============ PPTX ============

async function processPptx(buffer: Buffer, fileName: string): Promise<ExtractedDocument> {
  try {
    const zip = await JSZip.loadAsync(buffer);

    let extractedText = `<pptx filename="${escapeXml(fileName)}">`;

    // Get all slide files and sort them numerically
    const slideFiles = Object.keys(zip.files)
      .filter((name) => name.match(/ppt\/slides\/slide\d+\.xml$/))
      .sort((a, b) => {
        const numA = parseInt(a.match(/slide(\d+)\.xml$/)?.[1] || '0', 10);
        const numB = parseInt(b.match(/slide(\d+)\.xml$/)?.[1] || '0', 10);
        return numA - numB;
      });

    // Extract text from each slide
    for (let i = 0; i < slideFiles.length; i++) {
      const slideFile = zip.file(slideFiles[i]);
      if (slideFile) {
        const slideXml = await slideFile.async('text');

        // Extract text from XML (regex approach for <a:t> tags)
        const textMatches = slideXml.match(/<a:t[^>]*>([^<]+)<\/a:t>/g);

        if (textMatches) {
          extractedText += `\n<slide number="${i + 1}">`;
          const slideTexts = textMatches
            .map((match) => {
              const textMatch = match.match(/<a:t[^>]*>([^<]+)<\/a:t>/);
              return textMatch ? textMatch[1] : '';
            })
            .filter((t) => t.trim());

          if (slideTexts.length > 0) {
            extractedText += `\n${slideTexts.join('\n')}`;
          }
          extractedText += '\n</slide>';
        }
      }
    }

    // Extract notes
    const notesFiles = Object.keys(zip.files)
      .filter((name) => name.match(/ppt\/notesSlides\/notesSlide\d+\.xml$/))
      .sort((a, b) => {
        const numA = parseInt(a.match(/notesSlide(\d+)\.xml$/)?.[1] || '0', 10);
        const numB = parseInt(b.match(/notesSlide(\d+)\.xml$/)?.[1] || '0', 10);
        return numA - numB;
      });

    if (notesFiles.length > 0) {
      extractedText += '\n<notes>';
      for (const noteFile of notesFiles) {
        const file = zip.file(noteFile);
        if (file) {
          const noteXml = await file.async('text');
          const textMatches = noteXml.match(/<a:t[^>]*>([^<]+)<\/a:t>/g);
          if (textMatches) {
            const noteTexts = textMatches
              .map((match) => {
                const textMatch = match.match(/<a:t[^>]*>([^<]+)<\/a:t>/);
                return textMatch ? textMatch[1] : '';
              })
              .filter((t) => t.trim());

            if (noteTexts.length > 0) {
              const slideNum = noteFile.match(/notesSlide(\d+)\.xml$/)?.[1];
              extractedText += `\n[Slide ${slideNum} notes]: ${noteTexts.join(' ')}`;
            }
          }
        }
      }
      extractedText += '\n</notes>';
    }

    extractedText += '\n</pptx>';
    return { fileName, text: extractedText, success: true };
  } catch (err) {
    throw new Error(`PPTX 处理失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ============ Excel ============

async function processExcel(buffer: Buffer, fileName: string): Promise<ExtractedDocument> {
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer' });

    let extractedText = `<excel filename="${escapeXml(fileName)}">`;

    for (const [index, sheetName] of workbook.SheetNames.entries()) {
      const worksheet = workbook.Sheets[sheetName];
      const csvText = XLSX.utils.sheet_to_csv(worksheet);
      extractedText += `\n<sheet name="${escapeXml(sheetName)}" index="${index + 1}">\n${csvText}\n</sheet>`;
    }

    extractedText += '\n</excel>';
    return { fileName, text: extractedText, success: true };
  } catch (err) {
    throw new Error(`Excel 处理失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ============ Helpers ============

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
