import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { IpcApi, SerializedProjectPackage } from '../../src/shared/types'

const api: IpcApi = {
  pickOpenImages: () => ipcRenderer.invoke('dialog:openImages'),
  pickSaveProject: (defaultName: string) => ipcRenderer.invoke('dialog:saveProject', defaultName),
  pickOpenProject: () => ipcRenderer.invoke('dialog:openProject'),
  pickExportImage: (format: 'png' | 'jpeg') => ipcRenderer.invoke('dialog:exportImage', format),
  readBinaryFile: (filePath: string) => ipcRenderer.invoke('fs:readBinary', filePath),
  writeBinaryFile: (filePath: string, data: Uint8Array) =>
    ipcRenderer.invoke('fs:writeBinary', filePath, data),
  saveProjectPackage: (filePath: string, pkg: SerializedProjectPackage) =>
    ipcRenderer.invoke('project:save', filePath, pkg),
  openProjectPackage: (filePath: string) => ipcRenderer.invoke('project:open', filePath),
  getPathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return null
    }
  }
}

contextBridge.exposeInMainWorld('atmps', api)

declare global {
  interface Window {
    atmps: IpcApi
  }
}
