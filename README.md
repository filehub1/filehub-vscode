# FileHub for VSCode

Instant file search and preview inside VSCode. Powered by the same frontend as [filehub-server](https://filehub1.github.io/).

## Features

- **Instant file search** — String, Fuzzy, and Regex modes
- **File preview** — PDF, images, video, audio, Office documents, Markdown, code with syntax highlighting
- **Open in editor** — Text files open directly in VSCode (`l` key)
- **LAN access** — Share your file index with other devices on the same network
- **Keyboard-driven** — Full vim-style navigation

## Requirements

- VSCode 1.85+
- Node.js 18+

## Installation

### From VSIX

```bash
npx vsce package
code --install-extension filehub-vscode-*.vsix
```

### Development

```bash
# 1. Build the frontend
cd ../filehub-server
npm install && npm run build

# 2. Copy frontend to media/
cd ../filehub-vscode
xcopy ..\filehub-server\dist\renderer media /E /I /Y   # Windows
# cp -r ../filehub-server/dist/renderer media           # macOS/Linux

# 3. Build the extension
npm install && npm run build

# 4. Press F5 in VSCode to launch Extension Development Host
```

## Usage

- Press `Ctrl+Shift+F` (`Cmd+Shift+F` on Mac) to open FileHub
- Or run command: `FileHub: Open`

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `/` | Focus search |
| `j` / `↓` | Move down |
| `k` / `↑` | Move up |
| `l` / `Enter` | Open file (text → VSCode editor, others → system default) |
| `o` | Toggle preview |
| `f` | Focus filter (text/code preview) |
| `O` | Open in explorer |
| `!` | Open terminal at file location |
| `\` | Toggle search type |
| `r` | Rebuild index |
| `s` | Settings |
| `?` | Help |
| `q` / `Esc` | Close |

## Configuration

Settings are available via `File > Preferences > Settings` → search `filehub`, or in `.vscode/settings.json`:

```json
{
  "filehub.indexedDirectories": ["C:\\Users\\you\\Documents"],
  "filehub.excludePatterns": ["node_modules", ".git", "dist", "*.log"]
}
```

If `indexedDirectories` is empty, defaults to the current workspace folders.

## LAN Access

Enable **LAN Access** in Settings to share your file index with other devices on the same network. The LAN URL is shown in the Settings panel.

- LAN clients can browse and preview files
- Double-clicking a file on a LAN client opens/downloads it in the client's browser
- Enable **"Allow remote double-click to open files"** to allow LAN clients to trigger file opens

## License

MIT

## Author

- [exiahuang](https://github.com/exiahuang/)
- [filehub1](https://filehub1.github.io/)
- [filehub1 repo](https://github.com/orgs/filehub1/repositories/)
