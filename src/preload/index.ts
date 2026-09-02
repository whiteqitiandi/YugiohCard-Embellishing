import { contextBridge, ipcRenderer } from 'electron'
import type { AppCommandsApi, AppView, CardFiltersApi, CatalogApi } from '../shared/catalog'
import type { CardFilterCriteria } from '../shared/filters'

const catalog: CatalogApi = {
  listCards: () => ipcRenderer.invoke('catalog:list'),
  stats: () => ipcRenderer.invoke('catalog:stats'),
  resolveArtwork: (artworkId) => ipcRenderer.invoke('catalog:resolve-artwork', artworkId),
  runUpdate: (request) => ipcRenderer.invoke('catalog:update-run', request),
  updatePolicies: () => ipcRenderer.invoke('catalog:update-policies'),
  setUnpopular: (cardId, isUnpopular) => ipcRenderer.invoke('catalog:set-unpopular', cardId, isUnpopular)
}

const commands: AppCommandsApi = {
  onNavigate: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, view: AppView): void => callback(view)
    ipcRenderer.on('app:navigate', listener)
    return () => ipcRenderer.removeListener('app:navigate', listener)
  },
  onFocusSearch: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on('app:focus-search', listener)
    return () => ipcRenderer.removeListener('app:focus-search', listener)
  },
  onClearFilters: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on('app:clear-filters', listener)
    return () => ipcRenderer.removeListener('app:clear-filters', listener)
  }
}

const filters: CardFiltersApi = {
  open: (criteria) => ipcRenderer.invoke('filters:open', criteria),
  getDraft: () => ipcRenderer.invoke('filters:get-draft'),
  apply: (criteria) => ipcRenderer.invoke('filters:apply', criteria),
  onApplied: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, criteria: CardFilterCriteria): void => callback(criteria)
    ipcRenderer.on('filters:applied', listener)
    return () => ipcRenderer.removeListener('filters:applied', listener)
  },
  listSaved: () => ipcRenderer.invoke('filters:saved-list'),
  save: (input) => ipcRenderer.invoke('filters:saved-save', input),
  delete: (id) => ipcRenderer.invoke('filters:saved-delete', id)
}

contextBridge.exposeInMainWorld('arcana', {
  catalog,
  commands,
  filters,
  platform: process.platform
})
