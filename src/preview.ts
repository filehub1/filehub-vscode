import fs from 'fs';
import path from 'path';

const TEXT_EXTS = new Set([
  '.txt','.md','.mdx','.rst','.json','.jsonc','.js','.mjs','.cjs','.ts','.jsx','.tsx',
  '.css','.scss','.sass','.less','.html','.htm','.xml','.yml','.yaml','.toml','.ini',
  '.cfg','.conf','.env','.sh','.bash','.bat','.cmd','.ps1','.py','.java','.c','.cpp',
  '.h','.cs','.go','.rs','.rb','.php','.swift','.kt','.sql','.csv','.vue','.svelte','.lock'
]);

const BINARY_EXTS = new Set([
  '.png','.jpg','.jpeg','.gif','.bmp','.webp','.ico','.svg',
  '.pdf','.xlsx','.xls'
]);

const MAX_TEXT = 256 * 1024;
const MAX_BIN = 50 * 1024 * 1024;

export interface PreviewResponse {
  success: boolean;
  data?: string;
  ext?: string;
  error?: string;
  contentEncoding?: 'base64' | 'utf8';
  truncated?: boolean;
  streamUrl?: string;
}

function decodeText(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le').replace(/\u0000/g, '');
  if (buf[0] === 0xfe && buf[1] === 0xff) return buf.toString('utf16le').replace(/\u0000/g, '');
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.toString('utf8');
  return buf.toString('utf8');
}

function isProbablyText(buf: Buffer): boolean {
  for (const b of buf) { if (b === 0) return false; }
  return true;
}

function stripXml(xml: string): string {
  return xml
    .replace(/<w:p[^>]*>/g, '\n').replace(/<\/w:p>/g, '\n')
    .replace(/<a:p[^>]*>/g, '\n').replace(/<\/a:p>/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"')
    .replace(/\n{3,}/g,'\n\n').replace(/[ \t]{2,}/g,' ').trim();
}

async function extractOpenXml(filePath: string, ext: string): Promise<string | null> {
  const yauzl = require('yauzl');
  return new Promise(resolve => {
    yauzl.open(filePath, { lazyEntries: true }, (err: any, zip: any) => {
      if (err || !zip) return resolve(null);
      const slides: { name: string; text: string }[] = [];
      let done = false;
      const finish = (v: string | null) => { if (!done) { done = true; zip.close(); resolve(v); } };
      zip.on('entry', async (entry: any) => {
        try {
          if (ext === '.docx' && entry.fileName === 'word/document.xml') {
            zip.openReadStream(entry, (_: any, s: any) => {
              const chunks: Buffer[] = [];
              s.on('data', (c: Buffer) => chunks.push(c));
              s.on('end', () => finish(Buffer.concat(chunks).toString('utf8')));
            });
            return;
          }
          if (ext === '.pptx' && /^ppt\/slides\/slide\d+\.xml$/i.test(entry.fileName)) {
            zip.openReadStream(entry, (_: any, s: any) => {
              const chunks: Buffer[] = [];
              s.on('data', (c: Buffer) => chunks.push(c));
              s.on('end', () => { slides.push({ name: entry.fileName, text: Buffer.concat(chunks).toString('utf8') }); zip.readEntry(); });
            });
            return;
          }
          zip.readEntry();
        } catch { finish(null); }
      });
      zip.on('end', () => {
        if (ext === '.pptx' && slides.length) {
          slides.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
          finish(slides.map(s => s.text).join('\n'));
        } else finish(null);
      });
      zip.on('error', () => finish(null));
      zip.readEntry();
    });
  });
}

const STREAM_EXTS = new Set(['.mp4','.mp3','.wav','.ogg','.webm','.mkv','.avi','.mov','.flac','.aac','.m4a']);

export async function getPreviewData(filePath: string): Promise<PreviewResponse> {
  const ext = path.extname(filePath).toLowerCase();
  try {
    const stat = fs.statSync(filePath);
    const readSize = Math.min(stat.size, MAX_TEXT);
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, 0);
    fs.closeSync(fd);

    if (TEXT_EXTS.has(ext) || (!BINARY_EXTS.has(ext) && !STREAM_EXTS.has(ext) && isProbablyText(buf))) {
      return { success: true, data: decodeText(buf), ext, contentEncoding: 'utf8', truncated: stat.size > MAX_TEXT };
    }

    if (ext === '.docx' || ext === '.pptx') {
      const xml = await extractOpenXml(filePath, ext);
      if (xml) return { success: true, data: stripXml(xml), ext, contentEncoding: 'utf8' };
    }

    if (STREAM_EXTS.has(ext)) {
      return { success: true, data: '', ext, contentEncoding: 'utf8', streamUrl: `/api/file-stream?path=${encodeURIComponent(filePath)}` };
    }

    if (BINARY_EXTS.has(ext)) {
      if (stat.size > MAX_BIN) return { success: false, error: `File too large (${Math.round(stat.size/1024/1024)} MB)`, ext };
      const data = fs.readFileSync(filePath);
      if (ext === '.svg') return { success: true, data: data.toString('utf8'), ext, contentEncoding: 'utf8' };
      return { success: true, data: data.toString('base64'), ext, contentEncoding: 'base64' };
    }

    return { success: false, error: 'Preview not supported', ext };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function getFileInfo(filePath: string) {
  try {
    const s = await fs.promises.stat(filePath);
    return { size: s.size, created: s.birthtimeMs, modified: s.mtimeMs, accessed: s.atimeMs, isDirectory: s.isDirectory(), extension: path.extname(filePath).toLowerCase() };
  } catch { return null; }
}
