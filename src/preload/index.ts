import { contextBridge, ipcRenderer } from 'electron'
import type { CatalogApi } from '../shared/catalog'

const catalog: CatalogApi = {
  listCards: () => ipcRenderer.invoke('catalog:list'),
  stats: () => ipcRenderer.invoke('catalog:stats'),
  resolveArtwork: (artworkId) => ipcRenderer.invoke('catalog:resolve-artwork', artworkId)
}

contextBridge.exposeInMainWorld('arcana', {
  catalog,
  platform: process.platform
})

