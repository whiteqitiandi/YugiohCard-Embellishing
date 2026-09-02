import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
  type MenuItemConstructorOptions
} from 'electron'
import type { AppView, InterfaceScale } from '../shared/catalog'
import {
  createEmptyFilterCriteria,
  matchesCardFilter,
  sanitizeFilterCriteria,
  type CardFilterCriteria,
  type SavedCardFilter
} from '../shared/filters'
import { ArtworkStore } from './artwork-store'
import { CatalogDatabase } from './catalog-database'
import { CatalogUpdateService } from './catalog-update-service'

interface ArcanaSettings {
  version: 1
  interfaceScale: InterfaceScale
  savedFilters: SavedCardFilter[]
}

let mainWindow: BrowserWindow | null = null
let filterWindow: BrowserWindow | null = null
let catalog: CatalogDatabase | null = null
let artworkStore: ArtworkStore | null = null
let catalogUpdateService: CatalogUpdateService | null = null
let catalogUpdateInProgress = false
let settings: ArcanaSettings = { version: 1, interfaceScale: 1, savedFilters: [] }
let activeFilter: CardFilterCriteria = createEmptyFilterCriteria()
const isSmokeTest = process.argv.includes('--arcana-smoke')
const smokeUpdate = process.argv
  .find((argument) => argument.startsWith('--arcana-smoke-update='))
  ?.slice('--arcana-smoke-update='.length)
const smokeUnpopular = process.argv
  .find((argument) => argument.startsWith('--arcana-smoke-unpopular='))
  ?.slice('--arcana-smoke-unpopular='.length)
const interfaceScales: InterfaceScale[] = [0.9, 1, 1.15, 1.3]

app.setName('Arcana Archive')
app.setPath(
  'userData',
  isSmokeTest ? join(app.getPath('temp'), 'ArcanaArchiveSmoke') : join(app.getPath('appData'), 'ArcanaArchive')
)

const getSettingsPath = (): string => join(app.getPath('userData'), 'settings.json')

const isInterfaceScale = (value: unknown): value is InterfaceScale =>
  typeof value === 'number' && interfaceScales.includes(value as InterfaceScale)

const sanitizeSavedFilters = (value: unknown): SavedCardFilter[] => {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): SavedCardFilter[] => {
    if (!item || typeof item !== 'object') return []
    const candidate = item as Partial<SavedCardFilter>
    if (
      typeof candidate.id !== 'string' || candidate.id.length > 100 ||
      typeof candidate.name !== 'string' || candidate.name.trim().length === 0 || candidate.name.length > 60
    ) return []
    return [{
      id: candidate.id,
      name: candidate.name.trim(),
      criteria: sanitizeFilterCriteria(candidate.criteria),
      updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date(0).toISOString()
    }]
  })
}

const loadSettings = async (): Promise<void> => {
  try {
    const parsed = JSON.parse(await readFile(getSettingsPath(), 'utf8')) as Partial<ArcanaSettings>
    settings = {
      version: 1,
      interfaceScale: isInterfaceScale(parsed.interfaceScale) ? parsed.interfaceScale : 1,
      savedFilters: sanitizeSavedFilters(parsed.savedFilters)
    }
  } catch (error: unknown) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null
    if (code !== 'ENOENT') console.error('Failed to load Arcana settings:', error)
  }
}

const persistSettings = async (): Promise<void> => {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(getSettingsPath(), `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
}

const loadRenderer = (window: BrowserWindow, route?: string): void => {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    const suffix = route ? `#/${route}` : ''
    void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}${suffix}`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), route ? { hash: `/${route}` } : undefined)
  }
}

const applyInterfaceScale = (window: BrowserWindow): void => {
  window.webContents.setZoomFactor(settings.interfaceScale)
}

const sendToMain = (channel: string, ...args: unknown[]): void => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args)
}

const navigate = (view: AppView): void => {
  sendToMain('app:navigate', view)
  mainWindow?.show()
  mainWindow?.focus()
}

const openFilterWindow = (criteria: unknown = activeFilter): void => {
  activeFilter = sanitizeFilterCriteria(criteria)
  if (filterWindow && !filterWindow.isDestroyed()) {
    filterWindow.show()
    filterWindow.focus()
    return
  }

  filterWindow = new BrowserWindow({
    width: 1080,
    height: 840,
    minWidth: 820,
    minHeight: 640,
    parent: mainWindow ?? undefined,
    title: '進階篩選條件｜Arcana Archive',
    backgroundColor: '#07110f',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  filterWindow.setMenuBarVisibility(false)
  filterWindow.webContents.once('did-finish-load', () => {
    if (filterWindow) applyInterfaceScale(filterWindow)
  })
  filterWindow.once('ready-to-show', () => filterWindow?.show())
  filterWindow.on('closed', () => { filterWindow = null })
  loadRenderer(filterWindow, 'filters')
}

const setInterfaceScale = async (scale: InterfaceScale): Promise<void> => {
  settings.interfaceScale = scale
  for (const window of BrowserWindow.getAllWindows()) applyInterfaceScale(window)
  buildApplicationMenu()
  try {
    await persistSettings()
  } catch (error) {
    console.error('Failed to persist interface scale:', error)
  }
}

const buildApplicationMenu = (): void => {
  const scaleLabels = new Map<InterfaceScale, string>([
    [0.9, '小（90%）'],
    [1, '標準（100%）'],
    [1.15, '大（115%）'],
    [1.3, '特大（130%）']
  ])
  const navigateItem = (label: string, view: AppView, accelerator: string): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: () => navigate(view)
  })

  const template: MenuItemConstructorOptions[] = [
    {
      label: '檔案',
      submenu: [
        { label: '關閉視窗', role: 'close' },
        { type: 'separator' },
        { label: '結束', role: 'quit' }
      ]
    },
    {
      label: '功能',
      submenu: [
        navigateItem('卡片圖鑑', 'catalog', 'CommandOrControl+1'),
        navigateItem('藝術加工', 'studio', 'CommandOrControl+2'),
        navigateItem('卡片創作', 'creator', 'CommandOrControl+3'),
        navigateItem('牌組工房', 'deck', 'CommandOrControl+4'),
        navigateItem('資料更新中心', 'updates', 'CommandOrControl+5')
      ]
    },
    {
      label: '卡片',
      submenu: [
        {
          label: '尋找卡片',
          accelerator: 'CommandOrControl+F',
          click: () => {
            navigate('catalog')
            sendToMain('app:focus-search')
          }
        },
        {
          label: '進階篩選條件…',
          accelerator: 'CommandOrControl+Shift+F',
          click: () => openFilterWindow(activeFilter)
        },
        {
          label: '清除所有篩選',
          accelerator: 'CommandOrControl+Shift+Backspace',
          click: () => {
            activeFilter = createEmptyFilterCriteria()
            navigate('catalog')
            sendToMain('app:clear-filters')
          }
        },
        { type: 'separator' },
        { label: '前往藝術加工', click: () => navigate('studio') }
      ]
    },
    {
      label: '檢視',
      submenu: [
        { label: '重新載入', role: 'reload' },
        { label: '強制重新載入', role: 'forceReload' },
        ...(app.isPackaged ? [] : [{ label: '開發者工具', role: 'toggleDevTools' as const }]),
        { type: 'separator' },
        { label: '全螢幕', role: 'togglefullscreen' }
      ]
    },
    {
      label: '設定',
      submenu: [
        {
          label: '介面文字大小',
          submenu: interfaceScales.map((scale): MenuItemConstructorOptions => ({
            label: scaleLabels.get(scale),
            type: 'radio',
            checked: settings.interfaceScale === scale,
            click: () => { void setInterfaceScale(scale) }
          }))
        },
        { type: 'separator' },
        {
          label: '重設介面文字大小',
          click: () => { void setInterfaceScale(1) }
        }
      ]
    },
    {
      label: '說明',
      submenu: [
        {
          label: '搜尋語法',
          click: () => {
            void dialog.showMessageBox({
              type: 'info',
              title: '搜尋語法',
              message: '卡片密碼支援萬用字元',
              detail: '輸入 *3 可找出尾號為 3 的密碼；? 代表任一個數字。也可輸入「密碼：*3」。'
            })
          }
        },
        {
          label: '關於 Arcana Archive',
          click: () => {
            void dialog.showMessageBox({
              type: 'info',
              title: 'Arcana Archive',
              message: '秘藏決鬥圖鑑｜Arcana Archive',
              detail: `版本 ${app.getVersion()}\n本機優先的遊戲王卡片圖鑑與視覺加工工具。`
            })
          }
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

const createWindow = (): void => {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#07110f',
    autoHideMenuBar: false,
    show: false,
    title: '秘藏決鬥圖鑑｜Arcana Archive',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.webContents.once('did-finish-load', () => {
    if (mainWindow) applyInterfaceScale(mainWindow)
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => { mainWindow = null })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  loadRenderer(mainWindow)
}

const registerIpc = (): void => {
  ipcMain.handle('catalog:list', () => catalog?.listCards() ?? [])
  ipcMain.handle('catalog:stats', () => catalog?.stats())
  ipcMain.handle('catalog:resolve-artwork', async (_event, artworkId: unknown) => {
    if (typeof artworkId !== 'string' || artworkId.length > 120) return null
    const artwork = catalog?.getArtwork(artworkId) ?? null
    return artworkStore?.resolve(artwork) ?? null
  })
  ipcMain.handle('catalog:update-run', async (_event, input: unknown) => {
    if (!catalogUpdateService) throw new Error('卡片更新服務尚未準備完成。')
    if (catalogUpdateInProgress) throw new Error('已有一個卡片更新正在進行，請等候完成。')
    catalogUpdateInProgress = true
    try {
      return await catalogUpdateService.run(input)
    } finally {
      catalogUpdateInProgress = false
    }
  })
  ipcMain.handle('catalog:update-policies', () => catalogUpdateService?.policies() ?? [])
  ipcMain.handle('catalog:set-unpopular', (_event, cardId: unknown, isUnpopular: unknown) => {
    if (!catalog) throw new Error('卡片資料庫尚未準備完成。')
    if (typeof cardId !== 'string' || cardId.length === 0 || cardId.length > 120 || typeof isUnpopular !== 'boolean') {
      throw new Error('冷門卡片標記格式不正確。')
    }
    return catalog.setUnpopular(cardId, isUnpopular)
  })

  ipcMain.handle('filters:open', (_event, criteria: unknown) => openFilterWindow(criteria))
  ipcMain.handle('filters:get-draft', () => activeFilter)
  ipcMain.handle('filters:apply', (_event, criteria: unknown) => {
    activeFilter = sanitizeFilterCriteria(criteria)
    navigate('catalog')
    sendToMain('filters:applied', activeFilter)
  })
  ipcMain.handle('filters:saved-list', () => settings.savedFilters)
  ipcMain.handle('filters:saved-save', async (_event, input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('篩選條件格式不正確。')
    const candidate = input as { id?: unknown; name?: unknown; criteria?: unknown }
    if (typeof candidate.name !== 'string' || candidate.name.trim().length === 0) {
      throw new Error('請輸入常用篩選名稱。')
    }
    const name = candidate.name.trim().slice(0, 60)
    const id = typeof candidate.id === 'string' && settings.savedFilters.some((item) => item.id === candidate.id)
      ? candidate.id
      : randomUUID()
    const saved: SavedCardFilter = {
      id,
      name,
      criteria: sanitizeFilterCriteria(candidate.criteria),
      updatedAt: new Date().toISOString()
    }
    settings.savedFilters = [saved, ...settings.savedFilters.filter((item) => item.id !== id)]
    await persistSettings()
    return settings.savedFilters
  })
  ipcMain.handle('filters:saved-delete', async (_event, id: unknown) => {
    if (typeof id !== 'string') return settings.savedFilters
    settings.savedFilters = settings.savedFilters.filter((item) => item.id !== id)
    await persistSettings()
    return settings.savedFilters
  })
}

app.whenReady().then(async () => {
  await loadSettings()
  catalog = new CatalogDatabase(join(app.getPath('userData'), 'catalog.sqlite'))
  catalogUpdateService = new CatalogUpdateService(catalog)
  artworkStore = new ArtworkStore(app.getPath('userData'))
  await artworkStore.initialize()
  registerIpc()
  if (isSmokeTest) {
    if (smokeUpdate) {
      const match = /^(ocg|tcg):(\d{4}):(\d{1,2})(?::(month|through))?$/.exec(smokeUpdate)
      if (!match) throw new Error('Smoke update format must be region:year:month[:month|through].')
      const imported = await catalogUpdateService.run({
        mode: match[4] ?? 'month',
        region: match[1],
        year: Number(match[2]),
        month: Number(match[3])
      })
      console.log(`[arcana-smoke-update] ${JSON.stringify(imported)}`)
      const requestedMonth = `${match[2]}-${String(Number(match[3])).padStart(2, '0')}`
      const localizedSample = catalog.listCards().find((card) =>
        card.localizationStatus === 'zh-tw-converted' &&
        card.releaseRegion === match[1] &&
        card.releaseDate?.startsWith(requestedMonth)
      ) ?? catalog.listCards().find((card) => card.localizationStatus === 'zh-tw-converted')
      console.log(`[arcana-smoke-localization] ${JSON.stringify(localizedSample == null ? null : {
        passcode: localizedSample.passcode,
        nameZh: localizedSample.nameZh,
        nameEn: localizedSample.nameEn,
        nameJa: localizedSample.nameJa,
        ocgReleaseDate: localizedSample.ocgReleaseDate,
        tcgReleaseDate: localizedSample.tcgReleaseDate,
        requiredLanguages: localizedSample.requiredLanguages,
        supportedLanguages: localizedSample.supportedLanguages,
        localizationSourceName: localizedSample.localizationSourceName,
        ruleTextLabel: localizedSample.ruleTexts[0]?.label
      })}`)
    }
    if (smokeUnpopular) {
      const match = /^([^:]{1,120}):(true|false|read)$/.exec(smokeUnpopular)
      if (!match) throw new Error('Smoke unpopular format must be cardId:true|false|read.')
      const changed = match[2] === 'read' ? null : catalog.setUnpopular(match[1], match[2] === 'true')
      const cards = catalog.listCards()
      const marked = cards.find((card) => card.id === match[1])
      const kindUnion = createEmptyFilterCriteria()
      kindUnion.groups.kind.include = ['monster', 'spell']
      const typeUnion = createEmptyFilterCriteria()
      typeUnion.groups.cardType.include = ['monster:normal', 'spell:quick-play']
      const hidden = createEmptyFilterCriteria()
      hidden.popularity = 'hide'
      const effectTags = Array.from(new Set(cards.flatMap((card) => card.effectTags))).slice(0, 2)
      const effectUnion = createEmptyFilterCriteria()
      effectUnion.groups.effectTag.include = effectTags
      const effectIntersection = createEmptyFilterCriteria()
      effectIntersection.groups.effectTag.include = effectTags
      effectIntersection.groups.effectTag.includeMode = 'all'
      const effectExcluded = createEmptyFilterCriteria()
      effectExcluded.groups.effectTag.exclude = effectTags.slice(0, 1)
      const migratedLegacy = sanitizeFilterCriteria({
        groupMode: 'any',
        groups: {
          monsterType: { include: ['synchro'], exclude: ['normal'], includeMode: 'all' },
          spellType: { include: ['quick-play'], exclude: [], includeMode: 'any' },
          attribute: { include: ['暗', '光'], exclude: ['地'], includeMode: 'all' }
        }
      })
      console.log(`[arcana-smoke-unpopular] ${JSON.stringify({
        changed,
        cardId: match[1],
        isUnpopular: marked?.isUnpopular ?? null,
        kindUnionMatches: cards.filter((card) => matchesCardFilter(card, kindUnion)).length,
        typeUnionMatches: cards.filter((card) => matchesCardFilter(card, typeUnion)).length,
        effectTags,
        effectUnionMatches: cards.filter((card) => matchesCardFilter(card, effectUnion)).length,
        effectIntersectionMatches: cards.filter((card) => matchesCardFilter(card, effectIntersection)).length,
        effectExcludedMatches: cards.filter((card) => matchesCardFilter(card, effectExcluded)).length,
        migratedLegacyTypes: migratedLegacy.groups.cardType.include,
        migratedAttributeMode: migratedLegacy.groups.attribute.includeMode,
        migratedAttributeExcludes: migratedLegacy.groups.attribute.exclude,
        hiddenMatches: cards.filter((card) => matchesCardFilter(card, hidden)).length,
        total: cards.length
      })}`)
    }
    console.log(`[arcana-smoke] ${JSON.stringify(catalog.stats())}`)
    app.quit()
    return
  }
  buildApplicationMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  artworkStore?.close()
  artworkStore = null
  catalog?.close()
  catalog = null
  catalogUpdateService = null
})
