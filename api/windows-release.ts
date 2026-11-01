import { publicRelease } from '../shared/publicRelease'
import type { IncomingMessage, ServerResponse } from 'node:http'

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  const result = await publicRelease(new Request('https://logdeck.invalid/updates/windows.json', { method: request.method ?? 'GET' }))
  response.statusCode = result.status
  result.headers.forEach((value, key) => response.setHeader(key, value))
  response.end(await result.text())
}
