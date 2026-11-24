import { describe, expect, it } from 'vitest'
import { addLayer, createDocument, createShapeLayer, renameLayer } from '../src/core/document/model'
import { HistoryStack } from '../src/core/history/history-stack'

describe('history stack', () => {
  it('undoes and redoes committed edits', () => {
    const initial = createDocument({ name: 'H', width: 200, height: 200 })
    const history = new HistoryStack(initial)
    const shape = createShapeLayer({ name: 'Box', shape: 'rect', width: 40, height: 40 })

    history.commit('add', (d) => addLayer(d, shape))
    expect(history.document.layers).toHaveLength(1)
    expect(history.canUndo).toBe(true)

    history.undo()
    expect(history.document.layers).toHaveLength(0)
    expect(history.canRedo).toBe(true)

    history.redo()
    expect(history.document.layers).toHaveLength(1)
  })

  it('does not record no-op commits', () => {
    const history = new HistoryStack(createDocument({ name: 'H', width: 10, height: 10 }))
    history.commit('noop', (d) => d)
    expect(history.canUndo).toBe(false)
  })

  it('clears redo on new commit after undo', () => {
    const history = new HistoryStack(createDocument({ name: 'H', width: 10, height: 10 }))
    const a = createShapeLayer({ name: 'A', shape: 'rect', width: 1, height: 1 })
    history.commit('a', (d) => addLayer(d, a))
    history.undo()
    history.commit('rename', (d) => renameLayer(d, 'missing', 'x'))
    // rename missing is effectively no-op if layer missing — use add instead
    const b = createShapeLayer({ name: 'B', shape: 'ellipse', width: 2, height: 2 })
    history.commit('b', (d) => addLayer(d, b))
    expect(history.canRedo).toBe(false)
    expect(history.document.layers).toHaveLength(1)
    expect(history.document.layers[0]?.name).toBe('B')
  })

  it('preview does not push undo entries', () => {
    const history = new HistoryStack(createDocument({ name: 'H', width: 10, height: 10 }))
    history.preview((d) => ({ ...d, name: 'Preview' }))
    expect(history.document.name).toBe('Preview')
    expect(history.canUndo).toBe(false)
  })

  it('records asset-only commits so brush strokes can undo one at a time', () => {
    const history = new HistoryStack(createDocument({ name: 'H', width: 10, height: 10 }))
    const before = new Uint8Array([1, 2, 3])
    const after = new Uint8Array([4, 5, 6])
    const after2 = new Uint8Array([7, 8, 9])

    history.commit('Brush stroke', (d) => d, {
      assets: [{ assetId: 'a1', before, after }]
    })
    expect(history.canUndo).toBe(true)

    history.commit('Brush stroke', (d) => d, {
      assets: [{ assetId: 'a1', before: after, after: after2 }]
    })
    expect(history.canUndo).toBe(true)

    const undone2 = history.undo()
    expect(undone2?.label).toBe('Brush stroke')
    expect(undone2?.assets?.[0]?.before).toEqual(after)
    expect(undone2?.assets?.[0]?.after).toEqual(after2)

    const undone1 = history.undo()
    expect(undone1?.assets?.[0]?.before).toEqual(before)
    expect(undone1?.assets?.[0]?.after).toEqual(after)

    const redone = history.redo()
    expect(redone?.assets?.[0]?.after).toEqual(after)
  })

  it('exposes history labels for the panel', () => {
    const history = new HistoryStack(createDocument({ name: 'H', width: 10, height: 10 }))
    const a = createShapeLayer({ name: 'A', shape: 'rect', width: 1, height: 1 })
    history.commit('Add shape', (d) => addLayer(d, a))
    const labels = history.getHistoryLabels()
    expect(labels.past).toEqual(['Add shape'])
    expect(labels.current).toBe('Current state')
  })
})
