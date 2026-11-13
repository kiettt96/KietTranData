// 0.8.4 C8: màn hình thể hiện vai điều phối. Band từ 72 ô: chip model của luồng chính điều phối có nhãn vai (vi điều phối, en
// conductor); hẹp hơn thì như cũ. Pane và /conductor status: một dòng Điều phối với trạng thái đang điều phối, tạm ngừng (kèm model
// thay) hay tắt (kèm nguyên nhân). Option mặc định: không có gì mới.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { PANE, base, conductor, plan, step, submit } from '../support/engine'
import type { Json, Seen } from '../support/engine'

const ID = 'fable'
const BIG = plan({ goal: 'Sửa luồng thanh toán', depth: 'substantial', volume: 'medium', kind: 'edit', main: { model: 'sonnet', effort: 'medium', why: '' } })
const band = (columns: number) => ({ plugin: 'focus-conductor', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 3, bodyColumns: columns, scroll: { offset: 0, bodyRows: 3 }, view: {} } }) as const
const texts = async ($: Engine, target: unknown) => {
  const mounted = await $.ui.mount(target as never)
  const out = (await mounted.findAll({ type: 'Text' })).map(e => e.text)
  await mounted.unmount()
  return out
}
const statusText = async ($: Engine) => String((await conductor($, 'status')).text ?? '')

async function conducting($: Engine, on: Parameters<typeof base>[0], reply: (seen: Seen) => Json | null = () => BIG): Promise<Seen> {
  const seen: Seen = base(on, { router: () => reply(seen) })
  await submit($, 'Sửa luồng thanh toán')
  await step($, seen, { turnId: 't1' })
  return seen
}

describe('0.8.4 C8: band', () => {
  for (const columns of [120, 72]) {
    test(`${columns} ô, đang điều phối: chip model có nhãn vai`, { options: { planApproval: 'off', conductor: 'fable' } }, async ($, on) => {
      await conducting($, on)
      expect((await texts($, band(columns))).join(' ')).toContain('điều phối')
    })
  }
  test('56 ô: không có nhãn vai, không quá 3 dòng', { options: { planApproval: 'off', conductor: 'fable' } }, async ($, on) => {
    await conducting($, on)
    const mounted = await $.ui.mount(band(56) as never)
    const all = (await mounted.findAll({ type: 'Text' })).map(e => e.text)
    expect(all.join(' ')).not.toContain('điều phối')
    await mounted.unmount()
  })
  test('uiLanguage en: nhãn vai là conductor', { options: { planApproval: 'off', conductor: 'fable', uiLanguage: 'en' } }, async ($, on) => {
    await conducting($, on)
    expect((await texts($, band(120))).join(' ')).toContain('conductor')
  })
})

describe('0.8.4 C8: pane và /conductor status', () => {
  test('đang điều phối: dòng Điều phối fable/medium', { options: { planApproval: 'off', conductor: 'fable' } }, async ($, on) => {
    await conducting($, on)
    expect((await texts($, PANE)).join('\n')).toContain('Điều phối: fable/medium, đang điều phối')
    expect(await statusText($)).toContain('Điều phối: fable/medium, đang điều phối')
  })
  test('tạm ngừng: dòng Điều phối nêu model router thay', { options: { planApproval: 'off', conductor: 'fable', conductorFallback: 'off' } }, async ($, on) => {
    const seen: Seen = base(on, { router: () => (seen.routerModels.at(-1) === ID ? null : BIG) })
    for (let i = 0; i < 3; i++) await submit($, i === 0 ? 'Sửa luồng thanh toán' : `làm tiếp bước ${i}`)
    expect((await texts($, PANE)).join('\n')).toContain('Điều phối: Fable tạm ngừng, router dùng sonnet')
    expect(await statusText($)).toContain('Điều phối: Fable tạm ngừng, router dùng sonnet')
  })
  test('tắt vì chế độ subagents: dòng Điều phối nêu nguyên nhân', { options: { planApproval: 'off', conductor: 'fable' } }, async ($, on) => {
    base(on, { router: () => BIG })
    await conductor($, 'mode subagents')
    await submit($, 'Sửa luồng thanh toán')
    expect((await texts($, PANE)).join('\n')).toContain('Điều phối: tắt (chế độ điều phối không phải auto)')
    expect(await statusText($)).toContain('Điều phối: tắt (chế độ điều phối không phải auto)')
  })
  test('conductor mặc định: band, pane, status không có gì về điều phối', { options: { planApproval: 'off' } }, async ($, on) => {
    await conducting($, on)
    expect((await texts($, band(120))).join(' ')).not.toContain('điều phối')
    expect((await texts($, PANE)).join('\n')).not.toContain('Điều phối:')
    expect(await statusText($)).not.toContain('Điều phối:')
  })
})
