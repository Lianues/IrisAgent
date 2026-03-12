/**
 * 文档文本提取模块
 *
 * 移植自 Pi 的 attachment-utils.ts，适配 Node.js。
 * 支持 PDF / DOCX / PPTX / XLSX(XLS) 格式。
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

const SUPPORTED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);

const EXTENSION_TO_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
};

/**
 * Check if a MIME type (or file extension) is supported for document extraction.
 */
export function isSupportedDocumentMime(mimeType: string, fileName?: string): boolean {
  if (SUPPORTED_MIME_TYPES.has(mimeType)) return true;

  if (fileName) {
    const ext = fileName.toLowerCase().match(/\.[^.]+$/)?.[0];
    if (ext && ext in EXTENSION_TO_MIME) return true;
  }

  return false;
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

    // Resolve effective MIME type
    let effectiveMime = doc.mimeType;
    if (!SUPPORTED_MIME_TYPES.has(effectiveMime)) {
      const ext = doc.fileName.toLowerCase().match(/\.[^.]+$/)?.[0];
      if (ext && ext in EXTENSION_TO_MIME) {
        effectiveMime = EXTENSION_TO_MIME[ext];
      }
    }

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
      default:
        return {
          fileName: doc.fileName,
          text: '',
          success: false,
          error: `不支持的文档格式: ${doc.mimeType}`,
        };
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
