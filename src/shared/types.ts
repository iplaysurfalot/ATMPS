/** Shared types between main and renderer. Document model is source of truth. */

export type ToolId =
  | 'select'
  | 'pan'
  | 'brush'
  | 'eraser'
  | 'text'
  | 'rect'
  | 'ellipse'

export type LayerKind = 'image' | 'shape' | 'text' | 'raster'

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
