// 0.7.8 G2: checklist vừa đóng hẳn thì nhắc đối chiếu từng yêu cầu router đã trích (brief.requirements), một lần mỗi mục tiêu.
// Khóa "đã nhắc" nằm trong Core cùng goalId; qualityNotice giữ nguyên.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { Core } from '../../types'
import * as S from '../../hooks/lib/state'
import * as T from '../../hooks/lib/text'
import { base, conductor, plan, submit } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const MARK = 'Đối chiếu từng yêu cầu'
const FOUR = ['Dùng tiếng Việt', 'Không quá 1 trang', 'Có bảng so sánh', 'Nêu nguồn']

async function closeOne($: Engine): Promise<string> {
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Viết' }] })
  return String((await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })).result)
}

describe('0.7.8 G2: đóng bước cuối thì đối chiếu từng yêu cầu', () => {
  test('brief 4 yêu cầu, đóng bước cuối: có đủ 4 yêu cầu đánh số; qualityNotice vẫn có', {}, async ($, on) => {
    base(on, { router: () => plan({ goal: 'Báo cáo', requirements: FOUR, quality: ['Số liệu có nguồn'] }) })
    await submit($, 'Viết báo cáo so sánh')
    const out = await closeOne($)
    expect(out).toContain(MARK)
    FOUR.forEach((r, i) => expect(out).toContain(`(${i + 1}) ${r}`))
    expect(out).toContain('Checklist đã đóng hết')
    expect(out).toContain('(1) Số liệu có nguồn')
  })

  test('mở lại rồi đóng lần hai cùng mục tiêu: không nhắc lại; mục tiêu mới thì nhắc lại', {}, async ($, on) => {
    base(on, { router: request => plan({ goal: request.split('\n')[0], requirements: FOUR }) })
    await submit($, 'Viết báo cáo so sánh')
    expect(await closeOne($)).toContain(MARK)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'doing' })
    const again = String((await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })).result)
    expect(again).not.toContain(MARK)
    await submit($, 'Viết hàm slugify có unit test')
    expect(await closeOne($)).toContain(MARK)
  })

  test('không có requirements thì không thêm', {}, async ($, on) => {
    base(on, { router: () => plan({ goal: 'Báo cáo' }) })
    await submit($, 'Viết báo cáo')
    expect(await closeOne($)).not.toContain(MARK)
  })

  test('brief isReference không thêm', {}, async ($, on) => {
    base(on, { router: () => plan({ goal: 'Xem prompt', reference: true, requirements: FOUR }) })
    await submit($, 'Xem cách điều phối prompt đính kèm')
    expect(await closeOne($)).not.toContain(MARK)
  })

  test('đang tạm dừng thì không nhắc (như qualityNotice)', {}, async ($, on) => {
    base(on, { router: () => plan({ goal: 'Báo cáo', requirements: FOUR }) })
    await submit($, 'Viết báo cáo')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Viết' }] })
    await conductor($, 'pause')
    const out = String((await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })).result)
    expect(out).not.toContain(MARK)
  })

  test('30 yêu cầu dài 160 ký tự: không quá 2.500 ký tự, có câu "và M yêu cầu nữa trong prompt gốc"', {}, async ($, on) => {
    const many = Array.from({ length: 30 }, (_, i) => `${i + 1} ${'y'.repeat(157)}`)
    base(on, { router: () => plan({ goal: 'Báo cáo', requirements: many }) })
    await submit($, 'Viết báo cáo')
    const out = await closeOne($)
    const line = out.split('\n').find(l => l.includes(MARK)) ?? ''
    expect(line.length).toBeGreaterThan(0)
    expect(line.length).toBeLessThanOrEqual(T.REQUIREMENTS_NOTICE_CHARS)
    expect(line).toMatch(/và \d+ yêu cầu nữa trong prompt gốc/)
  })
})

describe('0.7.8 G2: hàm thuần và khóa trong Core', () => {
  test('mỗi yêu cầu cắt 100 ký tự', () => {
    const line = T.requirementsNotice(['a'.repeat(150)])
    expect(line).not.toContain('a'.repeat(101))
  })

  test('reqNoticed còn sau vòng JSON; trạng thái cũ mặc định -1', () => {
    const core = S.withReqNoticed(5)(S.EMPTY_CORE)
    expect(S.normalizeCore(JSON.parse(JSON.stringify(core)) as Partial<Core>).reqNoticed).toBe(5)
    expect(S.normalizeCore({} as Partial<Core>).reqNoticed).toBe(-1)
  })
})
