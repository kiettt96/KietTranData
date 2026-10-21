// 0.7.2 điểm 5: band đã ẩn (nút Ẩn) hiện lại khi /conductor goal đặt mục tiêu mới, không chỉ ở mục tiêu mới do router đọc.
// /conductor reset và /clear xóa mục tiêu nên band vẫn không vẽ (brief null), và mọi đường lập mục tiêu sau đó đều đã đặt lại cờ; vì vậy
// không thêm đặt lại ở hai chỗ đó (không quan sát được, không test được).

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { COMPLEX_PROMPT, PANE, base, conductor, plan, submit } from '../support/engine'

const bandProps = { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 6 }, view: {} }
const mountBand = ($: Engine) => $.ui.mount({ plugin: 'focus-conductor', surface: 'terminal', component: 'AbovePrompt', props: bandProps })

/** Nút Ẩn trên band: band biến mất (không còn nút Chi tiết). */
async function hideBand($: Engine) {
  const band = await mountBand($)
  await band.press({ key: 'hide' })
  await band.unmount()
}
// Band ẩn thì hook ui.render của mod trả null và không còn gì dưới nó vẽ (mount báo lỗi): coi là không hiện.
const isBandShown = async ($: Engine) => {
  try {
    const band = await mountBand($)
    const shown = (await band.find({ key: 'details' })) !== undefined
    await band.unmount()
    return shown
  } catch {
    return false
  }
}
const isHidden = async ($: Engine) => {
  const pane = await $.ui.mount(PANE)
  const label = (await pane.find({ key: 'band' }))?.text
  await pane.unmount()
  return label === 'Hiện band'
}

describe('0.7.2 5: band đã ẩn hiện lại', () => {
  test('đối chứng: nút Ẩn ẩn band trong mục tiêu đang làm, prompt tiếp nối vẫn ẩn', {}, async ($, on) => {
    let n = 0
    base(on, { router: () => (++n === 1 ? plan({ goal: 'Sửa lớn' }) : plan({ relation: 'continue', goal: '' })) })
    await submit($, COMPLEX_PROMPT)
    expect(await isBandShown($)).toBe(true)
    await hideBand($)
    expect(await isBandShown($)).toBe(false)
    expect(await isHidden($)).toBe(true)
    await submit($, 'Làm tiếp phần còn lại')
    expect(await isBandShown($)).toBe(false)
  })

  test('/conductor goal: mục tiêu mới đặt bằng lệnh thì band hiện lại', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    await hideBand($)
    expect(await isHidden($)).toBe(true)
    await conductor($, 'goal Sửa module thanh toán')
    expect(await isHidden($)).toBe(false)
    expect(await isBandShown($)).toBe(true)
  })
})
