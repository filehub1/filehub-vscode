import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { URL } from 'url';
import os from 'os';
import { FileIndexService, AppConfig } from './indexer';
import { getPreviewData, getFileInfo } from './preview';

const platform = os.platform();

const TEXT_EXTS = new Set([
  '.txt','.md','.mdx','.json','.jsonc','.js','.mjs','.cjs','.ts','.tsx','.jsx',
  '.css','.scss','.less','.html','.htm','.xml','.yml','.yaml','.toml','.ini',
  '.cfg','.conf','.env','.sh','.bash','.bat','.cmd','.ps1','.py','.java','.c',
  '.cpp','.h','.cs','.go','.rs','.rb','.php','.swift','.kt','.sql','.csv',
  '.vue','.svelte','.lock','.log','.rst','.graphql','.proto'
]);

function isTextFile(filePath: string): boolean {
  return TEXT_EXTS.has(path.extname(filePath).toLowerCase());
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
  res.end(data);
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { resolve({}); } });
  });
}

function getLanIp(): string {
  try {
    for (const ifaces of Object.values(os.networkInterfaces()) as any[]) {
      for (const a of ifaces) {
        if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) return a.address;
      }
    }
  } catch {}
  return 'unknown';
}

function openFile(p: string) {
  try {
    if (platform === 'win32') spawn('cmd.exe', ['/c', 'start', '', p], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    else if (platform === 'darwin') spawn('open', [p], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [p], { detached: true, stdio: 'ignore' }).unref();
    return true;
  } catch { return false; }
}

function openExplorer(p: string) {
  try {
    if (platform === 'win32') spawn('explorer.exe', [`/select,${p}`], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    else if (platform === 'darwin') spawn('open', ['-R', p], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [path.dirname(p)], { detached: true, stdio: 'ignore' }).unref();
    return true;
  } catch { return false; }
}

function openTerminal(dir: string) {
  try {
    if (platform === 'win32') spawn('cmd.exe', ['/c', 'start', 'cmd', '/k', `cd /d "${dir}"`], { detached: true, stdio: 'ignore', windowsHide: true, shell: true }).unref();
    else if (platform === 'darwin') spawn('osascript', ['-e', `tell app "Terminal" to do script "cd '${dir}'"`], { detached: true, stdio: 'ignore' }).unref();
    else spawn('x-terminal-emulator', ['-e', `cd "${dir}" && $SHELL`], { detached: true, stdio: 'ignore' }).unref();
    return true;
  } catch { return false; }
}

export class FilehubServer {
  private server: http.Server;
  private indexService: FileIndexService;
  private wwwroot: string;
  public port = 0;
  public lanPort = 0;
  public lanEnabled = false;
  private lanProxy?: import('net').Server;
  public openInEditor?: (filePath: string) => void;
  public onConfigSaved?: (cfg: AppConfig) => void;

  constructor(wwwroot: string, config: AppConfig) {
    this.wwwroot = wwwroot;
    this.indexService = new FileIndexService(config);
    this.indexService.on('index-complete', (data: any) => {
      this.onIndexComplete?.(data.fileCount, data.elapsed, data.engine);
    });
    this.server = http.createServer((req, res) => this.handle(req, res));
  }

  async start(): Promise<number> {
    await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve));
    this.port = (this.server.address() as any).port;
    this.indexService.rebuildIndex().catch(() => {});
    return this.port;
  }

  public onIndexComplete?: (fileCount: number, elapsed: number, engine?: string) => void;

  enableLan() {
    if (this.lanProxy) return;
    const net = require('net');
    this.lanProxy = net.createServer((client: import('net').Socket) => {
      const local = net.createConnection(this.port, '127.0.0.1');
      client.pipe(local);
      local.pipe(client);
      client.on('error', () => local.destroy());
      local.on('error', () => client.destroy());
    });
    this.lanProxy!.listen(0, '0.0.0.0', () => {
      this.lanPort = (this.lanProxy!.address() as any).port;
      this.lanEnabled = true;
    });
  }

  disableLan() {
    this.lanProxy?.close();
    this.lanProxy = undefined;
    this.lanEnabled = false;
    this.lanPort = 0;
  }

  updateConfig(config: AppConfig) {
    this.indexService.updateConfig(config);
  }

  rebuildIndex(dirs?: string[]) {
    return this.indexService.rebuildIndex(dirs);
  }

  dispose() {
    this.disableLan();
    this.server.close();
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    if (req.method === 'OPTIONS') { sendJson(res, 204, {}); return; }
    const url = new URL(req.url || '/', `http://127.0.0.1:${this.port}`);
    const p = url.pathname;

    try {
      if (p === '/api/health') return sendJson(res, 200, { ok: true });
      if (p === '/api/status') return sendJson(res, 200, this.indexService.getStatus());

      if (p === '/api/search') {
        const q = url.searchParams.get('query') || '';
        const max = Number(url.searchParams.get('maxResults') || '500');
        const type = url.searchParams.get('searchType') || 'string';
        const inPath = url.searchParams.get('searchInPath') === 'true';
        return sendJson(res, 200, this.indexService.search(q, max, type, inPath));
      }

      if (p === '/api/config' && req.method === 'GET') {
        const cfg = this.indexService.getConfig();
        const st = this.indexService.getStatus();
        return sendJson(res, 200, {
          indexedDirectories: cfg.indexedDirectories,
          excludePatterns: cfg.excludePatterns,
          fileCount: st.fileCount,
          status: st.status,
          lanEnabled: this.lanEnabled,
          lanUser: '',
          theme: 'dark'
        });
      }

      if (p === '/api/config' && req.method === 'POST') {
        const body = await readBody(req);
        const cfg: AppConfig = {
          indexedDirectories: Array.isArray(body.indexedDirectories) ? body.indexedDirectories : this.indexService.getConfig().indexedDirectories,
          excludePatterns: Array.isArray(body.excludePatterns) ? body.excludePatterns : this.indexService.getConfig().excludePatterns
        };
        if (typeof body.lanEnabled === 'boolean') {
          body.lanEnabled ? this.enableLan() : this.disableLan();
        }
        this.indexService.updateConfig(cfg);
        this.onConfigSaved?.(cfg);
        this.indexService.rebuildIndex().catch(() => {});
        return sendJson(res, 200, { success: true, config: cfg, indexing: true });
      }

      if (p === '/api/rebuild') {
        const body = req.method === 'POST' ? await readBody(req) : {};
        this.indexService.rebuildIndex(body.directories).catch(() => {});
        return sendJson(res, 200, { ok: true, indexing: true });
      }

      if (p === '/api/preview') {
        const fp = url.searchParams.get('path');
        if (!fp) return sendJson(res, 400, { success: false, error: 'Missing path' });
        return sendJson(res, 200, await getPreviewData(fp));
      }

      if (p === '/api/file-info') {
        const fp = url.searchParams.get('path');
        if (!fp) return sendJson(res, 400, { error: 'Missing path' });
        return sendJson(res, 200, await getFileInfo(fp));
      }

      if (p === '/api/file-stream') {
        const fp = url.searchParams.get('path');
        if (!fp || !fs.existsSync(fp)) { res.writeHead(404); res.end(); return; }
        const ext = path.extname(fp).toLowerCase();
        const mime: Record<string, string> = { '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.mov': 'video/quicktime', '.flac': 'audio/flac', '.aac': 'audio/aac', '.m4a': 'audio/mp4', '.pdf': 'application/pdf' };
        res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream', 'Content-Length': fs.statSync(fp).size, 'Access-Control-Allow-Origin': '*' });
        fs.createReadStream(fp).pipe(res);
        return;
      }

      if (p === '/api/open-file' && req.method === 'POST') {
        const host = req.headers.host || '';
        const isLanRequest = this.lanEnabled && host.includes(':' + this.lanPort);
        const body = await readBody(req);
        const fp: string = body.path;
        if (isLanRequest) {
          return sendJson(res, 200, { success: true, streamUrl: `/api/file-stream?path=${encodeURIComponent(fp)}` });
        }
        if (this.openInEditor && fp && isTextFile(fp)) {
          this.openInEditor(fp);
          return sendJson(res, 200, { success: true });
        }
        if (!fp) return sendJson(res, 400, { success: false, error: 'Missing path' });
        return sendJson(res, 200, { success: openFile(fp) });
      }
      if (p === '/api/open-in-explorer' && req.method === 'POST') {
        const host = req.headers.host || '';
        const isLanRequest = this.lanEnabled && host.includes(':' + this.lanPort);
        if (isLanRequest) return sendJson(res, 403, { success: false });
        const body = await readBody(req);
        if (!body.path) return sendJson(res, 400, { success: false, error: 'Missing path' });
        return sendJson(res, 200, { success: openExplorer(body.path) });
      }
      if (p === '/api/open-terminal' && req.method === 'POST') {
        const host = req.headers.host || '';
        const isLanRequest = this.lanEnabled && host.includes(':' + this.lanPort);
        if (isLanRequest) return sendJson(res, 403, { success: false });
        const body = await readBody(req);
        const target = body.workDir || body.path;
        if (!target) return sendJson(res, 400, { success: false, error: 'Missing path' });
        const dir = target && fs.existsSync(target) && fs.statSync(target).isDirectory() ? target : (target ? path.dirname(target) : '');
        return sendJson(res, 200, { success: dir ? openTerminal(dir) : false });
      }

      if (p === '/api/lan-info') {
        return sendJson(res, 200, { ip: getLanIp(), port: this.lanEnabled ? this.lanPort : this.port, lanEnabled: this.lanEnabled });
      }

      if (p === '/api/volumes') {
        const vols: string[] = [];
        if (platform === 'win32') {
          for (const d of fs.readdirSync('')) { try { if (fs.statSync(d + '\\').isDirectory()) vols.push(d); } catch {} }
        }
        return sendJson(res, 200, vols.length ? vols : ['C', 'D']);
      }

      if (p === '/api/select-directory') {
        return sendJson(res, 200, { path: null });
      }

      // Static files
      const staticPath = p === '/' ? '/index.html' : p;
      const filePath = path.join(this.wwwroot, staticPath.replace(/\//g, path.sep));
      const ext = path.extname(filePath).toLowerCase();
      const mimeMap: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        res.writeHead(200, { 'Content-Type': mimeMap[ext] || 'application/octet-stream' });
        res.end(fs.readFileSync(filePath));
        return;
      }
      // SPA fallback
      const index = path.join(this.wwwroot, 'index.html');
      if (fs.existsSync(index)) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(index)); return; }
      sendJson(res, 404, { error: 'Not found' });
    } catch (e: any) {
      sendJson(res, 500, { error: e.message });
    }
  }
}
