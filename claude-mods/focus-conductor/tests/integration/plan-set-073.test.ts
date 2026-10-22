// 0.7.3 điểm 8: bớt token người dùng không đọc. (a) DISCIPLINE thêm một mục báo cáo gọn chỉ áp cho luồng chính; (b) kết quả của
// tool plan, action set: khi checklist lưu đúng như Claude gửi thì chỉ trả một dòng (số bước đã lưu, mục tiêu nếu vừa đổi, bước
// tiếp theo kèm số), khi khác thì in đầy đủ kèm một dòng nói đã chỉnh gì; phạm vi lưu khác phạm vi gửi thì nêu phạm vi đã lưu.
// update, add, show, restore giữ như cũ.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { COMPLEX_PROMPT, base, submit } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const set = async ($: Engine, input: Record<string, unknown>) => String((await $.tool.call({ tool: PLAN, action: 'set', ...input } as never)).result)
const show = async ($: Engine) => String((await $.tool.call({ tool: PLAN, action: 'show' })).result)
const titles = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `Bước số ${i + 1}` }))

describe('0.7.3 điểm 8: DISCIPLINE báo cáo gọn, chỉ luồng chính', () => {
  const discipline = async ($: Engine) => {
    const result = await $.prompt.compose({ model: 'claude-sonnet-5-5', promptModel: 'claude-sonnet-5-5', surfaces: [], tools: [], outputStyle: null, traits: [] })
    return result.sections.map(s => s.text).join('\n')
  }

  test('có mục báo cáo gọn: không tường thuật giữa các tool call, một dòng khi chuyển việc, không chép lại checklist', {}, async ($, on) => {
    base(on)
    const text = await discipline($)
    expect(text).toContain('chỉ áp cho luồng chính')
    expect(text).toContain('giữa các tool call không tường thuật')
    expect(text).toContain('"Đang làm việc N/M: ..."')
    expect(text).toContain('không chép lại checklist')
    expect(text).toContain('không tóm tắt lại kết quả tool')
  })

  test('đủ các ngoại lệ: báo ngay khi bị chặn, cần người dùng quyết, phát hiện rủi ro; báo cáo cuối có kết quả, lệnh kiểm, chỗ còn hở', {}, async ($, on) => {
    base(on)
    const text = await discipline($)
    expect(text).toContain('Vẫn báo ngay khi bị chặn, khi cần người dùng quyết định, hoặc khi phát hiện rủi ro')
    expect(text).toContain('Báo cáo cuối nêu kết quả, đã kiểm bằng lệnh nào, và chỗ còn hở')
  })

  test('hướng dẫn riêng của người dùng được ưu tiên hơn mục này', {}, async ($, on) => {
    base(on)
    expect(await discipline($)).toContain('Hướng dẫn riêng của người dùng (CLAUDE.md, prompt) được ưu tiên hơn mục này')
  })

  test('câu dành cho subagent giữ nguyên, các mục 1 đến 5 giữ nguyên', {}, async ($, on) => {
    base(on)
    const text = await discipline($)
    expect(text).toContain(
      'Nếu bạn là subagent: không dùng tool plan của mod; việc từ ba bước trở lên thì ghi danh sách bằng tool danh sách việc có sẵn (nếu có trong phiên của bạn); làm đúng nhiệm vụ được giao và báo cáo ngắn gọn.',
    )
    for (const marker of ['1. Đọc kỹ trước khi làm', '2. Với việc từ mức moderate trở lên', '3. Nhất quán', '4. Tự kiểm tra sau mỗi bước quan trọng', '5. Khi giao việc cho subagent']) {
      expect(text).toContain(marker)
    }
  })

  test('mục báo cáo gọn đứng trước câu dành cho subagent (câu subagent vẫn là dòng cuối)', {}, async ($, on) => {
    base(on)
    const text = await discipline($)
    expect(text.indexOf('chỉ áp cho luồng chính')).toBeLessThan(text.indexOf('Nếu bạn là subagent'))
  })
})

describe('0.7.3 điểm 8: plan set trả một dòng khi checklist lưu đúng như đã gửi', () => {
  test('ba bước hợp lệ: một dòng có số bước, bước tiếp theo kèm số; không in lại checklist', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    const out = await set($, { steps: titles(3) })
    expect(out).toContain('Đã lưu 3 bước')
    expect(out).toContain('Bước tiếp theo: 1. Bước số 1')
    expect(out).not.toContain('\n')
    expect(out).not.toContain('[ ] 1.')
    expect(out).not.toContain('Checklist (')
    expect(out).not.toContain('Bước số 2')
  })

  test('checklist vẫn được lưu đầy đủ (show in đủ)', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    await set($, { steps: titles(3) })
    const shown = await show($)
    for (const n of [1, 2, 3]) expect(shown).toContain(`[ ] ${n}. Bước số ${n}`)
  })

  test('ngắn hơn bản đầy đủ của cùng checklist 20 bước', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    const out = await set($, { steps: titles(20) })
    const full = await show($)
    expect(out).toContain('Đã lưu 20 bước')
    expect(out.length).toBeLessThan(full.length / 4)
  })

  test('đúng 160 ký tự tiêu đề, 200 ký tự tiêu chí, 20 bước: không bị coi là đã chỉnh', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    const out = await set($, { steps: [{ title: 'a'.repeat(160), check: 'b'.repeat(200) }, ...titles(19)] })
    expect(out).toContain('Đã lưu 20 bước')
    expect(out).not.toContain('Đã chỉnh')
    expect(out).not.toContain('\n')
  })

  test('mục tiêu vừa đổi thì nêu mục tiêu; mục tiêu không đổi thì không nêu', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    const current = /Mục tiêu: (.*)/.exec(await show($))?.[1] ?? ''
    expect(current).not.toBe('')
    expect(await set($, { goal: current, steps: titles(2) })).not.toContain('Mục tiêu:')
    const changed = await set($, { goal: 'Dựng báo cáo tổng hợp quý', steps: titles(2) })
    expect(changed).toContain('Mục tiêu: Dựng báo cáo tổng hợp quý')
    expect(changed).not.toContain('\n')
  })
})

describe('0.7.3 điểm 8: plan set in đầy đủ kèm một dòng nói đã chỉnh gì', () => {
  test('bước không có tiêu đề bị bỏ', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    const out = await set($, { steps: [{ title: 'Một' }, { title: '   ' }, { title: 'Hai' }] })
    expect(out).toContain('[ ] 1. Một')
    expect(out).toContain('[ ] 2. Hai')
    expect(out).toContain('Đã chỉnh: bỏ 1 bước không có tiêu đề')
  })

  test('gửi 21 bước: lưu 20, nói bỏ bước vượt giới hạn 20', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    const out = await set($, { steps: titles(21) })
    expect(out).toContain('[ ] 20. Bước số 20')
    expect(out).not.toContain('Bước số 21')
    expect(out).toContain('Đã chỉnh: bỏ 1 bước vượt giới hạn 20')
  })

  test('tiêu đề quá 160 ký tự bị cắt', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    const out = await set($, { steps: [{ title: 'a'.repeat(161) }, { title: 'b'.repeat(200) }] })
    expect(out).toContain('Đã chỉnh: cắt 2 tiêu đề quá 160 ký tự')
    expect(out).toContain(`[ ] 1. ${'a'.repeat(160)}`)
    expect(out).not.toContain('a'.repeat(161))
  })

  test('tiêu chí quá 200 ký tự bị cắt', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    const out = await set($, { steps: [{ title: 'Một', check: 'c'.repeat(201) }] })
    expect(out).toContain('Đã chỉnh: cắt 1 tiêu chí quá 200 ký tự')
    expect(out).toContain(`[nghiệm thu: ${'c'.repeat(200)}]`)
  })

  test('nhiều chỉnh cùng lúc: một dòng liệt kê đủ', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    const out = await set($, { steps: [{ title: '' }, { title: 'a'.repeat(161), check: 'c'.repeat(201) }, ...titles(20)] })
    const line = out.split('\n').find(l => l.startsWith('Đã chỉnh')) ?? ''
    expect(line).toContain('bỏ 1 bước không có tiêu đề')
    expect(line).toContain('bỏ 1 bước vượt giới hạn 20')
    expect(line).toContain('cắt 1 tiêu đề quá 160 ký tự')
    expect(line).toContain('cắt 1 tiêu chí quá 200 ký tự')
  })

  test('chỉ đổi goal hay scope (không gửi steps) và xóa checklist (steps rỗng): giữ cách in đầy đủ như cũ', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    await set($, { steps: titles(2) })
    const goalOnly = await set($, { goal: 'Mục tiêu đã chốt lại' })
    expect(goalOnly).toContain('Mục tiêu: Mục tiêu đã chốt lại')
    expect(goalOnly).toContain('[ ] 2. Bước số 2')
    const cleared = await set($, { steps: [] })
    expect(cleared).toContain('Checklist trống')
  })
})

describe('0.7.3 điểm 8: phạm vi đã lưu', () => {
  test('scope trùng bị gộp: dòng kết quả nêu phạm vi đã lưu', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    const out = await set($, { steps: titles(2), scope: ['src/a.ts', 'src/a.ts', 'src/b.ts'] })
    expect(out).toContain('Đã lưu 2 bước')
    expect(out).toContain('Phạm vi đã lưu: src/a.ts, src/b.ts')
    expect(out).not.toContain('\n')
  })

  test('scope quá 10 mục: lưu 10, nêu phạm vi đã lưu', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    const scope = Array.from({ length: 12 }, (_, i) => `src/f${i}.ts`)
    const out = await set($, { steps: titles(1), scope })
    expect(out).toContain('Phạm vi đã lưu: ')
    expect(out).toContain('src/f9.ts')
    expect(out).not.toContain('src/f10.ts')
  })

  test('scope không đổi sau khi lưu: không nêu phạm vi', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    const out = await set($, { steps: titles(2), scope: ['src/a.ts', 'src/b.ts'] })
    expect(out).not.toContain('Phạm vi')
  })

  test('không gửi scope: không nêu phạm vi', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    expect(await set($, { steps: titles(2) })).not.toContain('Phạm vi')
  })

  test('checklist bị chỉnh và scope bị gộp: bản đầy đủ có cả dòng đã chỉnh và phạm vi đã lưu', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    const out = await set($, { steps: [{ title: '' }, ...titles(2)], scope: ['src/a.ts', 'src/a.ts'] })
    expect(out).toContain('[ ] 1. Bước số 1')
    expect(out).toContain('Đã chỉnh: bỏ 1 bước không có tiêu đề')
    expect(out).toContain('Phạm vi đã lưu: src/a.ts')
  })

  test('scope lưu thật vẫn đúng (kiểm bằng ghi ngoài phạm vi)', {}, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    await set($, { steps: titles(1), scope: ['src/a.ts', 'src/a.ts'] })
    const out = await $.tool.call({ tool: 'Edit', file_path: 'src/zzz.ts', old_string: 'a', new_string: 'b' } as never)
    expect(JSON.stringify(out)).toContain('phạm vi')
  })
})

describe('0.7.3 điểm 8: update, add, show, restore không đổi', () => {
  test('add và update in hàng của bước đổi như 0.5.6; show in đủ', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    await set($, { steps: titles(2) })
    const added = String((await $.tool.call({ tool: PLAN, action: 'add', steps: [{ title: 'Thêm' }] })).result)
    expect(added).toContain('[ ] 3. Thêm')
    expect(added).not.toContain('[ ] 1.')
    const updated = String((await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'doing' })).result)
    expect(updated).toContain('[~] 1. Bước số 1')
    expect(updated).not.toContain('[ ] 2.')
    const shown = await show($)
    expect(shown).toContain('[ ] 2. Bước số 2')
    expect(shown).toContain('[ ] 3. Thêm')
  })
})
