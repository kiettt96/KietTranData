// 0.6.1, thanh tiến độ 2.2: bấm Ẩn trên band chỉ có tác dụng trong mục tiêu hiện tại; mục tiêu mới thì band hiện lại.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { COMPLEX_PROMPT, base, submit } from '../support/engine'
import { RESUME } from '../support/quota'

const bandProps = { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 6 }, view: {} }

/** Band ẩn thì mod nhường cho engine; khung test không có band của engine nên mount báo lỗi, coi là không hiện. */
async function isShown($: Engine, goal: RegExp) {
  const band = await $.ui.mount({ plugin: 'focus-conductor', surface: 'terminal', component: 'AbovePrompt', props: bandProps }).catch(() => null)
  if (band === null) return false
  const shown = (await band.find({ type: 'Text', text: goal })) !== undefined
  await band.unmount()
  return shown
}

describe('0.6.1 2.2: band tự hiện lại ở mục tiêu mới', () => {
  test('ẩn band, prompt tiếp nối thì vẫn ẩn; mục tiêu mới thì band hiện lại', {}, async ($, on) => {
    base(on, RESUME)
    await submit($, COMPLEX_PROMPT)
    const band = await $.ui.mount({ plugin: 'focus-conductor', surface: 'terminal', component: 'AbovePrompt', props: bandProps })
    await band.press({ key: 'hide' })
    await band.unmount()
    expect(await isShown($, /Refactor module thanh toán/)).toBe(false)
    await submit($, 'tiếp tục')
    expect(await isShown($, /Refactor module thanh toán/)).toBe(false)
    await submit($, 'Viết hàm slugify(text) bằng TypeScript, có unit test.')
    expect(await isShown($, /slugify/)).toBe(true)
  })
})
