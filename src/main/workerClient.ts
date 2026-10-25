import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import type { Result, SessionInfo } from '../../shared/contracts'

export class FileWorker {
  private worker: Worker
  private nextId = 0
  private pending = new Map<number, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timer: NodeJS.Timeout
  }>()
  private failed?: Error

  constructor(cachePath: string, onProgress: (info: SessionInfo) => void, private onFailure: (error: Error) => void) {
    this.worker = new Worker(join(__dirname, 'logWorker.js'), { workerData: { cachePath } })
    this.worker.on('message', (message: Result<unknown> & { requestId: number; event?: string; info: SessionInfo }) => {
      if (message.event === 'progress') { onProgress(message.info); return }
      const job = this.pending.get(message.requestId)
      if (!job) return
      this.pending.delete(message.requestId)
      clearTimeout(job.timer)
      if (message.ok) job.resolve(message.value)
      else job.reject(new Error(message.error))
    })
    this.worker.on('error', error => this.fail(error))
    this.worker.on('exit', code => this.fail(new Error(`File worker stopped (${code}). Restart LogDeck to continue.`)))
  }

  private fail(error: Error) {
    if (this.failed) return
    this.failed = error
    for (const job of this.pending.values()) {
      clearTimeout(job.timer)
      job.reject(error)
    }
    this.pending.clear()
    this.onFailure(error)
  }

  request<T>(type: string, id: string, payload: Record<string, unknown> = {}): Promise<T> {
    if (this.failed) return Promise.reject(this.failed)
    if (this.pending.size >= 32) return Promise.reject(new Error('File worker is busy. Wait for the current operation.'))
    const requestId = ++this.nextId
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error('File operation timed out. Close and reopen this file, or restart LogDeck.'))
      }, 30_000)
      this.pending.set(requestId, { resolve: value => resolve(value as T), reject, timer })
      this.worker.postMessage({ type, id, requestId, ...payload })
    })
  }

  async stop() { await this.worker.terminate() }
}
