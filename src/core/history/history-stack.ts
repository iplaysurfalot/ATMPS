import { cloneDocument } from '../document/model'
import type { AtmpsDocument } from '@shared/types'

export interface HistorySnapshot {
  document: AtmpsDocument
  label: string
}

/**
 * Snapshot-based undo/redo. Commits are explicit (not per pointer move).
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
   */
  commit(label: string, mutator: (doc: AtmpsDocument) => AtmpsDocument): AtmpsDocument {
    const before = cloneDocument(this.current)
    const next = mutator(before)
    if (documentsEqual(before, next)) {
      return this.current
    }
    this.past.push({ document: before, label })
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

  undo(): AtmpsDocument {
    const snap = this.past.pop()
    if (!snap) return this.current
    this.future.push({ document: cloneDocument(this.current), label: snap.label })
    this.current = cloneDocument(snap.document)
    return this.current
  }

  redo(): AtmpsDocument {
    const snap = this.future.pop()
    if (!snap) return this.current
    this.past.push({ document: cloneDocument(this.current), label: snap.label })
    this.current = cloneDocument(snap.document)
    return this.current
  }
}

function documentsEqual(a: AtmpsDocument, b: AtmpsDocument): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
