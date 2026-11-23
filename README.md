# ATMPS

Local-first desktop image editor built with **Electron**, **React**, **TypeScript**, **Vite**, and **Fabric.js**.

Offline by design: no accounts, no cloud sync. Documents use a normalized model as the source of truth; Fabric is a rendering/view layer. Original imported assets are stored without destructive recompression inside `.atmps` project packages.

## Requirements (Windows)

- Node.js 20+ (tested with Node 24)
- npm 10+
- Windows 10/11

## Setup

```powershell
cd C:\Users\BM\source\repos\ATMPS
npm install
```

## Development

```powershell
npm run dev
```

This starts Vite + Electron. The app window opens automatically.

### Shortcuts

| Action | Shortcut |
|--------|----------|
| New document | `Ctrl+N` |
| Open project | `Ctrl+O` |
| Save | `Ctrl+S` |
| Save As | `Ctrl+Shift+S` |
| Undo / Redo | `Ctrl+Z` / `Ctrl+Y` or `Ctrl+Shift+Z` |
| Zoom | `Ctrl+=` / `Ctrl+-` / `Ctrl+0` |
| Tools | `V` select, `H` pan, `B` brush, `E` eraser, `T` text, `R` rect, `O` ellipse |
| Temporary pan | Hold `Space` |

## Tests

```powershell
npm test
```

Covers document model, undo/redo history, and `.atmps` project pack/unpack (including original asset byte preservation).

## Production build

```powershell
npm run build
```

Outputs Electron main/preload/renderer bundles under `out/`.

Typecheck:

```powershell
npm run typecheck
```

## Architecture (M1)

| Area | Location |
|------|----------|
| Normalized document model | `src/core/document/` |
| Undo/redo history | `src/core/history/` |
| Project pack/unpack (ZIP `.atmps`) | `src/core/file/` |
| Editor session (assets + dirty state) | `src/core/editor/` |
| Fabric render bridge | `src/core/rendering/` |
| Secure FS/IPC | `electron/main/`, `electron/preload/` |
| UI shell | `src/renderer/` |

Pointer-move transforms update Fabric objects directly and only commit into the document/history on mouse-up, keeping React out of the hot path.

## Project format

`.atmps` is a ZIP containing:

- `manifest.json`
- `document.json` — normalized layers/transforms/properties
- `assets.json` — asset metadata
- `assets/<id>.(png|jpg|webp)` — **original** imported bytes

## Vertical slice

1. Create document (configurable size)
2. Import PNG/JPG/WebP
3. Transform layers (move/resize/rotate)
4. Edit layers (add/remove/duplicate/rename/reorder/hide)
5. Text, shapes, brush, eraser
6. Zoom/pan, undo/redo
7. Save/reopen `.atmps`
8. Export flattened PNG/JPG
