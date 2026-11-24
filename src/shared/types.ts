/** Shared types between main and renderer. Document model is source of truth. */

export type ToolId =
  | 'move'
  | 'marquee'
  | 'lasso'
  | 'polylasso'
  | 'crop'
  | 'brush'
  | 'eraser'
  | 'eyedropper'
  | 'bucket'
  | 'gradient'
  | 'clone'
  | 'text'
  | 'rect'
  | 'ellipse'
  | 'hand'
  | 'zoom'

export type LayerKind = 'image' | 'shape' | 'text' | 'raster'

/** Canvas 2D composite ops that map cleanly to Photoshop-like blends. */
export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'

export interface Transform2D {
  x: number
  y: number
  scaleX: number
  scaleY: number
  rotation: number
}

export interface LayerBase {
  id: string
  name: string
  kind: LayerKind
  visible: boolean
  locked: boolean
  opacity: number
  blendMode: BlendMode
  transform: Transform2D
}

export interface ImageLayer extends LayerBase {
  kind: 'image'
  assetId: string
  naturalWidth: number
  naturalHeight: number
}

export interface ShapeLayer extends LayerBase {
  kind: 'shape'
  shape: 'rect' | 'ellipse'
  width: number
  height: number
  fill: string
  stroke: string
  strokeWidth: number
}

export interface TextLayer extends LayerBase {
  kind: 'text'
  text: string
  fontFamily: string
  fontSize: number
  fill: string
  fontWeight: 'normal' | 'bold'
}

/** Raster strokes baked as PNG asset for brush/eraser work. */
export interface RasterLayer extends LayerBase {
  kind: 'raster'
  assetId: string
  width: number
  height: number
}

export type Layer = ImageLayer | ShapeLayer | TextLayer | RasterLayer

export interface AssetRecord {
  id: string
  /** Original filename or generated name */
  name: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  /** Relative path inside project package: assets/<id>.ext */
  relativePath: string
  byteLength: number
}

export interface AtmpsDocument {
  version: 1
  id: string
  name: string
  width: number
  height: number
  background: string
  layers: Layer[]
  activeLayerId: string | null
  createdAt: string
  updatedAt: string
}

export interface ProjectManifest {
  format: 'atmps'
  formatVersion: 1
  documentId: string
  name: string
  savedAt: string
}

export interface ProjectPackage {
  manifest: ProjectManifest
  document: AtmpsDocument
  assets: AssetRecord[]
  /** assetId -> raw bytes (original, not recompressed) */
  assetBytes: Record<string, Uint8Array>
}

export interface OpenDocumentSession {
  document: AtmpsDocument
  assets: AssetRecord[]
  /** assetId -> data URL or file URL for rendering */
  assetUrls: Record<string, string>
  /** Absolute path if saved to disk */
  filePath: string | null
}

export interface CreateDocumentOptions {
  name: string
  width: number
  height: number
  background?: string
}

export interface ExportOptions {
  format: 'png' | 'jpeg'
  quality?: number
}

export interface DocumentTabInfo {
  id: string
  name: string
  dirty: boolean
  width: number
  height: number
  filePath: string | null
}

export interface MarqueeSelection {
  x: number
  y: number
  width: number
  height: number
  /** Lasso polygon in document coords (optional). */
  points?: { x: number; y: number }[]
}

export interface HistoryPanelState {
  past: string[]
  current: string
  future: string[]
}

export interface IpcApi {
  pickOpenImages: () => Promise<string[] | null>
  pickSaveProject: (defaultName: string) => Promise<string | null>
  pickOpenProject: () => Promise<string | null>
  pickExportImage: (format: 'png' | 'jpeg') => Promise<string | null>
  readBinaryFile: (filePath: string) => Promise<Uint8Array>
  writeBinaryFile: (filePath: string, data: Uint8Array) => Promise<void>
  saveProjectPackage: (filePath: string, pkg: SerializedProjectPackage) => Promise<void>
  openProjectPackage: (filePath: string) => Promise<SerializedProjectPackage>
  getPathForFile: (file: File) => string | null
}

/** JSON-safe package over IPC (bytes as base64). */
export interface SerializedProjectPackage {
  manifest: ProjectManifest
  document: AtmpsDocument
  assets: AssetRecord[]
  assetBase64: Record<string, string>
}

export const ATMPS_MIME = 'application/x-atmps'
export const ATMPS_EXTENSION = '.atmps'

export const BLEND_MODES: BlendMode[] = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion'
]

export const BLEND_MODE_LABELS: Record<BlendMode, string> = {
  normal: 'Normal',
  multiply: 'Multiply',
  screen: 'Screen',
  overlay: 'Overlay',
  darken: 'Darken',
  lighten: 'Lighten',
  'color-dodge': 'Color Dodge',
  'color-burn': 'Color Burn',
  'hard-light': 'Hard Light',
  'soft-light': 'Soft Light',
  difference: 'Difference',
  exclusion: 'Exclusion'
}

export const TOOL_TIPS: Record<ToolId, string> = {
  move: 'Move tool (V)',
  marquee: 'Rectangular Marquee (M)',
  lasso: 'Lasso Tool (L)',
  polylasso: 'Polygonal Lasso (Shift+L)',
  crop: 'Crop Tool (C)',
  brush: 'Brush Tool (B)',
  eraser: 'Eraser Tool (E)',
  eyedropper: 'Eyedropper Tool (I)',
  bucket: 'Paint Bucket Tool (G)',
  gradient: 'Gradient Tool (G)',
  clone: 'Clone Stamp Tool (S)',
  text: 'Horizontal Type Tool (T)',
  rect: 'Rectangle Tool (U)',
  ellipse: 'Ellipse Tool (O)',
  hand: 'Hand Tool (H)',
  zoom: 'Zoom Tool (Z)'
}
