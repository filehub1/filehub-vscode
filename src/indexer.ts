import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs/promises';
import { nativeEnumerate } from './native-indexer';

interface FileEntry {
  name: string;
  path: string;
  nameLower: string;
  size: number;
  modified: number;
  isDirectory: boolean;
}

export interface SearchResult {
  name: string;
  path: string;
  size: number;
  modified: number;
  isDirectory: boolean;
}

export interface IndexStatus {
  status: 'idle' | 'indexing' | 'not_initialized';
  fileCount: number;
  indexedDirectories: string[];
}

export interface AppConfig {
  indexedDirectories: string[];
  excludePatterns: string[];
}

export class FileIndexService extends EventEmitter {
  private files: FileEntry[] = [];
  private isIndexing = false;
  private config: AppConfig;
  private excludeMatchers: RegExp[] = [];

  constructor(config: AppConfig) {
    super();
    this.config = config;
    this.excludeMatchers = config.excludePatterns.map(p => this.toRegex(p));
  }

  updateConfig(config: AppConfig) {
    this.config = config;
    this.excludeMatchers = config.excludePatterns.map(p => this.toRegex(p));
  }

  private toRegex(pattern: string): RegExp {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`, 'i');
  }

  private shouldExclude(name: string): boolean {
    if (name.startsWith('.')) return true;
    return this.excludeMatchers.some(r => r.test(name));
  }

  async rebuildIndex(directories?: string[]): Promise<IndexStatus> {
    if (this.isIndexing) return this.getStatus();
    const dirs = directories ?? this.config.indexedDirectories;
    if (directories) this.config.indexedDirectories = dirs;

    // Remove subdirectories already covered by a parent
    const normalized = dirs.map(d => d.replace(/[\\/]+$/, '') + path.sep);
    const topDirs = dirs.filter((_, i) =>
      !normalized.some((n, j) => j !== i && normalized[i].startsWith(n))
    );

    this.isIndexing = true;
    const newFiles: FileEntry[] = [];
    try {
      // Try native fast enumeration first, fallback to TS walk
      let usedNative = false;
      try {
        const entries = await nativeEnumerate(topDirs, this.config.excludePatterns);
        for (const e of entries) {
          newFiles.push({ name: e.name, path: e.path, nameLower: e.name.toLowerCase(), size: e.size, modified: e.modified, isDirectory: e.isDirectory });
        }
        usedNative = true;
      } catch { /* fallback */ }

      if (!usedNative) {
        for (const dir of topDirs) await this.walk(dir, newFiles);
      }
      this.files = newFiles;
      this.isIndexing = false;
      this.emit('index-complete', { fileCount: this.files.length });
      return { status: 'idle', fileCount: this.files.length, indexedDirectories: dirs };
    } catch (e) {
      this.isIndexing = false;
      throw e;
    }
  }

  private async walk(dir: string, out: FileEntry[]): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (this.shouldExclude(e.name)) continue;
        const full = path.join(dir, e.name);
        try {
          const st = await fs.stat(full);
          out.push({ name: e.name, path: full, nameLower: e.name.toLowerCase(), size: st.size, modified: st.mtimeMs, isDirectory: e.isDirectory() });
          if (e.isDirectory()) await this.walk(full, out);
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  search(query: string, maxResults = 500, searchType = 'string', searchInPath = false): SearchResult[] {
    if (!query.trim()) return [];
    const q = query.trim();

    let matched: FileEntry[];
    if (searchType === 'regex') {
      try {
        const re = new RegExp(q, 'i');
        matched = this.files.filter(f => re.test(searchInPath ? f.path : f.name));
      } catch { return []; }
    } else if (searchType === 'fuzzy') {
      const ql = q.toLowerCase();
      matched = this.files.filter(f => this.fuzzy(searchInPath ? f.path.toLowerCase() : f.nameLower, ql));
    } else {
      const parts = q.toLowerCase().split(/\s+/);
      matched = this.files.filter(f => {
        const t = searchInPath ? f.path.toLowerCase() : f.nameLower;
        return parts.every(p => t.includes(p));
      });
      const ql = q.toLowerCase();
      matched.sort((a, b) => {
        const as = a.nameLower.startsWith(ql) ? 0 : 1;
        const bs = b.nameLower.startsWith(ql) ? 0 : 1;
        if (as !== bs) return as - bs;
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.nameLower.length - b.nameLower.length;
      });
    }

    return matched.slice(0, maxResults).map(f => ({ name: f.name, path: f.path, size: f.size, modified: f.modified, isDirectory: f.isDirectory }));
  }

  private fuzzy(text: string, pattern: string): boolean {
    let pi = 0;
    for (const c of text) { if (c === pattern[pi]) pi++; }
    return pi === pattern.length;
  }

  getStatus(): IndexStatus {
    return { status: this.isIndexing ? 'indexing' : 'idle', fileCount: this.files.length, indexedDirectories: this.config.indexedDirectories };
  }

  getConfig(): AppConfig {
    return this.config;
  }
}
