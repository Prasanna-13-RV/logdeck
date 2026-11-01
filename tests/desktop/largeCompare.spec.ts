import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('8000-line comparison scrolls both ways and copies every changed line', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'logdeck-large-compare-'))
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  env.LOGDECK_TEST_USER_DATA = join(directory, 'profile')
  delete env.ELECTRON_RUN_AS_NODE
  const desktop = await electron.launch({ args: [resolve('.')], env })
  try {
    const page = await desktop.firstWindow()
    const left = Array.from({ length: 8000 }, (_, i) => `left ${i} ${'wide '.repeat(40)}`).join('\n')
    const right = Array.from({ length: 7000 }, (_, i) => `right ${i} ${'wide '.repeat(40)}`).join('\n')
    const paths = [join(directory, 'left.txt'), join(directory, 'right.txt')]
    await Promise.all([writeFile(paths[0], left), writeFile(paths[1], right)])
    await page.getByRole('button', { name: 'Compare', exact: true }).click()
    const compare = page.getByRole('main', { name: 'Text Compare', exact: true })
    for (const [index, side] of ['left', 'right'].entries()) {
      await desktop.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, paths[index])
      await compare.getByRole('button', { name: `Open ${side}`, exact: true }).click()
    }
    await expect(compare.getByRole('status')).toContainText('Complete · 1 changed blocks')
    await expect(compare.getByRole('status')).toContainText('Coarse comparison')
    const scrolls = compare.locator('.cm-scroller')
    for (const index of [0, 1]) {
      await scrolls.nth(index).evaluate((node, index) => { node.scrollTop = index ? 4000 : 2000; node.scrollLeft = index ? 200 : 100 }, index)
      await expect.poll(async () => {
        const values = await scrolls.evaluateAll(nodes => nodes.map(node => ({
          ratio: node.scrollTop / (node.scrollHeight - node.clientHeight), left: node.scrollLeft
        })))
        return Math.abs(values[0].ratio - values[1].ratio)
      }).toBeLessThan(0.001)
      await expect.poll(async () => scrolls.evaluateAll(nodes => Math.abs(nodes[0].scrollLeft - nodes[1].scrollLeft))).toBeLessThan(1)
    }
    await compare.getByRole('button', { name: 'Copy change left to right' }).click()
    await expect(compare.getByRole('status')).toContainText('Complete · 0 changed blocks')
    await expect(compare.getByLabel('Right document').locator('.compare-format')).toContainText('8,000 lines')
    await expect(compare.getByLabel('Right document').locator('strong')).toContainText('*')
    await compare.getByRole('button', { name: 'Save right', exact: true }).click()
    await expect(compare.getByLabel('Right document').locator('strong')).toHaveText('right.txt')
    await expect.poll(async () => await readFile(paths[1], 'utf8') === left).toBe(true)
  } finally {
    await desktop.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1 })
    await desktop.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('unequal repetitive logs highlight only changed lines and words in the two editors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'logdeck-sparse-compare-'))
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  env.LOGDECK_TEST_USER_DATA = join(directory, 'profile')
  delete env.ELECTRON_RUN_AS_NODE
  const desktop = await electron.launch({ args: [resolve('.')], env })
  try {
    const page = await desktop.firstWindow()
    const left = Array.from({ length: 7759 }, (_, i) => i % 40 === 0 ? `SECTION_${i}` : `SETTING_${i % 40}=1`)
    left[15] = `${'A'.repeat(20)}old value${'Z'.repeat(5000)}`
    const right = [...left]
    right[0] = 'SECTION_CHANGED'
    right[14] = 'SETTING_14=3'
    right[15] = `${'A'.repeat(20)}new value${'Z'.repeat(5000)}`
    right[7000] = 'SETTING_CHANGED=2'
    right.splice(3000, 0, ...Array.from({ length: 2339 }, (_, i) => `ADDED_${i}`))
    const paths = [join(directory, 'left.txt'), join(directory, 'right.txt')]
    await Promise.all([writeFile(paths[0], left.join('\n')), writeFile(paths[1], right.join('\n'))])
    await page.getByRole('button', { name: 'Compare', exact: true }).click()
    const compare = page.getByRole('main', { name: 'Text Compare', exact: true })
    for (const [index, side] of ['left', 'right'].entries()) {
      await desktop.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, paths[index])
      await compare.getByRole('button', { name: `Open ${side}`, exact: true }).click()
    }
    await expect(compare.getByRole('status')).toContainText('Complete · 4 changed blocks')
    await expect(compare.locator('.difference-preview')).toHaveCount(0)
    await expect(compare.locator('.compare-code-editor')).toHaveCount(2)
    for (const side of ['Left', 'Right']) {
      const editor = compare.getByLabel(`${side} comparison text`)
      for (const line of await editor.locator('.cm-line').filter({ hasText: /^SETTING_2=1$/ }).all()) {
        await expect(line).not.toHaveClass(/compare-changed-line/)
      }
      await expect(editor.locator('.cm-line').filter({ hasText: /^SETTING_14=/ })).toHaveClass(/compare-changed-line/)
      await expect(editor.locator('.compare-changed-word').filter({ hasText: /^[13]$/ })).toHaveCount(1)
      await expect(editor.locator('.compare-changed-word').filter({ hasText: side === 'Left' ? /^old$/ : /^new$/ })).toHaveCount(1)
    }
    await compare.getByRole('button', { name: 'Next difference', exact: true }).click()
    await compare.getByRole('button', { name: 'Next difference', exact: true }).click()
    await expect(compare.getByLabel('Selected difference')).toContainText('Left insertion at line 3001')
    await expect(compare.getByLabel('Left comparison text').locator('.compare-changed-line')).toHaveCount(0)
    await expect(compare.getByLabel('Right comparison text').locator('.compare-changed-line').first()).toBeVisible()
    const selectedGap = compare.getByLabel('Left document').locator('.compare-alignment-gap.compare-selected-difference')
    await expect(selectedGap).toHaveAttribute('data-rows', '2339')
    const added = compare.getByLabel('Right comparison text').locator('.compare-selected-difference').filter({ hasText: /^ADDED_0$/ })
    await expect(added).toBeVisible()
    await expect.poll(async () => {
      const gap = await selectedGap.boundingBox()
      const line = await added.boundingBox()
      return gap && line ? Math.abs(gap.y - line.y) : Infinity
    }).toBeLessThan(1)
    await page.screenshot({ path: test.info().outputPath('sparse-inline-differences.png') })
    await compare.getByRole('button', { name: 'Next difference', exact: true }).click()
    await expect(compare.getByRole('status')).toContainText('4 selected')
    const selectedLines = ['Left', 'Right'].map(side => compare.getByLabel(`${side} comparison text`).locator('.compare-changed-line.compare-selected-difference'))
    for (const line of selectedLines) await expect(line).toBeVisible()
    await expect.poll(async () => {
      const a = await selectedLines[0].boundingBox()
      const b = await selectedLines[1].boundingBox()
      return a && b ? Math.abs(a.y - b.y) : Infinity
    }).toBeLessThan(1)
  } finally {
    await desktop.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1 })
    await desktop.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('official download opens the public website without manifest configuration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'logdeck-download-'))
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  env.LOGDECK_TEST_USER_DATA = join(directory, 'profile')
  delete env.ELECTRON_RUN_AS_NODE
  const desktop = await electron.launch({ args: [resolve('.')], env })
  try {
    const page = await desktop.firstWindow()
    await page.waitForFunction(() => Boolean(window.logdeck))
    await desktop.evaluate(({ shell }) => {
      shell.openExternal = async url => { process.env.LOGDECK_TEST_OPENED_URL = url }
    })
    await page.getByRole('button', { name: 'Updates', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Official download page', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Official download page', exact: true }).click()
    await expect.poll(() => desktop.evaluate(() => process.env.LOGDECK_TEST_OPENED_URL)).toBe('https://logdeck.netlify.app')
    expect(await desktop.evaluate(() => process.env.LOGDECK_TEST_OPENED_URL)).toBe('https://logdeck.netlify.app')
  } finally {
    await desktop.close()
    await rm(directory, { recursive: true, force: true })
  }
})
