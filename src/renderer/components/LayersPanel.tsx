import type { AtmpsDocument } from '@shared/types'
import type { EditorSession } from '@core/editor/session'

interface Props {
  document: AtmpsDocument
  session: EditorSession
}

export function LayersPanel({ document, session }: Props) {
  // Top of list = top of stack visually (reverse draw order)
  const layers = [...document.layers].reverse()

  return (
    <div className="panel">
      <div className="panel-header">Layers</div>
      <div className="panel-body">
        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
          <button type="button" title="Duplicate" disabled={!document.activeLayerId} onClick={() => document.activeLayerId && session.duplicateActiveLayer(document.activeLayerId)}>
            Dup
          </button>
          <button type="button" title="Delete" disabled={!document.activeLayerId} onClick={() => document.activeLayerId && session.deleteLayer(document.activeLayerId)}>
            Del
          </button>
          <button
            type="button"
            title="Move up"
            disabled={!document.activeLayerId}
            onClick={() => {
              if (!document.activeLayerId) return
              const idx = document.layers.findIndex((l) => l.id === document.activeLayerId)
              if (idx < document.layers.length - 1) session.reorder(document.activeLayerId, idx + 1)
            }}
          >
            Up
          </button>
          <button
            type="button"
            title="Move down"
            disabled={!document.activeLayerId}
            onClick={() => {
              if (!document.activeLayerId) return
              const idx = document.layers.findIndex((l) => l.id === document.activeLayerId)
              if (idx > 0) session.reorder(document.activeLayerId, idx - 1)
            }}
          >
            Dn
          </button>
        </div>
        {layers.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No layers yet</div>}
        {layers.map((layer) => (
          <div
            key={layer.id}
            className={`layer-item${document.activeLayerId === layer.id ? ' active' : ''}`}
            onClick={() => session.selectLayer(layer.id)}
          >
            <button
              type="button"
              title={layer.visible ? 'Hide' : 'Show'}
              onClick={(e) => {
                e.stopPropagation()
                session.toggleVisibility(layer.id)
              }}
            >
              {layer.visible ? '👁' : '—'}
            </button>
            <input
              className="layer-name"
              value={layer.name}
              onChange={(e) => session.renameLayer(layer.id, e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{layer.kind}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
