import { test, expect, _electron as electron, type Locator } from '@playwright/test'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

async function expectAligned(left: Locator, right: Locator, text: string) {
  const line = (editor: Locator) => editor.locator('.cm-line').filter({ hasText: new RegExp(`^${text}$`) })
  await expect(line(left)).toBeVisible()
  await expect(line(right)).toBeVisible()
  await expect.poll(async () => {
    const a = await line(left).boundingBox()
    const b = await line(right).boundingBox()
    return a && b ? Math.abs(a.y - b.y) : Infinity
  }).toBeLessThan(1)
}

test('focused editors show blinking carets and Compare fills the resized workspace', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'logdeck-compare-layout-'))
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  env.LOGDECK_TEST_USER_DATA = join(directory, 'profile')
  delete env.ELECTRON_RUN_AS_NODE
  const desktop = await electron.launch({ args: [resolve('.')], env })
  try {
    const page = await desktop.firstWindow()
    await page.getByRole('button', { name: 'Compare', exact: true }).click()
    const compare = page.getByRole('main', { name: 'Text Compare', exact: true })
    for (const side of ['Left', 'Right']) {
      const editor = compare.getByLabel(`${side} comparison text`)
      await editor.click()
      const focused = compare.getByLabel(`${side} document`).locator('.cm-editor.cm-focused')
      await expect(focused.locator('.cm-cursor')).toBeVisible()
      expect(await focused.locator('.cm-cursor').evaluate(node => parseFloat(getComputedStyle(node).borderLeftWidth))).toBeGreaterThan(0)
      await expect.poll(() => focused.locator('.cm-cursorLayer').evaluate(node => {
        const style = getComputedStyle(node)
        return style.animationName.startsWith('cm-blink') && parseFloat(style.animationDuration) > 0 && style.animationIterationCount === 'infinite'
      })).toBe(true)
      await editor.pressSequentially(`${side} editable text`)
      await expect(editor).toContainText(`${side} editable text`)
      await editor.press('Control+a')
      await expect(focused.locator('.cm-selectionBackground').first()).toBeVisible()
      await editor.press('ArrowRight')
      await expect(focused.locator('.cm-cursor')).toBeVisible()
    }
    let previousHeight = 0
    for (const [width, height] of [[1440, 900], [1440, 1200], [940, 640]]) {
      await desktop.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size[0], size[1]), [width, height])
      await expect.poll(() => page.evaluate(() => innerHeight)).toBe(height)
      await expect.poll(() => compare.evaluate(node => {
        const last = node.lastElementChild!.getBoundingClientRect()
        return node.getBoundingClientRect().bottom - last.bottom
      })).toBeLessThan(30)
      const paneHeight = await compare.locator('.cm-editor').first().evaluate(node => node.getBoundingClientRect().height)
      if (height === 900) {
        expect(paneHeight).toBeGreaterThan(450)
        previousHeight = paneHeight
      } else if (height === 1200) expect(paneHeight - previousHeight).toBeGreaterThan(250)
      for (const editor of await compare.locator('.cm-editor').all()) {
        await expect(editor).toBeInViewport()
        expect(await editor.evaluate(node => Math.abs(node.getBoundingClientRect().height - node.parentElement!.clientHeight))).toBeLessThan(2)
      }
      await expect(compare.getByRole('button', { name: 'Next difference', exact: true })).toBeInViewport()
      expect(await compare.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    }
    await page.screenshot({ path: test.info().outputPath('full-height-compare.png') })
  } finally {
    await desktop.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1 })
    await desktop.close()
    await rm(directory, { recursive: true, force: true })
  }
})

for (const shorter of ['left', 'right'] as const) {
  test(`middle deletion aligns five visual blank rows on the ${shorter} without changing files`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'logdeck-alignment-'))
    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    env.LOGDECK_TEST_USER_DATA = join(directory, 'profile')
    delete env.ELECTRON_RUN_AS_NODE
    const desktop = await electron.launch({ args: [resolve('.')], env })
    try {
      const full = Array.from({ length: 10 }, (_, i) => `line-${i + 1}`)
      const short = [full[0], full[1], ...full.slice(7)]
      const texts = shorter === 'left' ? [short.join('\n'), full.join('\n')] : [full.join('\n'), short.join('\n')]
      const paths = [join(directory, 'left.txt'), join(directory, 'right.txt')]
      await Promise.all(paths.map((path, i) => writeFile(path, texts[i])))
      const page = await desktop.firstWindow()
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.getByRole('button', { name: 'Compare', exact: true }).click()
      const compare = page.getByRole('main', { name: 'Text Compare', exact: true })
      for (const [index, side] of ['left', 'right'].entries()) {
        await desktop.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, paths[index])
        await compare.getByRole('button', { name: `Open ${side}`, exact: true }).click()
      }
      await expect(compare.getByRole('status')).toContainText('Complete · 1 changed blocks')
      const left = compare.getByLabel('Left comparison text')
      const right = compare.getByLabel('Right comparison text')
      const shortPane = compare.getByLabel(`${shorter === 'left' ? 'Left' : 'Right'} document`)
      const gap = shortPane.locator('.compare-alignment-gap')
      await expect(gap).toHaveAttribute('data-rows', '5')
      await expect(gap).toHaveCSS('height', '100px')
      await expect(shortPane.getByLabel(`${shorter === 'left' ? 'Left' : 'Right'} comparison text`).locator('.cm-line')).toHaveCount(5)
      await expect(shortPane.locator('.compare-format')).toContainText('5 lines')
      await expectAligned(left, right, 'line-8')
      await expectAligned(left, right, 'line-10')
      for (const name of ['Next difference', 'Previous difference']) {
        await compare.getByRole('button', { name, exact: true }).click()
        await expect(gap).toHaveClass(/compare-selected-difference/)
        await expect(compare.locator('.compare-changed-line.compare-selected-difference')).toHaveCount(5)
        await expect(left.locator('.cm-line').filter({ hasText: /^line-8$/ })).not.toHaveClass(/compare-selected-difference/)
        await expect(right.locator('.cm-line').filter({ hasText: /^line-8$/ })).not.toHaveClass(/compare-selected-difference/)
      }
      await compare.getByRole('button', { name: `Save ${shorter}`, exact: true }).click()
      expect(await readFile(paths[shorter === 'left' ? 0 : 1], 'utf8')).toBe(short.join('\n'))
      await compare.getByRole('button', { name: `Copy change ${shorter === 'left' ? 'right to left' : 'left to right'}`, exact: true }).click()
      await expect(compare.getByRole('status')).toContainText('Complete · 0 changed blocks')
      await expect(compare.locator('.compare-alignment-gap')).toHaveCount(0)
      await compare.getByRole('button', { name: `Undo ${shorter}`, exact: true }).click()
      await expect(compare.getByRole('status')).toContainText('Complete · 1 changed blocks')
      await expect(gap).toHaveAttribute('data-rows', '5')
      await expectAligned(left, right, 'line-8')
      await page.screenshot({ path: test.info().outputPath('aligned-middle-deletion.png') })
      expect(errors).toEqual([])
    } finally {
      await desktop.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1 })
      await desktop.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
}

test('navigation highlights the current block and aligns beginning, replacement and end gaps', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'logdeck-alignment-edges-'))
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  env.LOGDECK_TEST_USER_DATA = join(directory, 'profile')
  delete env.ELECTRON_RUN_AS_NODE
  const desktop = await electron.launch({ args: [resolve('.')], env })
  try {
    const paths = [join(directory, 'left.txt'), join(directory, 'right.txt')]
    await Promise.all([
      writeFile(paths[0], 'begin-left\ncommon-a\nold\ncommon-b\ncommon-c'),
      writeFile(paths[1], 'common-a\nnew-one\nnew-two\ncommon-b\ncommon-c\nend-right')
    ])
    const page = await desktop.firstWindow()
    await page.getByRole('button', { name: 'Compare', exact: true }).click()
    const compare = page.getByRole('main', { name: 'Text Compare', exact: true })
    for (const [index, side] of ['left', 'right'].entries()) {
      await desktop.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, paths[index])
      await compare.getByRole('button', { name: `Open ${side}`, exact: true }).click()
    }
    await expect(compare.getByRole('status')).toContainText('Complete · 3 changed blocks')
    const left = compare.getByLabel('Left comparison text')
    const right = compare.getByLabel('Right comparison text')
    for (const text of ['common-a', 'common-b', 'common-c']) await expectAligned(left, right, text)
    await expect(right.locator('.compare-alignment-gap.compare-selected-difference')).toHaveCount(1)
    await compare.getByRole('button', { name: 'Next difference', exact: true }).click()
    await expect(compare.getByRole('status')).toContainText('2 selected')
    await expect(left.locator('.compare-changed-line.compare-selected-difference')).toHaveText(['old'])
    await expect(right.locator('.compare-changed-line.compare-selected-difference')).toHaveText(['new-one', 'new-two'])
    await expect(left.locator('.compare-alignment-gap.compare-selected-difference')).toHaveCount(1)
    await expect(right.locator('.compare-alignment-gap.compare-selected-difference')).toHaveCount(0)
    await compare.getByRole('button', { name: 'Next difference', exact: true }).click()
    await expect(compare.getByRole('status')).toContainText('3 selected')
    await expect(right.locator('.compare-changed-line.compare-selected-difference')).toHaveText(['end-right'])
    await expect(left.locator('.compare-alignment-gap.compare-selected-difference')).toHaveCount(1)
    await compare.getByRole('button', { name: 'Next difference', exact: true }).click()
    await expect(compare.getByRole('status')).toContainText('1 selected')
    await compare.getByRole('button', { name: 'Previous difference', exact: true }).click()
    await expect(compare.getByRole('status')).toContainText('3 selected')
  } finally {
    await desktop.close()
    await rm(directory, { recursive: true, force: true })
  }
})
