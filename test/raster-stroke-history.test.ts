import { describe, expect, it, beforeAll } from 'vitest'
import { EditorSession } from '../src/core/editor/session'

beforeAll(() => {
  if (typeof URL.createObjectURL !== 'function') {
    let n = 0
    URL.createObjectURL = () => `blob:test-${++n}`
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    URL.revokeObjectURL = () => undefined
  }
})

describe('raster stroke history', () => {
  it('undoes one stroke at a time without removing the paint layer', () => {
    const session = new EditorSession()
    session.createNew({ name: 'Paint', width: 64, height: 64 })

    const layer = session.getDocument()!.layers.find((l) => l.kind === 'raster')
    expect(layer?.kind).toBe('raster')
    if (!layer || layer.kind !== 'raster') throw new Error('expected raster')

    const stroke1 = new Uint8Array([1, 1, 1, 1])
    const stroke2 = new Uint8Array([2, 2, 2, 2])
    const stroke3 = new Uint8Array([3, 3, 3, 3])

    session.commitRasterStroke({
      layer,
      isNewLayer: false,
      bytes: stroke1,
      label: 'Brush stroke'
    })
    expect(session.getDocument()?.layers).toHaveLength(1)
    expect(session.getSnapshot().canUndo).toBe(true)

    session.commitRasterStroke({
      layer,
      isNewLayer: false,
      bytes: stroke2,
      label: 'Brush stroke'
    })
    session.commitRasterStroke({
      layer,
      isNewLayer: false,
      bytes: stroke3,
      label: 'Brush stroke'
    })

    session.undo()
    expect(session.getDocument()?.layers).toHaveLength(1)
    expect(session.getSnapshot().canUndo).toBe(true)
    expect(session.getSnapshot().canRedo).toBe(true)

    session.undo()
    expect(session.getDocument()?.layers).toHaveLength(1)

    // Third undo restores pre-first-stroke pixels; layer remains (seeded at create)
    session.undo()
    expect(session.getDocument()?.layers).toHaveLength(1)
    expect(session.getSnapshot().canUndo).toBe(false)

    session.redo()
    expect(session.getDocument()?.layers).toHaveLength(1)
  })
})
