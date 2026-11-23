import { useCallback, useEffect, useRef, useState } from 'react'
import type { FabricController } from '@core/rendering/fabric-controller'
import { useEditorSession, useSessionInstance } from './hooks/useEditorSession'
import { NewDocumentDialog } from './components/NewDocumentDialog'
import { LayersPanel } from './components/LayersPanel'
import { PropertiesPanel } from './components/PropertiesPanel'
import { CanvasViewport } from './components/CanvasViewport'
import type { ToolId } from '@shared/types'
import { bytesToBlob } from '@core/bytes'

const TOOLS: { id: ToolId; label: string; tip: string }[] = [
  { id: 'select', label: 'Sel', tip: 'Select / transform (V)' },
  { id: 'pan', label: 'Pan', tip: 'Pan canvas (H)' },
  { id: 'brush', label: 'Br', tip: 'Brush (B)' },
  { id: 'eraser', label: 'Er', tip: 'Eraser (E)' },
  { id: 'text', label: 'Txt', tip: 'Text (T)' },
  { id: 'rect', label: '▭', tip: 'Rectangle (R)' },
  { id: 'ellipse', label: '◯', tip: 'Ellipse (O)' }
]

function basename(path: string): string {
  return path.split(/[/\\]/).pop() || path
}

function probeImageSize(bytes: Uint8Array, mime: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(bytesToBlob(bytes, mime))
    const img = new Image()
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
      URL.revokeObjectURL(url)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read image dimensions'))
    }
    img.src = url
  })
}

export function App() {
  const session = useSessionInstance()
  const snapshot = useEditorSession()
  const controllerRef = useRef<FabricController | null>(null)
  const [newOpen, setNewOpen] = useState(false)

  const importImages = useCallback(async () => {
    if (!snapshot.document) {
      session.setStatus('Create or open a document first')
      return
    }
    const paths = await window.atmps.pickOpenImages()
    if (!paths?.length) return
    for (const filePath of paths) {
      const bytes = await window.atmps.readBinaryFile(filePath)
      const name = basename(filePath)
      const lower = name.toLowerCase()
      const mime = lower.endsWith('.webp')
        ? 'image/webp'
        : lower.endsWith('.jpg') || lower.endsWith('.jpeg')
          ? 'image/jpeg'
          : 'image/png'
      const size = await probeImageSize(bytes, mime)
      session.importImageBytes({
        name,
        filePath,
        bytes,
        naturalWidth: size.width,
        naturalHeight: size.height
      })
    }
  }, [session, snapshot.document])

  const saveProject = useCallback(async () => {
    if (!snapshot.document) return
    let path = snapshot.filePath
    if (!path) {
      path = await window.atmps.pickSaveProject(snapshot.document.name)
      if (!path) return
    }
    const pkg = session.toSerializedPackage()
    await window.atmps.saveProjectPackage(path, pkg)
    session.markSaved(path)
  }, [session, snapshot.document, snapshot.filePath])

  const saveProjectAs = useCallback(async () => {
    if (!snapshot.document) return
    const path = await window.atmps.pickSaveProject(snapshot.document.name)
    if (!path) return
    const pkg = session.toSerializedPackage()
    await window.atmps.saveProjectPackage(path, pkg)
    session.markSaved(path)
  }, [session, snapshot.document])

  const openProject = useCallback(async () => {
    const path = await window.atmps.pickOpenProject()
    if (!path) return
    const pkg = await window.atmps.openProjectPackage(path)
    session.loadSerializedPackage(pkg, path)
  }, [session])

  const exportImage = useCallback(
    async (format: 'png' | 'jpeg') => {
      const doc = snapshot.document
      const controller = controllerRef.current
      if (!doc || !controller) return
      const path = await window.atmps.pickExportImage(format)
      if (!path) return
      const bytes = await controller.exportFlattened(doc, snapshot.assetUrls, format)
      await window.atmps.writeBinaryFile(path, bytes)
      session.setStatus(`Exported ${path}`)
    },
    [session, snapshot.document, snapshot.assetUrls]
  )

  const onTool = useCallback(
    (tool: ToolId) => {
      if (tool === 'rect') {
        session.addShape('rect')
        session.setTool('select')
        return
      }
      if (tool === 'ellipse') {
        session.addShape('ellipse')
        session.setTool('select')
        return
      }
      if (tool === 'text') {
        session.addText()
        session.setTool('select')
        return
      }
      session.setTool(tool)
    },
    [session]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey
      const target = e.target as HTMLElement | null
      const typing =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)

      if (e.code === 'Space' && !typing) {
        session.setTool('pan')
      }

      if (meta && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        setNewOpen(true)
      } else if (meta && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        void openProject()
      } else if (meta && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (e.shiftKey) void saveProjectAs()
        else void saveProject()
      } else if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) session.redo()
        else session.undo()
      } else if (meta && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        session.redo()
      } else if (meta && e.key.toLowerCase() === '=') {
        e.preventDefault()
        session.setZoom(snapshot.zoom * 1.1)
      } else if (meta && e.key.toLowerCase() === '-') {
        e.preventDefault()
        session.setZoom(snapshot.zoom / 1.1)
      } else if (meta && e.key.toLowerCase() === '0') {
        e.preventDefault()
        session.setZoom(1)
      } else if (!meta && !typing) {
        const map: Record<string, ToolId> = {
          v: 'select',
          h: 'pan',
          b: 'brush',
          e: 'eraser',
          t: 'text',
          r: 'rect',
          o: 'ellipse'
        }
        const tool = map[e.key.toLowerCase()]
        if (tool) onTool(tool)
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        session.setTool('select')
      }
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [onTool, openProject, saveProject, saveProjectAs, session, snapshot.zoom])

  return (
    <div className="app-shell">
      <header className="menu-bar">
        <div className="brand">ATMPS</div>
        <div className="menu-group">
          <button type="button" onClick={() => setNewOpen(true)}>
            New
          </button>
          <button type="button" onClick={() => void openProject()}>
            Open
          </button>
          <button type="button" disabled={!snapshot.document} onClick={() => void saveProject()}>
            Save
          </button>
          <button type="button" disabled={!snapshot.document} onClick={() => void saveProjectAs()}>
            Save As
          </button>
          <button type="button" disabled={!snapshot.document} onClick={() => void importImages()}>
            Import
          </button>
          <button type="button" disabled={!snapshot.document} onClick={() => void exportImage('png')}>
            Export PNG
          </button>
          <button type="button" disabled={!snapshot.document} onClick={() => void exportImage('jpeg')}>
            Export JPG
          </button>
        </div>
        <div className="menu-group">
          <button type="button" disabled={!snapshot.canUndo} onClick={() => session.undo()}>
            Undo
          </button>
          <button type="button" disabled={!snapshot.canRedo} onClick={() => session.redo()}>
            Redo
          </button>
          <button type="button" onClick={() => session.setZoom(snapshot.zoom * 1.1)}>
            Zoom+
          </button>
          <button type="button" onClick={() => session.setZoom(snapshot.zoom / 1.1)}>
            Zoom−
          </button>
          <button type="button" onClick={() => session.setZoom(1)}>
            100%
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="tools-rail">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={snapshot.tool === t.id ? 'active' : ''}
              title={t.tip}
              onClick={() => onTool(t.id)}
            >
              {t.label}
            </button>
          ))}
          <div className="tool-options">
            <label>
              Size
              <input
                type="range"
                min={1}
                max={120}
                value={snapshot.brushSize}
                onChange={(e) => session.setBrushSize(Number(e.target.value))}
              />
            </label>
            <label>
              Color
              <input
                type="color"
                value={snapshot.brushColor}
                onChange={(e) => session.setBrushColor(e.target.value)}
              />
            </label>
          </div>
        </aside>

        <section className="center-column">
          <div className="doc-tabs">
            {snapshot.document ? (
              <div className={`doc-tab${snapshot.dirty ? ' dirty' : ''}`}>
                {snapshot.document.name}
                {snapshot.document.width}×{snapshot.document.height}
              </div>
            ) : (
              <div className="doc-tab">No document</div>
            )}
          </div>
          <CanvasViewport session={session} snapshot={snapshot} controllerRef={controllerRef} />
        </section>

        <aside className="right-panel">
          {snapshot.document ? (
            <>
              <LayersPanel document={snapshot.document} session={session} />
              <PropertiesPanel
                document={snapshot.document}
                session={session}
                brushSize={snapshot.brushSize}
                brushColor={snapshot.brushColor}
                tool={snapshot.tool}
              />
            </>
          ) : (
            <div className="panel">
              <div className="panel-header">Layers</div>
              <div className="panel-body" style={{ color: 'var(--text-muted)' }}>
                Open a document to edit layers.
              </div>
            </div>
          )}
        </aside>
      </div>

      <footer className="status-bar">
        <span>{snapshot.status}</span>
        <span>
          {snapshot.document
            ? `${snapshot.document.width}×${snapshot.document.height} · ${Math.round(snapshot.zoom * 100)}% · ${snapshot.tool}`
            : 'Idle'}
          {snapshot.filePath ? ` · ${snapshot.filePath}` : ''}
        </span>
      </footer>

      <NewDocumentDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreate={(opts) => session.createNew(opts)}
      />
    </div>
  )
}
