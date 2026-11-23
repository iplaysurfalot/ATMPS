import { app, BrowserWindow, dialog, ipcMain, protocol, net } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { SerializedProjectPackage } from '../../src/shared/types'
import { packProject, unpackProject, deserializePackage, serializePackage } from '../../src/core/file/project-io'

const isDev = !app.isPackaged

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'atmps-asset',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
])

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#111318',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function assertAbsolutePath(filePath: string): string {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('Invalid path')
  }
  const resolved = resolve(normalize(filePath))
  if (!resolved || resolved.includes('\0')) {
    throw new Error('Invalid path')
  }
  return resolved
}

function registerIpc(): void {
  ipcMain.handle('dialog:openImages', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Import Images',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    })
    return result.canceled ? null : result.filePaths
  })

  ipcMain.handle('dialog:saveProject', async (_e, defaultName: string) => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: 'Save Project',
      defaultPath: `${defaultName || 'Untitled'}.atmps`,
      filters: [{ name: 'ATMPS Project', extensions: ['atmps'] }]
    })
    return result.canceled ? null : result.filePath ?? null
  })

  ipcMain.handle('dialog:openProject', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Open Project',
      properties: ['openFile'],
      filters: [{ name: 'ATMPS Project', extensions: ['atmps'] }]
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  })

  ipcMain.handle('dialog:exportImage', async (_e, format: 'png' | 'jpeg') => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: 'Export Image',
      defaultPath: `export.${format === 'jpeg' ? 'jpg' : 'png'}`,
      filters: [
        format === 'jpeg'
          ? { name: 'JPEG', extensions: ['jpg', 'jpeg'] }
          : { name: 'PNG', extensions: ['png'] }
      ]
    })
    return result.canceled ? null : result.filePath ?? null
  })

  ipcMain.handle('fs:readBinary', async (_e, filePath: string) => {
    const path = assertAbsolutePath(filePath)
    const ext = extname(path).toLowerCase()
    const allowed = new Set(['.png', '.jpg', '.jpeg', '.webp', '.atmps'])
    if (!allowed.has(ext)) {
      throw new Error(`Disallowed file type: ${ext}`)
    }
    const buf = await readFile(path)
    return new Uint8Array(buf)
  })

  ipcMain.handle('fs:writeBinary', async (_e, filePath: string, data: Uint8Array) => {
    const path = assertAbsolutePath(filePath)
    const ext = extname(path).toLowerCase()
    const allowed = new Set(['.png', '.jpg', '.jpeg', '.webp', '.atmps'])
    if (!allowed.has(ext)) {
      throw new Error(`Disallowed file type: ${ext}`)
    }
    await writeFile(path, Buffer.from(data))
  })

  ipcMain.handle('project:save', async (_e, filePath: string, serialized: SerializedProjectPackage) => {
    const path = assertAbsolutePath(filePath)
    if (extname(path).toLowerCase() !== '.atmps') {
      throw new Error('Project must use .atmps extension')
    }
    const pkg = deserializePackage(serialized)
    const bytes = await packProject(pkg)
    await writeFile(path, Buffer.from(bytes))
  })

  ipcMain.handle('project:open', async (_e, filePath: string) => {
    const path = assertAbsolutePath(filePath)
    if (extname(path).toLowerCase() !== '.atmps') {
      throw new Error('Project must use .atmps extension')
    }
    const buf = await readFile(path)
    const pkg = await unpackProject(new Uint8Array(buf))
    return serializePackage(pkg)
  })
}

app.whenReady().then(() => {
  protocol.handle('atmps-asset', async (request) => {
    // atmps-asset://local/?path=<encoded absolute path>
    try {
      const url = new URL(request.url)
      const filePath = url.searchParams.get('path')
      if (!filePath) {
        return new Response('Missing path', { status: 400 })
      }
      const path = assertAbsolutePath(decodeURIComponent(filePath))
      return net.fetch(pathToFileURL(path).toString())
    } catch (err) {
      return new Response(String(err), { status: 400 })
    }
  })

  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
