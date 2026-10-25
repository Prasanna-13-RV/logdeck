import { expect, type Page } from '@playwright/test'
import type { ExportRequest } from '../../shared/contracts'

export async function expectFilterResults(page: Page, id: string, matches: number) {
  await expect.poll(async () => {
    const result = await page.evaluate(id => window.logdeck.searchStatus(id), id)
    return result.ok ? { status: result.value.status, matches: result.value.matches, error: result.value.error } : result.error
  }, { timeout: 20_000 }).toEqual({ status: 'ready', matches, error: undefined })
}

export async function expectReady(page: Page, id: string) {
  await expect.poll(async () => {
    const result = await page.evaluate(() => window.logdeck.getSessions())
    return result.ok && result.value.find(info => info.id === id)?.status
  }, { timeout: 20_000 }).toBe('ready')
}

export async function exportRecords(page: Page, request: ExportRequest) {
  const result = await page.evaluate(request => window.logdeck.exportRecords(request), request)
  if (!result.ok) throw new Error(result.error)
  if (!result.value) throw new Error('Synthetic export destination was cancelled.')
  await expect.poll(async () => {
    const result = await page.evaluate(id => window.logdeck.exportStatus(id), request.id)
    return result.ok ? result.value.status : result.error
  }).toBe('ready')
}
