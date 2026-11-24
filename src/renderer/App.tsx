import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FabricController } from '@core/rendering/fabric-controller'
import { useEditorSession, useSessionInstance } from './hooks/useEditorSession'
import { NewDocumentDialog } from './components/NewDocumentDialog'
import { LayersPanel } from './components/LayersPanel'
import { PropertiesPanel } from './components/PropertiesPanel'
import { CanvasViewport } from './components/CanvasViewport'
import { MenuBar, type MenuDef } from './components/MenuBar'
import { ToolOptionsBar } from './components/ToolOptionsBar'
import { HistoryPanel } from './components/HistoryPanel'
import {
  IconBrush,
  IconBucket,
  IconClone,
  IconCrop,
  IconEllipse,
  IconEraser,
  IconEyedropper,
  IconGradient,
  IconHand,
  IconLasso,
  IconMarquee,
  IconMove,
  IconPolyLasso,
  IconRect,
  IconText,
  IconZoom
} from './components/icons'
import type { ToolId } from '@shared/types'
import { TOOL_TIPS } from '@shared/types'
import { bytesToBlob } from '@core/bytes'

const TOOLS: { id: ToolId; tip: string; icon: React.ReactNode }[] = [
  { id: 'move', tip: TOOL_TIPS.move, icon: <IconMove /> },
  { id: 'marquee', tip: TOOL_TIPS.marquee, icon: <IconMarquee /> },
  { id: 'lasso', tip: TOOL_TIPS.lasso, icon: <IconLasso /> },
  { id: 'polylasso', tip: TOOL_TIPS.polylasso, icon: <IconPolyLasso /> },
  { id: 'crop', tip: TOOL_TIPS.crop, icon: <IconCrop /> },
  { id: 'eyedropper', tip: TOOL_TIPS.eyedropper, icon: <IconEyedropper /> },
  { id: 'brush', tip: TOOL_TIPS.brush, icon: <IconBrush /> },
  { id: 'eraser', tip: TOOL_TIPS.eraser, icon: <IconEraser /> },
  { id: 'clone', tip: TOOL_TIPS.clone, icon: <IconClone /> },
  { id: 'bucket', tip: TOOL_TIPS.bucket, icon: <IconBucket /> },
  { id: 'gradient', tip: TOOL_TIPS.gradient, icon: <IconGradient /> },
  { id: 'text', tip: TOOL_TIPS.text, icon: <IconText /> },
  { id: 'rect', tip: TOOL_TIPS.rect, icon: <IconRect /> },
  { id: 'ellipse', tip: TOOL_TIPS.ellipse, icon: <IconEllipse /> },
  { id: 'hand', tip: TOOL_TIPS.hand, icon: <IconHand /> },
  { id: 'zoom', tip: TOOL_TIPS.zoom, icon: <IconZoom /> }
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

  const fitZoom = useCallback(() => {
    const doc = snapshot.document
    const controller = controllerRef.current
    if (!doc || !controller) return
    const z = controller.zoomToFit(doc.width, doc.height)
    session.setZoom(z)
  }, [session, snapshot.document])

  const actualPixels = useCallback(() => {
    const doc = snapshot.document
    const controller = controllerRef.current
    if (!doc || !controller) return
    const z = controller.zoomToActual(doc.width, doc.height)
    session.setZoom(z)
  }, [session, snapshot.document])

  const onTool = useCallback(
    (tool: ToolId) => {
      if (tool === 'rect') {
        if (!snapshot.document) {
          session.setStatus('Create a document first')
          return
        }
        session.addShape('rect')
        return
      }
      if (tool === 'ellipse') {
        if (!snapshot.document) {
          session.setStatus('Create a document first')
          return
        }
        session.addShape('ellipse')
        return
      }
      if (tool === 'text') {
        if (!snapshot.document) {
          session.setStatus('Create a document first')
          return
        }
        session.addText()
        return
      }
      session.setTool(tool)
    },
    [session, snapshot.document]
  )

  const menus: MenuDef[] = useMemo(
    () => [
      {
        id: 'file',
        label: 'File',
        items: [
          { id: 'new', label: 'New…', shortcut: 'Ctrl+N', onClick: () => setNewOpen(true) },
          { id: 'open', label: 'Open…', shortcut: 'Ctrl+O', onClick: () => void openProject() },
          { id: 'sep1', label: '', separator: true },
          {
            id: 'save',
            label: 'Save',
            shortcut: 'Ctrl+S',
            disabled: !snapshot.document,
            onClick: () => void saveProject()
          },
          {
            id: 'saveas',
            label: 'Save As…',
            shortcut: 'Ctrl+Shift+S',
            disabled: !snapshot.document,
            onClick: () => void saveProjectAs()
          },
          { id: 'sep2', label: '', separator: true },
          {
            id: 'import',
            label: 'Place Embedded…',
            disabled: !snapshot.document,
            onClick: () => void importImages()
          },
          {
            id: 'export-png',
            label: 'Export as PNG…',
            disabled: !snapshot.document,
            onClick: () => void exportImage('png')
          },
          {
            id: 'export-jpg',
            label: 'Export as JPEG…',
            disabled: !snapshot.document,
            onClick: () => void exportImage('jpeg')
          },
          { id: 'sep3', label: '', separator: true },
          {
            id: 'close',
            label: 'Close',
            disabled: !snapshot.activeDocumentId,
            onClick: () => snapshot.activeDocumentId && session.closeDocument(snapshot.activeDocumentId)
          }
        ]
      },
      {
        id: 'edit',
        label: 'Edit',
        items: [
          {
            id: 'undo',
            label: 'Undo',
            shortcut: 'Ctrl+Z',
            disabled: !snapshot.canUndo,
            onClick: () => session.undo()
          },
          {
            id: 'redo',
            label: 'Redo',
            shortcut: 'Ctrl+Shift+Z',
            disabled: !snapshot.canRedo,
            onClick: () => session.redo()
          },
          { id: 'sep-e', label: '', separator: true },
          {
            id: 'clear',
            label: 'Clear / Delete',
            shortcut: 'Delete',
            disabled: !snapshot.document,
            onClick: () => void session.deleteSelectionOrLayer()
          }
        ]
      },
      {
        id: 'image',
        label: 'Image',
        items: [
          {
            id: 'img-size',
            label: snapshot.document
              ? `Canvas Size: ${snapshot.document.width} × ${snapshot.document.height}`
              : 'Canvas Size',
            disabled: true
          }
        ]
      },
      {
        id: 'layer',
        label: 'Layer',
        items: [
          {
            id: 'new-layer',
            label: 'New Layer',
            disabled: !snapshot.document,
            onClick: () => void session.ensureRasterLayer()
          },
          {
            id: 'dup',
            label: 'Duplicate Layer',
            disabled: !snapshot.document?.activeLayerId,
            onClick: () =>
              snapshot.document?.activeLayerId &&
              session.duplicateActiveLayer(snapshot.document.activeLayerId)
          },
          {
            id: 'del',
            label: 'Delete Layer',
            disabled: !snapshot.document?.activeLayerId,
            onClick: () =>
              snapshot.document?.activeLayerId && session.deleteLayer(snapshot.document.activeLayerId)
          },
          { id: 'sep-l', label: '', separator: true },
          {
            id: 'rasterize',
            label: 'Rasterize',
            disabled: !snapshot.document?.activeLayerId,
            onClick: () => {
              const id = snapshot.document?.activeLayerId
              if (id) void session.rasterizeLayer(id)
            }
          }
        ]
      },
      {
        id: 'select',
        label: 'Select',
        items: [
          {
            id: 'all',
            label: 'All',
            shortcut: 'Ctrl+A',
            disabled: !snapshot.document,
            onClick: () => {
              if (!snapshot.document) return
              session.setSelection({
                x: 0,
                y: 0,
                width: snapshot.document.width,
                height: snapshot.document.height
              })
              session.setTool('marquee')
            }
          },
          {
            id: 'deselect',
            label: 'Deselect',
            shortcut: 'Ctrl+D',
            disabled: !snapshot.selection,
            onClick: () => session.clearSelection()
          }
        ]
      },
      {
        id: 'view',
        label: 'View',
        items: [
          {
            id: 'zoom-in',
            label: 'Zoom In',
            shortcut: 'Ctrl+=',
            onClick: () => session.setZoom(snapshot.zoom * 1.25)
          },
          {
            id: 'zoom-out',
            label: 'Zoom Out',
            shortcut: 'Ctrl+-',
            onClick: () => session.setZoom(snapshot.zoom / 1.25)
          },
          {
            id: 'fit',
            label: 'Fit on Screen',
            shortcut: 'Ctrl+0',
            disabled: !snapshot.document,
            onClick: () => fitZoom()
          },
          {
            id: 'actual',
            label: '100%',
            shortcut: 'Ctrl+1',
            disabled: !snapshot.document,
            onClick: () => actualPixels()
          },
          { id: 'sep-v', label: '', separator: true },
          {
            id: 'rulers',
            label: snapshot.showRulers ? 'Hide Rulers' : 'Show Rulers',
            shortcut: 'Ctrl+R',
            onClick: () => session.setShowRulers(!snapshot.showRulers)
          }
        ]
      },
      {
        id: 'window',
        label: 'Window',
        items: [
          { id: 'layers', label: 'Layers', disabled: true },
          { id: 'props', label: 'Properties', disabled: true }
        ]
      }
    ],
    [
      actualPixels,
      exportImage,
      fitZoom,
      importImages,
      openProject,
      saveProject,
      saveProjectAs,
      session,
      snapshot
    ]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey
      const target = e.target as HTMLElement | null
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)

      if (e.code === 'Space' && !typing && !e.repeat) {
        e.preventDefault()
        session.setTemporaryTool('hand')
        controllerRef.current?.setSpacePan(true)
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
      } else if (meta && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        session.clearSelection()
      } else if (meta && e.key.toLowerCase() === 'a' && !typing) {
        e.preventDefault()
        if (snapshot.document) {
          session.setSelection({
            x: 0,
            y: 0,
            width: snapshot.document.width,
            height: snapshot.document.height
          })
        }
      } else if (meta && e.key.toLowerCase() === 'r') {
        e.preventDefault()
        session.setShowRulers(!snapshot.showRulers)
      } else if (meta && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        session.setZoom(snapshot.zoom * 1.25)
      } else if (meta && e.key === '-') {
        e.preventDefault()
        session.setZoom(snapshot.zoom / 1.25)
      } else if (meta && e.key === '0') {
        e.preventDefault()
        fitZoom()
      } else if (meta && e.key === '1') {
        e.preventDefault()
        actualPixels()
      } else if (!meta && !typing && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault()
        void session.deleteSelectionOrLayer()
      } else if (!meta && !typing && e.key === 'Enter' && snapshot.tool === 'crop') {
        e.preventDefault()
        void controllerRef.current?.applyPendingCrop()
      } else if (!meta && !typing && e.key === 'Escape') {
        session.clearSelection()
      } else if (!meta && !typing && (e.key === '[' || e.key === '{')) {
        e.preventDefault()
        // Photoshop: [ smaller, { much smaller — we map both brackets; Shift+[ = {
        const step = e.key === '{' || e.shiftKey ? -20 : -5
        session.nudgeBrushSize(step)
      } else if (!meta && !typing && (e.key === ']' || e.key === '}')) {
        e.preventDefault()
        const step = e.key === '}' || e.shiftKey ? 20 : 5
        session.nudgeBrushSize(step)
      } else if (!meta && !typing) {
        if (e.key.toLowerCase() === 'g' && e.shiftKey) {
          onTool('gradient')
          return
        }
        if (e.key.toLowerCase() === 'l' && e.shiftKey) {
          onTool('polylasso')
          return
        }
        const map: Record<string, ToolId> = {
          v: 'move',
          m: 'marquee',
          l: 'lasso',
          c: 'crop',
          b: 'brush',
          e: 'eraser',
          s: 'clone',
          i: 'eyedropper',
          g: 'bucket',
          t: 'text',
          u: 'rect',
          o: 'ellipse',
          h: 'hand',
          z: 'zoom'
        }
        const tool = map[e.key.toLowerCase()]
        if (tool) onTool(tool)
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        controllerRef.current?.setSpacePan(false)
        session.restorePreviousTool()
      }
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [
    actualPixels,
    fitZoom,
    onTool,
    openProject,
    saveProject,
    saveProjectAs,
    session,
    snapshot.document,
    snapshot.showRulers,
    snapshot.tool,
    snapshot.zoom
  ])

  return (
    <div className="app-shell">
      <MenuBar menus={menus} />
      <ToolOptionsBar
        session={session}
        snapshot={snapshot}
        onApplyCrop={() => void controllerRef.current?.applyPendingCrop()}
      />

      <div className="workspace">
        <aside className="tools-rail" aria-label="Tools">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={snapshot.tool === t.id ? 'active' : ''}
              title={t.tip}
              onClick={() => onTool(t.id)}
            >
              {t.icon}
            </button>
          ))}
          <div className="swatch-stack">
            <input
              type="color"
              className="fg-swatch"
              title="Foreground"
              value={snapshot.brushColor}
              onChange={(e) => session.setBrushColor(e.target.value)}
            />
          </div>
        </aside>

        <section className="center-column">
          <div className="doc-tabs">
            {snapshot.documents.length === 0 ? (
              <div className="doc-tab muted">No documents</div>
            ) : (
              snapshot.documents.map((tab) => (
                <div
                  key={tab.id}
                  className={`doc-tab${tab.id === snapshot.activeDocumentId ? ' active' : ''}${tab.dirty ? ' dirty' : ''}`}
                  onClick={() => session.switchDocument(tab.id)}
                >
                  <span className="doc-tab-name">{tab.name}</span>
                  <button
                    type="button"
                    className="doc-tab-close"
                    title="Close"
                    onClick={(e) => {
                      e.stopPropagation()
                      session.closeDocument(tab.id)
                    }}
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
          <CanvasViewport
            session={session}
            snapshot={snapshot}
            controllerRef={controllerRef}
            onRequestNew={() => setNewOpen(true)}
            onRequestOpen={() => void openProject()}
          />
        </section>

        <aside className="right-panel">
          {snapshot.document ? (
            <>
              <LayersPanel
                document={snapshot.document}
                session={session}
                assetUrls={snapshot.assetUrls}
              />
              <HistoryPanel session={session} snapshot={snapshot} />
              <PropertiesPanel document={snapshot.document} session={session} tool={snapshot.tool} />
            </>
          ) : (
            <div className="panel">
              <div className="panel-header">Layers</div>
              <div className="panel-body muted-help">Open a document to edit layers.</div>
            </div>
          )}
        </aside>
      </div>

      <footer className="status-bar">
        <span className="status-left">{snapshot.status}</span>
        <span className="status-center">{snapshot.toolTip}</span>
        <span className="status-right">
          {snapshot.document ? (
            <>
              <button type="button" className="status-zoom" onClick={() => fitZoom()}>
                {Math.round(snapshot.zoom * 100)}%
              </button>
              <span>
                {snapshot.document.width} × {snapshot.document.height} px
              </span>
              {snapshot.selection && (
                <span>
                  Sel {Math.round(snapshot.selection.width)}×{Math.round(snapshot.selection.height)}
                </span>
              )}
            </>
          ) : (
            'Idle'
          )}
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
