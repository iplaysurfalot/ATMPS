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
})
