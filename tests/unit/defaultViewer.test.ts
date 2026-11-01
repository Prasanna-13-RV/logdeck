import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  openExternal: vi.fn(),
  stat: vi.fn(),
  app: { isPackaged: true }
}))
vi.mock('electron', () => ({ app: mocks.app, shell: { openExternal: mocks.openExternal } }))
vi.mock('node:util', () => ({ promisify: () => mocks.execute }))
vi.mock('node:fs/promises', () => ({ stat: mocks.stat }))

import { changeWindowsIntegration } from '../../src/main/windowsIntegration'
import { windowsDefaultAppsUrl } from '../../shared/windowsIntegration'

describe('default viewer settings', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.app.isPackaged = true
    mocks.stat.mockResolvedValue({ isFile: () => true })
    mocks.execute.mockResolvedValue({ stdout: 'null' })
    mocks.openExternal.mockResolvedValue(undefined)
  })

  it.skipIf(process.platform !== 'win32')('registers before opening the per-user Windows settings page without replacing UserChoice', async () => {
    await changeWindowsIntegration('defaults')
    const args = mocks.execute.mock.calls[0][1] as string[]
    const script = Buffer.from(args.at(-1)!, 'base64').toString('utf16le')
    expect(script).toContain('RegisteredApplications')
    expect(script).toContain('OpenWithProgids')
    expect(script).not.toContain('UserChoice')
    expect(mocks.openExternal).toHaveBeenCalledWith(windowsDefaultAppsUrl)
    expect(mocks.execute.mock.invocationCallOrder[0]).toBeLessThan(mocks.openExternal.mock.invocationCallOrder[0])
  })

  it.skipIf(process.platform !== 'win32')('surfaces registration and Windows launcher failures instead of claiming defaults changed', async () => {
    mocks.execute.mockRejectedValueOnce(new Error('Registration failed'))
    await expect(changeWindowsIntegration('defaults')).rejects.toThrow('Registration failed')
    expect(mocks.openExternal).not.toHaveBeenCalled()
    mocks.openExternal.mockRejectedValueOnce(new Error('Settings unavailable'))
    await expect(changeWindowsIntegration('defaults')).rejects.toThrow('Settings unavailable')
  })

  it('rejects the action in an unpackaged application', async () => {
    mocks.app.isPackaged = false
    await expect(changeWindowsIntegration('defaults')).rejects.toThrow('packaged Windows app')
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })
})
