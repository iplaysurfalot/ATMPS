import { useRef, useState } from 'react'
import type { AtmpsDocument, BlendMode, Layer } from '@shared/types'
import { BLEND_MODE_LABELS, BLEND_MODES } from '@shared/types'
import type { EditorSession } from '@core/editor/session'
import { IconEye, IconLock } from './icons'

interface Props {
  document: AtmpsDocument
  session: EditorSession
  assetUrls: Record<string, string>
}

export function LayersPanel({ document, session, assetUrls }: Props) {
  // Top of list = top of stack visually (reverse draw order)
  const layers = [...document.layers].reverse()
  const [dragId, setDragId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const dragOverId = useRef<string | null>(null)

  const active = document.layers.find((l) => l.id === document.activeLayerId) ?? null

  const onDropReorder = (targetId: string) => {
    if (!dragId || dragId === targetId) return
    const fromVisual = layers.findIndex((l) => l.id === dragId)
    const toVisual = layers.findIndex((l) => l.id === targetId)
    if (fromVisual < 0 || toVisual < 0) return
    // Convert visual index to document stack index (bottom = 0)
    const toIndex = document.layers.length - 1 - toVisual
    session.reorder(dragId, toIndex)
    setDragId(null)
  }

  return (
    <div className="panel layers-panel">
      <div className="panel-header">
        <span>Layers</span>
        <div className="panel-header-actions">
          <button
            type="button"
            title="New layer"
            disabled={!document}
            onClick={() => void session.ensureRasterLayer()}
          >
            +
          </button>
          <button
            type="button"
            title="Duplicate"
            disabled={!document.activeLayerId}
            onClick={() => document.activeLayerId && session.duplicateActiveLayer(document.activeLayerId)}
          >
            ▤
          </button>
          <button
            type="button"
            title="Delete"
            disabled={!document.activeLayerId}
            onClick={() => document.activeLayerId && session.deleteLayer(document.activeLayerId)}
          >
            ⌫
          </button>
        </div>
      </div>

      {active && (
        <div className="layer-blend-row">
          <select
            value={active.blendMode ?? 'normal'}
            title="Blend mode"
            onChange={(e) => session.setBlendMode(active.id, e.target.value as BlendMode)}
          >
            {BLEND_MODES.map((m) => (
              <option key={m} value={m}>
                {BLEND_MODE_LABELS[m]}
              </option>
            ))}
          </select>
          <label className="opacity-inline">
            <span>Opacity</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(active.opacity * 100)}
              onChange={(e) => session.setOpacity(active.id, Number(e.target.value) / 100)}
            />
            <span className="opacity-val">{Math.round(active.opacity * 100)}%</span>
          </label>
        </div>
      )}

      <div className="panel-body layer-list">
        {layers.length === 0 && <div className="empty-layers">No layers — import an image or paint</div>}
        {layers.map((layer) => (
          <div
            key={layer.id}
            className={`layer-item${document.activeLayerId === layer.id ? ' active' : ''}${dragId === layer.id ? ' dragging' : ''}`}
            draggable
            onDragStart={() => setDragId(layer.id)}
            onDragOver={(e) => {
              e.preventDefault()
              dragOverId.current = layer.id
            }}
            onDrop={(e) => {
              e.preventDefault()
              onDropReorder(layer.id)
            }}
            onDragEnd={() => setDragId(null)}
            onClick={() => session.selectLayer(layer.id)}
          >
            <button
              type="button"
              className="layer-icon-btn"
              title={layer.visible ? 'Hide' : 'Show'}
              onClick={(e) => {
                e.stopPropagation()
                session.toggleVisibility(layer.id)
              }}
            >
              <IconEye open={layer.visible} />
            </button>
            <button
              type="button"
              className="layer-icon-btn"
              title={layer.locked ? 'Unlock' : 'Lock'}
              onClick={(e) => {
                e.stopPropagation()
                session.toggleLock(layer.id)
              }}
            >
              <IconLock locked={layer.locked} />
            </button>
            <LayerThumb layer={layer} assetUrls={assetUrls} />
            {editingId === layer.id ? (
              <input
                className="layer-name editing"
                autoFocus
                defaultValue={layer.name}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  session.renameLayer(layer.id, e.target.value)
                  setEditingId(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  if (e.key === 'Escape') setEditingId(null)
                }}
              />
            ) : (
              <button
                type="button"
                className="layer-name-btn"
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  setEditingId(layer.id)
                }}
              >
                {layer.name}
              </button>
            )}
            <span className="layer-kind">{layer.kind}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function LayerThumb({ layer, assetUrls }: { layer: Layer; assetUrls: Record<string, string> }) {
  if ((layer.kind === 'image' || layer.kind === 'raster') && assetUrls[layer.assetId]) {
    return (
      <div className="layer-thumb">
        <img src={assetUrls[layer.assetId]} alt="" draggable={false} />
      </div>
    )
  }
  if (layer.kind === 'shape') {
    return (
      <div className="layer-thumb shape-thumb" style={{ background: layer.fill }}>
        {layer.shape === 'ellipse' ? '◯' : '▭'}
      </div>
    )
  }
  if (layer.kind === 'text') {
    return (
      <div className="layer-thumb text-thumb" style={{ color: layer.fill }}>
        T
      </div>
    )
  }
  return <div className="layer-thumb empty-thumb" />
}
