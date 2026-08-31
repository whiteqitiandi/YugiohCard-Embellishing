import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { ArtworkStore } from './artwork-store'
import { CatalogDatabase } from './catalog-database'

let mainWindow: BrowserWindow | null = null
let catalog: CatalogDatabase | null = null
let artworkStore: ArtworkStore | null = null
const isSmokeTest = process.argv.includes('--arcana-smoke')

app.setName('Arcana Archive')
app.setPath(
  'userData',
  isSmokeTest ? join(app.getPath('temp'), 'ArcanaArchiveSmoke') : join(app.getPath('appData'), 'ArcanaArchive')
)

const createWindow = (): void => {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#07110f',
    autoHideMenuBar: true,
    show: false,
    title: '秘藏決鬥圖鑑｜Arcana Archive',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

const registerIpc = (): void => {
  ipcMain.handle('catalog:list', () => catalog?.listCards() ?? [])
  ipcMain.handle('catalog:stats', () => catalog?.stats())
  ipcMain.handle('catalog:resolve-artwork', async (_event, artworkId: unknown) => {
    if (typeof artworkId !== 'string' || artworkId.length > 120) return null
    const artwork = catalog?.getArtwork(artworkId) ?? null
    return artworkStore?.resolve(artwork) ?? null
  })
}

app.whenReady().then(async () => {
  catalog = new CatalogDatabase(join(app.getPath('userData'), 'catalog.sqlite'))
  artworkStore = new ArtworkStore(app.getPath('userData'))
  await artworkStore.initialize()
  registerIpc()
  if (isSmokeTest) {
    console.log(`[arcana-smoke] ${JSON.stringify(catalog.stats())}`)
    app.quit()
    return
  }
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
})
