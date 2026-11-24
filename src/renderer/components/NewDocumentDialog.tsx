import { useEffect, useState } from 'react'

interface Props {
  open: boolean
  onClose: () => void
  onCreate: (opts: { name: string; width: number; height: number; background: string }) => void
}

const PRESETS = [
  { label: 'Web HD', width: 1920, height: 1080 },
  { label: 'Web SD', width: 1280, height: 720 },
  { label: 'Square', width: 1080, height: 1080 },
  { label: 'Instagram Story', width: 1080, height: 1920 },
  { label: 'A4 @ 150ppi', width: 1240, height: 1754 },
  { label: 'Default', width: 800, height: 600 }
]

export function NewDocumentDialog({ open, onClose, onCreate }: Props) {
  const [name, setName] = useState('Untitled-1')
  const [width, setWidth] = useState(1920)
  const [height, setHeight] = useState(1080)
  const [background, setBackground] = useState('transparent')

  useEffect(() => {
    if (open) {
      setName((n) => (n.startsWith('Untitled') ? `Untitled-${Date.now().toString().slice(-4)}` : n))
    }
  }, [open])

  if (!open) return null

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal new-doc-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>New Document</h2>
        <p className="modal-sub">Choose a canvas size. Background can be transparent (checkerboard).</p>

        <div className="preset-grid">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className={width === p.width && height === p.height ? 'preset active' : 'preset'}
              onClick={() => {
                setWidth(p.width)
                setHeight(p.height)
              }}
            >
              <strong>{p.label}</strong>
              <span>
                {p.width} × {p.height}
              </span>
            </button>
          ))}
        </div>

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
          <label htmlFor="doc-bg">Background</label>
          <select id="doc-bg" value={background} onChange={(e) => setBackground(e.target.value)}>
            <option value="transparent">Transparent</option>
            <option value="#ffffff">White</option>
            <option value="#000000">Black</option>
            <option value="#808080">Gray</option>
          </select>
        </div>

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => {
              onCreate({ name, width, height, background })
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
