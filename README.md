# ATMPS

Local-first desktop image editor built with **Electron**, **React**, **TypeScript**, **Vite**, and **Fabric.js**.

Offline by design: no accounts, no cloud sync. The UI follows a Photoshop-style desktop workflow (menu bar, tool rail, options bar, layers/history/properties panels, document tabs, status bar). Documents use a normalized model as the source of truth; Fabric is a rendering/view layer. Original imported assets are stored without destructive recompression inside `.atmps` project packages.

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
| Undo / Redo | `Ctrl+Z` / `Ctrl+Shift+Z` (or `Ctrl+Y`) |
| Delete selection / layer | `Delete` |
| Deselect | `Ctrl+D` / `Esc` |
| Select All | `Ctrl+A` |
| Brush size down / up | `[` / `]` (Shift for ±20) |
| Toggle rulers | `Ctrl+R` |
| Zoom in / out | `Ctrl+=` / `Ctrl+-` |
| Fit on screen | `Ctrl+0` |
| Actual pixels (100%) | `Ctrl+1` |
| Zoom toward cursor | `Ctrl+scroll` |
| Temporary Hand | Hold `Space` |
| Apply crop | `Enter` (while Crop tool + crop box) |
| Tools | `V` Move, `M` Marquee, `L` Lasso, `Shift+L` Poly Lasso, `C` Crop, `B` Brush, `E` Eraser, `S` Clone, `I` Eyedropper, `G` Bucket, `Shift+G` Gradient, `T` Type, `U` Rect, `O` Ellipse, `H` Hand, `Z` Zoom |

## Tests

```powershell
npm.cmd test
```

Covers document model, undo/redo history (including asset-only brush commits), and `.atmps` project pack/unpack (including original asset byte preservation).

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
| Raster pixel ops | `src/core/rendering/raster-ops.ts` |
| Secure FS/IPC | `electron/main/`, `electron/preload/` |
| Photoshop-like UI shell | `src/renderer/` |

Pointer-move transforms and brush paths update Fabric objects directly and only commit into the document/history on mouse-up (or path end), keeping React out of the hot path and avoiding canvas flicker.

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
5. Paint: brush / eraser / clone (Alt+click source) with size/hardness/opacity/flow; brush outline follows cursor
6. Fill: paint bucket + linear gradient; sample with eyedropper
7. Select: marquee / lasso / polygonal lasso (marching ants); Delete clears pixels to transparency; Move can drag selection contents
8. Crop tool + Enter/Apply
9. Text & shapes (rasterize when painting)
10. History panel (per-stroke / per-op undo steps)
11. Save/reopen `.atmps`; export flattened PNG/JPG
12. Multi-document tabs

## Still short of Photoshop

Missing or partial vs Photoshop: layer masks/groups/effects/smart objects, adjustment layers, filters, pen/path tools, magic wand, pressure-sensitive brushes, CMYK/16-bit, full blend-mode fidelity beyond Canvas2D composites, non-destructive type/shape after rasterize, clone is dab-based (not continuous stroke stamp), no content-aware fill.
