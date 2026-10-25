import { Worker } from 'node:worker_threads'

export class RegexJob {
  private worker: Worker
  private pending?: { resolve: (matches: boolean[]) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  private stopped = false

  constructor(pattern: string, caseSensitive: boolean) {
    try { new RegExp(pattern, caseSensitive ? 'u' : 'iu') }
    catch (error) { throw new Error(`Invalid regular expression: ${String(error)}`) }
    this.worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      const expression = new RegExp(workerData.pattern, workerData.flags);
      parentPort.on('message', rows => parentPort.postMessage(rows.map(row => expression.test(row))));
    `, { eval: true, workerData: { pattern, flags: caseSensitive ? 'u' : 'iu' }, resourceLimits: { maxOldGenerationSizeMb: 32 } })
    this.worker.on('message', (matches: boolean[]) => {
      const job = this.pending
      if (!job) return
      this.pending = undefined
      clearTimeout(job.timer)
      job.resolve(matches)
    })
    this.worker.on('error', error => this.stop(error))
    this.worker.on('exit', () => this.stop(new Error('Regular expression worker stopped.')))
  }

  test(rows: string[]): Promise<boolean[]> {
    if (this.stopped) return Promise.reject(new Error('Regular expression job was cancelled.'))
    if (this.pending) return Promise.reject(new Error('Regular expression worker is busy.'))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.stop(new Error('Regular expression timed out (500 ms batch watchdog). Simplify the pattern.')), 500)
      this.pending = { resolve, reject, timer }
      this.worker.postMessage(rows)
    })
  }

  stop(error = new Error('Regular expression job was cancelled.')) {
    if (this.stopped) return
    this.stopped = true
    if (this.pending) {
      clearTimeout(this.pending.timer)
      this.pending.reject(error)
      this.pending = undefined
    }
    void this.worker.terminate()
  }
}
