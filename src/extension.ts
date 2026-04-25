import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { FilehubServer } from './server';
import { AppConfig } from './indexer';

let server: FilehubServer | undefined;
let panel: vscode.WebviewPanel | undefined;
let outputChannel: vscode.OutputChannel;

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  outputChannel.appendLine(line);
  console.log(line);
}

const DEFAULT_EXCLUDE = ['node_modules', '.git', 'dist', 'build', '.cache', '*.log'];

function getConfig(): AppConfig {
  const cfg = vscode.workspace.getConfiguration('filehub');
  const rawDirs: string[] = cfg.get('indexedDirectories') ?? [];
  const dirs = rawDirs.filter((d: string) => d && d.trim());
  const excludePatterns: string[] = (cfg.get<string[]>('excludePatterns') ?? []).length > 0
    ? cfg.get<string[]>('excludePatterns')!
    : DEFAULT_EXCLUDE;
  const indexEngine = cfg.get<'auto' | 'win-api' | 'nodejs'>('indexEngine') ?? 'auto';
  if (dirs.length === 0 && vscode.workspace.workspaceFolders) {
    const validFolders = vscode.workspace.workspaceFolders
      .map(f => f.uri.fsPath)
      .filter((p): p is string => !!p && !!p.trim());
    dirs.push(...validFolders);
  }
  return { indexedDirectories: dirs, excludePatterns, indexEngine };
}

function getWwwroot(context: vscode.ExtensionContext): string {
  // Use built frontend from filehub-server dist
  const candidates = [
    path.join(context.extensionPath, 'dist', 'renderer'),
    path.join(context.extensionPath, '..', 'filehub-server', 'dist', 'renderer'),
    path.join(os.homedir(), 'ai', 'exiahuang', 'filehub1', 'filehub-server', 'dist', 'renderer'),
  ];
  log('candidates: ' + JSON.stringify(candidates));
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'index.html'))) {
      log('found wwwroot: ' + c);
      return c;
    }
  }
  log('no wwwroot found, using: ' + candidates[0]);
  return candidates[0];
}

async function ensureServer(context: vscode.ExtensionContext): Promise<FilehubServer> {
  if (!server) {
    const wwwroot = getWwwroot(context);
    const config = getConfig();
    log('initializing with config: ' + JSON.stringify(config));
    server = new FilehubServer(wwwroot, config);
    server.openInEditor = (filePath: string) => {
      log('openInEditor called with: ' + filePath);
      if (!filePath || !filePath.trim()) return;
      try {
        vscode.window.showTextDocument(vscode.Uri.file(filePath));
      } catch (e) {
        outputChannel.appendLine('showTextDocument error: ' + e);
      }
    };
    server.onConfigSaved = (cfg) => {
      log('config saved: ' + JSON.stringify(cfg));
      log('triggering rebuild index...');
    };
    server.onIndexComplete = (fileCount, elapsed, engine) => {
      log('index rebuild complete: ' + fileCount + ' files in ' + elapsed + 'ms, engine: ' + (engine ?? 'unknown'));
    };
    await server.start();
    context.subscriptions.push({ dispose: () => { server?.dispose(); server = undefined; } });
  }
  return server;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel('FileHub');
  outputChannel.show();
  log('activate starting');
  // console.log('vscode workspace:', vscode.workspace);
  // console.log('vscode workspaceFolders:', vscode.workspace.workspaceFolders);
  try {
    process.env.FILEHUB_EXTENSION_PATH = context.extensionPath;
    context.subscriptions.push(
      vscode.commands.registerCommand('filehub.open', () => openPanel(context)),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('filehub') && server) {
          server.updateConfig(getConfig());
          server.rebuildIndex().catch(() => {});
        }
      })
    );
  } catch (e) {
    log('activate error: ' + e);
    throw e;
  }
}

async function openPanel(context: vscode.ExtensionContext) {
  if (panel) { panel.reveal(); return; }

  const srv = await ensureServer(context);
  const url = `http://127.0.0.1:${srv.port}/`;

  panel = vscode.window.createWebviewPanel(
    'filehub',
    'FileHub',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  panel.webview.html = `<!DOCTYPE html>
<html style="margin:0;padding:0;height:100%;overflow:hidden">
<head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src http://127.0.0.1:*; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
</head>
<body style="margin:0;padding:0;height:100vh;overflow:hidden">
<iframe id="f" src="${url}" style="width:100%;height:100%;border:none;" allow="clipboard-read; clipboard-write"></iframe>
<script>
  const f = document.getElementById('f');
  function focusApp() {
    f.focus();
    f.contentWindow.postMessage({ type: 'filehub-focus' }, '*');
  }
  window.addEventListener('focus', focusApp);
  f.addEventListener('load', () => setTimeout(focusApp, 100));
</script>
</body></html>`;

  panel.onDidDispose(() => { panel = undefined; });
}

export function deactivate() {
  outputChannel?.dispose();
  server?.dispose();
  server = undefined;
}
