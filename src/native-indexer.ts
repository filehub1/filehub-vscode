import path from 'path';
import os from 'os';
import { fdir } from 'fdir';

export interface NativeEntry {
  name: string;
  path: string;
  size: number;
  modified: number;
  isDirectory: boolean;
}

const platform = os.platform();

let _addon: any = undefined;
let _addonLoaded = false;

function getAddon(): any {
  if (_addonLoaded) return _addon;
  _addonLoaded = true;
  if (platform !== 'win32') return null;
  const base = process.env.FILEHUB_EXTENSION_PATH;
  if (!base) return null;
  const candidates = [
    path.join(base, 'addon', 'everything_addon.node'),
  ];
  for (const p of candidates) {
    try {
      _addon = module.require(p);
      return _addon;
    } catch { continue; }
  }
  return null;
}

export async function nativeEnumerate(dirs: string[], excludePatterns: string[]): Promise<NativeEntry[]> {
  const addon = getAddon();
  if (platform === 'win32' && addon?.indexDirectory) {
    return enumerateWithAddon(dirs, excludePatterns);
  }
  return enumerateWithFdir(dirs, excludePatterns);
}

function enumerateWithAddon(dirs: string[], excludePatterns: string[]): Promise<NativeEntry[]> {
  const excludeRegexes = excludePatterns.map(p => {
    const escaped = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`, 'i');
  });

  function shouldExclude(name: string): boolean {
    if (name.startsWith('.')) return true;
    return excludeRegexes.some(r => r.test(name));
  }

  const results: NativeEntry[] = [];
  for (const dir of dirs) {
    try {
      const entries: any[] = addon.indexDirectory(dir);
      for (const e of entries) {
        const name: string = e.name;
        const fullPath: string = e.path;
        if (shouldExclude(name)) continue;
        // addon modified is Windows FILETIME (100ns intervals since 1601-01-01)
        const modifiedMs = e.modified ? Math.round(e.modified / 10000 - 11644473600000) : 0;
        results.push({
          name,
          path: fullPath,
          size: e.size || 0,
          modified: modifiedMs,
          isDirectory: !!e.isDirectory
        });
      }
    } catch { throw new Error('addon failed'); }
  }
  return Promise.resolve(results);
}

async function enumerateWithFdir(dirs: string[], excludePatterns: string[]): Promise<NativeEntry[]> {
  const excludeRegexes = excludePatterns.map(p => {
    const escaped = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`, 'i');
  });

  function shouldExclude(name: string): boolean {
    if (name.startsWith('.')) return true;
    return excludeRegexes.some(r => r.test(name));
  }

  const results: NativeEntry[] = [];
  for (const dir of dirs) {
    const entries = await (new fdir()
      .withFullPaths()
      .withDirs()
      .withStats()
      .exclude((dirName) => shouldExclude(dirName))
      .filter((p) => !shouldExclude(path.basename(p)))
      .crawl(dir)
      .withPromise()) as { path: string; stats: import('fs').Stats }[];

    for (const e of entries) {
      if (e.path === dir || e.path === dir + path.sep) continue;
      results.push({
        name: path.basename(e.path),
        path: e.path,
        size: e.stats.size,
        modified: e.stats.mtimeMs,
        isDirectory: e.stats.isDirectory()
      });
    }
  }
  return results;
}
