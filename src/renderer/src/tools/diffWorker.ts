import { lineDifferences, type DiffOptions } from './diff'

self.onmessage = (event: MessageEvent<{ left: string; right: string; options: DiffOptions }>) => {
  try { self.postMessage({ ok: true, differences: lineDifferences(event.data.left, event.data.right, event.data.options) }) }
  catch (error) { self.postMessage({ ok: false, error: error instanceof Error ? error.message : 'Diff failed.' }) }
}
