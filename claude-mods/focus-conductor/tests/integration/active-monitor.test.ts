// 0.7.0 điểm 6: giám sát chủ động giữa phiên. semanticDrift bật mặc định (tắt khi đặt false), tự tắt khi hạn mức vào vùng gần
// ngưỡng, tối đa một lượt mỗi 10 phút đồng hồ engine; lệch mục tiêu nâng độ sâu cho turn sau; phát hiện của lượt trước (vòng lặp,
// vượt ngân sách, chuỗi lỗi, lệch mục tiêu) được gửi kèm cho router ở prompt tiếp nối để chấm lại model luồng chính.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { COMPLEX_PROMPT, base, plan, step, submit } from '../support/engine'
import { quotaMeter, session } from '../support/quota'

const edit = ($: Engine, name: string) => $.tool.call({ tool: 'Edit', file_path: `src/${name}.ts`, old_string: 'x', new_string: 'y' })
const FIVE = ['a', 'b', 'c', 'd', 'e']
const answer = (turnId: string) => ({ turnId, answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' }) as never
const MINUTE = 60_000

describe('0.7.0 6: semanticDrift mặc định bật', () => {
  test('không đặt option: ở checkpoint router được hỏi một lượt kiểm lạc đề', {}, async ($, on) => {
    const seen = base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    for (const f of FIVE) await edit($, f)
    expect(seen.drift.length).toBe(1)
  })

  test('đặt semanticDrift false: không hỏi router ở checkpoint', { options: { semanticDrift: false } }, async ($, on) => {
    const seen = base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    for (const f of FIVE) await edit($, f)
    expect(seen.drift.length).toBe(0)
  })
})

describe('0.7.0 6: tự tắt gần ngưỡng hạn mức và giới hạn tần suất', () => {
  test('hạn mức còn trong vùng gấp đôi biên (còn 8%, ngưỡng 5%): không kiểm lạc đề', { options: { semanticDrift: true } }, async ($, on) => {
    const seen = base(on)
    const meter = quotaMeter(on, [session(50)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    meter.set([session(92)])
    await seen.clock.advance(10_000)
    for (const f of FIVE) expect((await edit($, f)).deny).toBeUndefined()
    expect(seen.drift.length).toBe(0)
  })

  test('hạn mức còn thoải mái (còn 50%): vẫn kiểm lạc đề', { options: { semanticDrift: true } }, async ($, on) => {
    const seen = base(on)
    quotaMeter(on, [session(50)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    await seen.clock.advance(10_000)
    for (const f of FIVE) await edit($, f)
    expect(seen.drift.length).toBe(1)
  })

  test('tối đa một lượt mỗi 10 phút: checkpoint thứ hai trong 10 phút bỏ qua, sau 10 phút thì hỏi lại', { options: { semanticDrift: true } }, async ($, on) => {
    const seen = base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    for (const f of FIVE) await edit($, f)
    expect(seen.drift.length).toBe(1)
    await seen.clock.advance(5 * MINUTE)
    for (const f of ['f', 'g', 'h', 'i', 'j']) await edit($, f)
    expect(seen.drift.length).toBe(1)
    await seen.clock.advance(6 * MINUTE)
    for (const f of ['k', 'l', 'm', 'n', 'o']) await edit($, f)
    expect(seen.drift.length).toBe(2)
  })
})

describe('0.7.0 6: lệch mục tiêu nâng độ sâu cho turn sau', () => {
  const lifted = async (isOnTrack: boolean, $: Engine, on: Parameters<typeof base>[0]) => {
    const seen = base(on, { router: () => plan({ goal: 'Sửa lớn', main: { model: 'sonnet', effort: 'medium' } }), drift: () => ({ onTrack: isOnTrack, confidence: 0.8, why: 'đang sửa CSS không liên quan' }) })
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('turn.complete', () => ({ text: '' }))
    await submit($, 'sửa lớn module thanh toán')
    await step($, seen, { turnId: 't1' })
    for (const f of FIVE) await edit($, f)
    await $.turn.complete(answer('t1'))
    // Cache nguội: lựa chọn của turn sau phản ánh đúng mức nâng.
    await seen.clock.advance(2 * 60 * MINUTE)
    return (await step($, seen, { turnId: 't2' }))?.model
  }

  test('router thấy lệch mục tiêu: turn sau nâng một họ model (sonnet lên opus)', {}, async ($, on) => {
    expect(await lifted(false, $, on)).toBe('claude-opus-5-5')
  })

  test('router thấy vẫn đúng hướng: model giữ nguyên', {}, async ($, on) => {
    expect(await lifted(true, $, on)).toBe('claude-sonnet-5-5')
  })
})

describe('0.7.0 6: phát hiện của lượt trước gửi kèm router ở prompt tiếp nối', () => {
  const routerFor = (request: string) => (request.startsWith('Làm tiếp') ? plan({ relation: 'continue', goal: '' }) : plan({ goal: 'Sửa typo' }))

  async function failingTurn($: Engine, on: Parameters<typeof base>[0]) {
    const seen = base(on, { router: routerFor })
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'lỗi', isError: true }))
    on('turn.complete', () => ({ text: '' }))
    await submit($, 'sửa typo trong README')
    await step($, seen, { turnId: 't1' })
    for (const file of ['a.txt', 'b.txt', 'c.txt']) await $.tool.call({ tool: 'Bash', command: `cat ${file}` })
    await $.turn.complete(answer('t1'))
    return seen
  }

  test('chuỗi lỗi ở lượt trước: request của prompt tiếp nối có dòng quan sát, và chỉ một lần', {}, async ($, on) => {
    const seen = await failingTurn($, on)
    await submit($, 'Làm tiếp phần còn lại')
    expect(seen.routed[1]).toContain('Observed in the previous turn')
    expect(seen.routed[1]).toContain('lỗi')
    await submit($, 'Làm tiếp thêm một chút')
    expect(seen.routed[2]).not.toContain('Observed in the previous turn')
  })

  test('đối chứng: lượt trước không có phát hiện nào thì request không có dòng quan sát', {}, async ($, on) => {
    const seen = base(on, { router: routerFor })
    on('turn.complete', () => ({ text: '' }))
    await submit($, 'sửa typo trong README')
    await step($, seen, { turnId: 't1' })
    await $.turn.complete(answer('t1'))
    await submit($, 'Làm tiếp phần còn lại')
    expect(seen.routed[1]).not.toContain('Observed in the previous turn')
  })

  test('vượt ngân sách tool call ở lượt trước được gửi kèm', {}, async ($, on) => {
    const seen = base(on, { router: routerFor })
    on('tool.call', { tool: 'Read' }, () => ({ result: 'nội dung' }))
    on('turn.complete', () => ({ text: '' }))
    await submit($, 'sửa typo trong README')
    await $.turn.start({ text: 'sửa typo', turnId: 't1' })
    for (let i = 0; i < 16; i++) await $.tool.call({ tool: 'Read', file_path: `src/f${i}.ts` })
    await $.turn.complete(answer('t1'))
    await submit($, 'Làm tiếp phần còn lại')
    expect(seen.routed[1]).toContain('Observed in the previous turn')
    expect(seen.routed[1]).toContain('vượt mức dự kiến')
  })

  test('lặp lại một tool call lỗi ở lượt trước được gửi kèm', {}, async ($, on) => {
    const seen = base(on, { router: routerFor })
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'lỗi', isError: true }))
    on('turn.complete', () => ({ text: '' }))
    await submit($, 'sửa typo trong README')
    await $.turn.start({ text: 'sửa typo', turnId: 't1' })
    for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'cat missing.txt' })
    await $.turn.complete(answer('t1'))
    await submit($, 'Làm tiếp phần còn lại')
    expect(seen.routed[1]).toContain('Observed in the previous turn')
  })

  test('lệch mục tiêu ở lượt trước cũng được gửi kèm', { options: { semanticDrift: true } }, async ($, on) => {
    const seen = base(on, { router: routerFor, drift: () => ({ onTrack: false, confidence: 0.8, why: 'đang sửa CSS' }) })
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('turn.complete', () => ({ text: '' }))
    await submit($, 'sửa typo trong README')
    await step($, seen, { turnId: 't1' })
    for (const f of FIVE) await edit($, f)
    await $.turn.complete(answer('t1'))
    await submit($, 'Làm tiếp phần còn lại')
    expect(seen.routed[1]).toContain('Observed in the previous turn')
    expect(seen.routed[1]).toContain('đang sửa CSS')
  })
})
