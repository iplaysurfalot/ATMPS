import { useState } from 'react'

interface Props {
  open: boolean
  onClose: () => void
  onCreate: (opts: { name: string; width: number; height: number }) => void
}

const PRESETS = [
  { label: '1920×1080', width: 1920, height: 1080 },
  { label: '1280×720', width: 1280, height: 720 },
  { label: '1080×1080', width: 1080, height: 1080 },
  { label: '800×600', width: 800, height: 600 }
]

export function NewDocumentDialog({ open, onClose, onCreate }: Props) {
  const [name, setName] = useState('Untitled')
  const [width, setWidth] = useState(1920)
  const [height, setHeight] = useState(1080)

  if (!open) return null

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>New Document</h2>
        <div className="props-row">
          <label htmlFor="doc-name">Name</label>
          <input id="doc-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="props-row">
          <label htmlFor="doc-w">Width</label>
          <input
            id="doc-w"
            type="number"
            min={1}
            max={8192}
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
          />
        </div>
        <div className="props-row">
          <label htmlFor="doc-h">Height</label>
          <input
            id="doc-h"
            type="number"
            min={1}
            max={8192}
            value={height}
            onChange={(e) => setHeight(Number(e.target.value))}
          />
        </div>
        <div className="props-row">
          <span>Presets</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  setWidth(p.width)
                  setHeight(p.height)
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => {
              onCreate({ name, width, height })
              onClose()
            }}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  )
}
