import { cloneDocument } from '../document/model'
import type { AtmpsDocument } from '@shared/types'

/** Asset bytes changed by a commit — used so brush/eraser strokes are undoable. */
export interface AssetByteDelta {
  assetId: string
  /** Bytes before the commit (null if asset was created by this commit). */
  before: Uint8Array | null
  /** Bytes after the commit (null if asset was removed). */
  after: Uint8Array | null
}

export interface HistorySnapshot {
  document: AtmpsDocument
  label: string
  assets?: AssetByteDelta[]
}

export interface CommitOptions {
  assets?: AssetByteDelta[]
}

/**
 * Snapshot-based undo/redo. Commits are explicit (not per pointer move).
 * Optional asset deltas let raster strokes undo without relying on document JSON alone.
 */
export class HistoryStack {
  private past: HistorySnapshot[] = []
  private future: HistorySnapshot[] = []
  private current: AtmpsDocument
  private readonly limit: number

  constructor(initial: AtmpsDocument, limit = 50) {
    this.current = cloneDocument(initial)
    this.limit = limit
  }

  get document(): AtmpsDocument {
    return this.current
  }

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }

  get undoLabel(): string | null {
    return this.past[this.past.length - 1]?.label ?? null
  }

  get redoLabel(): string | null {
    return this.future[this.future.length - 1]?.label ?? null
  }

  /** Labels for History panel: oldest → newest past, then current, then redo future. */
  getHistoryLabels(): { past: string[]; current: string; future: string[] } {
    return {
      past: this.past.map((s) => s.label),
      current: 'Current state',
      future: [...this.future].reverse().map((s) => s.label)
    }
  }

  /** Replace current without recording history (e.g. open project). */
  replace(doc: AtmpsDocument): AtmpsDocument {
    this.current = cloneDocument(doc)
    this.past = []
    this.future = []
    return this.current
  }

  /**
   * Apply a mutator and push previous state onto the undo stack.
   * Call this after pointer-up / discrete edits — not during drag frames.
   * Pass `assets` for raster stroke commits where document JSON may be unchanged.
   */
  commit(
    label: string,
    mutator: (doc: AtmpsDocument) => AtmpsDocument,
    options?: CommitOptions
  ): AtmpsDocument {
    const before = cloneDocument(this.current)
    const next = mutator(before)
    const assets = cloneAssetDeltas(options?.assets)
    const docChanged = !documentsEqual(before, next)
    const assetsChanged = Boolean(assets && assets.length > 0)
    if (!docChanged && !assetsChanged) {
      return this.current
    }
    this.past.push({ document: before, label, assets })
    if (this.past.length > this.limit) {
      this.past.shift()
    }
    this.future = []
    this.current = cloneDocument(next)
    return this.current
  }

  /** Live preview without history (e.g. temporary transform during drag). */
  preview(mutator: (doc: AtmpsDocument) => AtmpsDocument): AtmpsDocument {
    this.current = cloneDocument(mutator(this.current))
    return this.current
  }

  /**
   * Undo one step. Returns the snapshot that was undone (with asset deltas)
   * so the session can restore previous asset bytes.
   */
  undo(): HistorySnapshot | null {
    const snap = this.past.pop()
    if (!snap) return null
    this.future.push({
      document: cloneDocument(this.current),
      label: snap.label,
      assets: cloneAssetDeltas(snap.assets)
    })
    this.current = cloneDocument(snap.document)
    return snap
  }

  /**
   * Redo one step. Returns the future snapshot applied (after-state document + deltas).
   */
  redo(): HistorySnapshot | null {
    const snap = this.future.pop()
    if (!snap) return null
    this.past.push({
      document: cloneDocument(this.current),
      label: snap.label,
      assets: cloneAssetDeltas(snap.assets)
    })
    this.current = cloneDocument(snap.document)
    return snap
  }
}

function documentsEqual(a: AtmpsDocument, b: AtmpsDocument): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function cloneAssetDeltas(assets?: AssetByteDelta[]): AssetByteDelta[] | undefined {
  if (!assets?.length) return undefined
  return assets.map((a) => ({
    assetId: a.assetId,
    before: a.before ? new Uint8Array(a.before) : null,
    after: a.after ? new Uint8Array(a.after) : null
  }))
}
