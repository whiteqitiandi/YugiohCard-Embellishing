import type { CatalogUpdateControl, CatalogUpdateState } from '../shared/catalog'
import type { CatalogUpdateService } from './catalog-update-service'
import type { CatalogPendingRecord } from './catalog-database'
import { validateCatalogUpdateRequest } from './ygoprodeck-source'
import { waitForUpdate } from './update-control'

// Application safety policy, in addition to each source's per-request throttling.
export const UPDATE_BATCH_COOLDOWN_MS = 30_000

export class CatalogUpdateJob {
  private state: CatalogUpdateState = {
    revision: 0, status: 'idle', request: null, batchNumber: 0, nextBatchAt: null,
    cooldownMs: UPDATE_BATCH_COOLDOWN_MS, progress: null, fetched: 0, inserted: 0,
    updated: 0, deferred: 0, message: '', lastResult: null
  }
  private worker: Promise<void> | null = null
  private controller: AbortController | null = null
  private stopRequested: 'pause' | 'cancel' | null = null
  private notBefore = 0
  private repairRecords: CatalogPendingRecord[] = []
  private repairIndex = 0

  constructor(
    private readonly service: Pick<CatalogUpdateService, 'run' | 'getProgress' | 'repairQueue'>,
    private readonly onState: (state: CatalogUpdateState) => void
  ) {}

  snapshot(): CatalogUpdateState {
    return structuredClone(this.state)
  }

  private publish(patch: Partial<CatalogUpdateState>): void {
    this.state = { ...this.state, ...patch, revision: this.state.revision + 1 }
    this.onState(this.snapshot())
  }

  start(value: unknown): CatalogUpdateState {
    if (this.worker || this.state.status === 'paused' || this.state.status === 'blocked') {
      throw new Error('已有更新作業，請先繼續或取消目前作業。')
    }
    const request = validateCatalogUpdateRequest(value)
    this.repairRecords = request.mode === 'repair' ? this.service.repairQueue(request) : []
    this.repairIndex = 0
    const progress = this.service.getProgress(request)
    this.publish({
      status: 'running', request, batchNumber: 0, nextBatchAt: null,
      progress: request.mode === 'repair' ? { ...progress, percent: 0, monthProcessed: 0, monthTotal: this.repairRecords.length } : progress,
      fetched: 0, inserted: 0, updated: 0, deferred: 0,
      lastResult: null, message: '準備依來源流量政策更新…'
    })
    this.launch()
    return this.snapshot()
  }

  control(value: unknown): CatalogUpdateState {
    if (value !== 'pause' && value !== 'resume' && value !== 'cancel') throw new Error('更新控制指令不正確。')
    const control: CatalogUpdateControl = value
    if (control === 'resume') {
      if (this.worker || !this.state.request || !['paused', 'blocked'].includes(this.state.status)) {
        throw new Error('目前沒有可繼續的暫停作業。')
      }
      this.publish({ status: 'running', message: '正在接續已保存的進度…' })
      this.launch()
    } else if (this.worker) {
      // A late pause must not turn an already requested cancellation into a pause.
      if (this.stopRequested === 'cancel') return this.snapshot()
      this.stopRequested = control
      this.publish({
        status: control === 'pause' ? 'pausing' : 'cancelling', nextBatchAt: null,
        message: control === 'pause' ? '正在暫停並保留已保存的進度…' : '正在取消後續更新；已匯入資料會保留…'
      })
      this.controller?.abort()
    } else if (control === 'cancel' && ['paused', 'blocked'].includes(this.state.status)) {
      this.publish({ status: 'cancelled', nextBatchAt: null, message: '已取消作業，已匯入資料與續傳位置仍保留。' })
    }
    return this.snapshot()
  }

  private launch(): void {
    this.stopRequested = null
    this.controller = new AbortController()
    // Defer work until the single-worker lock is installed, including cached completion.
    this.worker = Promise.resolve().then(() => this.execute(this.controller!.signal))
  }

  async settled(): Promise<void> {
    await this.worker
  }

  shutdown(): void {
    this.stopRequested = 'cancel'
    this.controller?.abort()
  }

  private async execute(signal: AbortSignal): Promise<void> {
    const request = this.state.request!
    let attemptedBatch = false
    try {
      while (true) {
        signal.throwIfAborted()
        if (this.notBefore > Date.now()) {
          this.publish({ status: 'cooling', nextBatchAt: this.notBefore, message: '安全冷卻中，倒數結束後會自動接續下一批。' })
          await waitForUpdate(this.notBefore - Date.now(), signal)
        }
        signal.throwIfAborted()
        const before = this.service.getProgress(request)
        const repairBefore = this.repairIndex
        const base = { fetched: this.state.fetched, inserted: this.state.inserted, updated: this.state.updated, deferred: this.state.deferred }
        this.publish({
          status: 'running', nextBatchAt: null, batchNumber: this.state.batchNumber + 1,
          message: request.mode === 'repair' ? '正在補查缺漏清單；每張卡片本輪只嘗試一次…' : '正在更新；資料缺漏會另存清單，不中斷後續卡片。'
        })
        attemptedBatch = true
        const result = await this.service.run(request, {
          signal,
          repairRecords: request.mode === 'repair' ? this.repairRecords.slice(repairBefore) : undefined,
          onProgress: (progress) => {
            if (request.mode === 'repair') {
              this.repairIndex = repairBefore + progress.fetched
              progress = { ...progress, monthProcessed: this.repairIndex, monthTotal: this.repairRecords.length,
                percent: this.repairRecords.length ? this.repairIndex / this.repairRecords.length * 100 : 100 }
            }
            const previous = this.state.progress
            // Refetching a saved month must not make its known progress jump backwards.
            if (progress.monthTotal == null && previous?.currentMonth === progress.currentMonth) {
              progress = { ...progress, monthTotal: previous.monthTotal, percent: Math.max(previous.percent, progress.percent) }
            }
            this.publish({
              progress,
              fetched: base.fetched + progress.fetched,
              inserted: base.inserted + progress.inserted,
              updated: base.updated + progress.updated,
              deferred: base.deferred + progress.deferred
            })
          }
        })
        this.notBefore = Date.now() + UPDATE_BATCH_COOLDOWN_MS
        this.publish({
          lastResult: result, fetched: base.fetched + result.fetched,
          inserted: base.inserted + result.inserted, updated: base.updated + result.updated,
          deferred: base.deferred + result.missingRequiredLanguages
        })
        signal.throwIfAborted()
        if (request.mode === 'month' || result.stoppedBy === 'complete') {
          const label = request.mode === 'through' ? '指定範圍已掃描完成' : request.mode === 'repair' ? '本輪缺漏補查已完成' : '單月更新作業已結束'
          this.publish({ status: 'completed', nextBatchAt: null,
            ...(request.mode === 'repair' && this.state.progress ? { progress: { ...this.state.progress, percent: 100 } } : {}),
            message: `${label}。${result.pendingCards > 0 ? `此區域仍有 ${result.pendingCards} 張缺漏記錄，可日後補查，不會自動反覆重試。` : '目前此區域沒有待補的語系缺漏。'}` })
          return
        }
        const after = this.service.getProgress(request)
        if (
          (request.mode !== 'repair' || repairBefore === this.repairIndex) &&
          before.coverage.scannedThrough === after.coverage.scannedThrough &&
          before.coverage.resumeMonth === after.coverage.resumeMonth &&
          before.coverage.resumeOffset === after.coverage.resumeOffset
        ) {
          this.publish({ status: 'blocked', nextBatchAt: null, message: '來源上限內無法推進續傳位置，已自動暫停，避免重複請求同一批資料。' })
          return
        }
      }
    } catch (error: unknown) {
      if (attemptedBatch) this.notBefore = Math.max(this.notBefore, Date.now() + UPDATE_BATCH_COOLDOWN_MS)
      if (signal.aborted) {
        const cancelled = this.stopRequested === 'cancel'
        this.publish({
          status: cancelled ? 'cancelled' : 'paused', nextBatchAt: null,
          message: cancelled ? '已取消作業，已匯入資料與續傳位置仍保留。' : '已暫停；按「繼續更新」可從已保存的位置接續。'
        })
      } else {
        this.publish({
          status: 'blocked', nextBatchAt: null,
          message: `${error instanceof Error ? error.message : '來源更新失敗。'} 已自動暫停；先前匯入資料與續傳位置仍保留，請確認來源／網路恢復後再繼續。`
        })
      }
    } finally {
      this.controller = null
      this.worker = null
    }
  }
}
