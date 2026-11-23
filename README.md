# ATMPS

Local-first desktop image editor built with **Electron**, **React**, **TypeScript**, **Vite**, and **Fabric.js**.

Offline by design: no accounts, no cloud sync. The UI follows a Photoshop-style desktop workflow (menu bar, tool rail, options bar, layers/properties panels, document tabs, status bar). Documents use a normalized model as the source of truth; Fabric is a rendering/view layer. Original imported assets are stored without destructive recompression inside `.atmps` project packages.

## Requirements (Windows)

- Node.js 20+ (tested with Node 24)
- npm 10+
- Windows 10/11

## Setup

```powershell
cd C:\Users\BM\source\repos\ATMPS
npm.cmd install
```

> PowerShell tip: if `npm` fails or hangs as a script, use `npm.cmd` (e.g. `npm.cmd install`, `npm.cmd run dist`).

## Development

```powershell
npm.cmd run dev
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
| Deselect | `Ctrl+D` |
| Select All | `Ctrl+A` |
| Toggle rulers | `Ctrl+R` |
| Zoom in / out | `Ctrl+=` / `Ctrl+-` |
| Fit on screen | `Ctrl+0` |
| Actual pixels (100%) | `Ctrl+1` |
| Zoom toward cursor | `Ctrl+scroll` |
| Temporary Hand | Hold `Space` |
| Tools | `V` Move, `M` Marquee, `B` Brush, `E` Eraser, `T` Type, `U` Rectangle, `O` Ellipse, `H` Hand, `Z` Zoom |

## Tests

```powershell
npm.cmd test
```

Covers document model, undo/redo history, and `.atmps` project pack/unpack (including original asset byte preservation).

## Production build

```powershell
npm.cmd run build
```

Outputs Electron main/preload/renderer bundles under `out/`.

### Packaged Windows app (release)

Build an NSIS installer and a portable `.exe` into `dist/`:

```powershell
npm.cmd run dist
```

Unpackaged app directory only (faster smoke check):

```powershell
npm.cmd run pack
```

**Run the built app:** double-click `dist\ATMPS-0.1.0-portable.exe`, or install via `dist\ATMPS-0.1.0-win-x64.exe`, or launch `dist\win-unpacked\ATMPS.exe` after `pack`/`dist`.

Builds are unsigned (`signAndEditExecutable` is off so packaging works without Windows symlink privileges). Windows SmartScreen may warn on first launch — choose “More info” → “Run anyway” when testing locally.

Typecheck:

```powershell
npm.cmd run typecheck
```

## Architecture

| Area | Location |
|------|----------|
| Normalized document model | `src/core/document/` |
| Undo/redo history | `src/core/history/` |
| Project pack/unpack (ZIP `.atmps`) | `src/core/file/` |
| Multi-document editor session | `src/core/editor/` |
| Fabric render bridge | `src/core/rendering/` |
| Secure FS/IPC | `electron/main/`, `electron/preload/` |
| Photoshop-like UI shell | `src/renderer/` |

Pointer-move transforms update Fabric objects directly and only commit into the document/history on mouse-up, keeping React out of the hot path.

## Project format

`.atmps` is a ZIP containing:

- `manifest.json`
- `document.json` — normalized layers/transforms/properties (incl. blend modes)
- `assets.json` — asset metadata
- `assets/<id>.(png|jpg|webp)` — **original** imported bytes

## Core workflow

1. Create document (presets / custom size / transparent or solid background)
2. Import PNG/JPG/WebP as layers (originals preserved)
3. Transform layers (move/resize/rotate) with PS-like handles
4. Edit layers (add/remove/duplicate/rename/drag-reorder/hide/lock/opacity/blend)
5. Text, shapes, brush, eraser (eraser punches real transparency on raster)
6. Marquee selection, zoom/pan, rulers, multi-document tabs
7. Save/reopen `.atmps`
8. Export flattened PNG/JPG

## Still short of Photoshop

ATMPS aims for familiar **look and core desktop workflow**, not feature parity. Missing or partial vs Photoshop: advanced selection (lasso/magic wand), layer masks/groups/effects, adjustment layers, filters, pen/path tools, smart objects, CMYK/16-bit, full blend-mode set (only Normal/Multiply/Screen are live), pressure-sensitive brushes, history panel UI, and non-destructive type/shape editing after rasterize.
