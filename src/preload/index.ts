import { contextBridge, ipcRenderer } from 'electron'
import type { AppCommandsApi, AppSettingsApi, AppView, CardFiltersApi, CatalogApi, CatalogUpdateState } from '../shared/catalog'
import type { CardFilterCriteria } from '../shared/filters'

const catalog: CatalogApi = {
  listCards: () => ipcRenderer.invoke('catalog:list'),
  stats: () => ipcRenderer.invoke('catalog:stats'),
  resolveArtwork: (artworkId) => ipcRenderer.invoke('catalog:resolve-artwork', artworkId),
  startUpdate: (request) => ipcRenderer.invoke('catalog:update-start', request),
  updateState: () => ipcRenderer.invoke('catalog:update-state'),
  controlUpdate: (control) => ipcRenderer.invoke('catalog:update-control', control),
  onUpdateState: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: CatalogUpdateState): void => callback(state)
    ipcRenderer.on('catalog:update-state-changed', listener)
    return () => ipcRenderer.removeListener('catalog:update-state-changed', listener)
  },
  updatePolicies: () => ipcRenderer.invoke('catalog:update-policies'),
  pendingCards: (region, page) => ipcRenderer.invoke('catalog:pending-cards', region, page),
  setUnpopular: (cardId, isUnpopular) => ipcRenderer.invoke('catalog:set-unpopular', cardId, isUnpopular),
  setUnpopularBatch: (cardIds, isUnpopular) => ipcRenderer.invoke('catalog:set-unpopular-batch', cardIds, isUnpopular)
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

const settings: AppSettingsApi = {
  get: () => ipcRenderer.invoke('settings:get'),
  setDirectoryPageRows: (rows) => ipcRenderer.invoke('settings:set-directory-page-rows', rows),
  onDirectoryPageRowsChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, rows: Parameters<typeof callback>[0]): void => callback(rows)
    ipcRenderer.on('settings:directory-page-rows-changed', listener)
    return () => ipcRenderer.removeListener('settings:directory-page-rows-changed', listener)
  },
  setDirectoryShowArtworkVariants: (show) => ipcRenderer.invoke('settings:set-directory-show-artwork-variants', show),
  onDirectoryShowArtworkVariantsChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, show: Parameters<typeof callback>[0]): void => callback(show)
    ipcRenderer.on('settings:directory-show-artwork-variants-changed', listener)
    return () => ipcRenderer.removeListener('settings:directory-show-artwork-variants-changed', listener)
  }
}

contextBridge.exposeInMainWorld('arcana', {
  catalog,
  commands,
  filters,
  settings,
  platform: process.platform
})
