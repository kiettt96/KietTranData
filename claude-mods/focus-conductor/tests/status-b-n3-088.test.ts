// 0.8.8 N3: status line hướng B. Ngay sau họ model có đoạn hướng, cùng nhãn với ô hướng của band nhưng viết thường và không màu. Không có
// đoạn này khi mục đầu là tạm dừng, chờ duyệt kế hoạch hay báo hạn mức mềm, vì status line đã có nhãn riêng cho ba việc đó [Nguồn: chủ mod,
// 14/11/2026]. Các nhãn cũ (hạn mức, lỗi router, turn lỗi) và thứ tự của chúng giữ nguyên. Chưa có mục tiêu thì như 0.8.7.

import { describe, expect, test } from 'claude-code/testing'
import * as S from '../hooks/lib/state'
import { EMPTY_QUOTA, quotaSettings } from '../hooks/lib/quota'
import { statusTextOf } from '../hooks/ui/direction'
import { makeBrief } from './support/commands'

const BAR_RUN = '\u2501\u2501\u2501\u25D0\u254C\u254C\u254C\u254C 1/3 · BƯỚC 2 · opus'
const brief = makeBrief({ at: 1 })
const steps = (...statuses: string[]) => statuses.map((status, i) => ({ id: i + 1, title: `BƯỚC ${i + 1}: việc ${i + 1}`, status }))
const view = (over: Record<string, unknown>, lang: 'vi' | 'en' = 'vi') =>
  ({ core: S.normalizeCore({ ...S.EMPTY_CORE, brief, route: { family: 'opus', effort: 'high' }, ...over } as never), mode: 'auto', isBandHidden: false, lang }) as never
const settings = quotaSettings({ noticeSessionRemainingPct: 20 })
const used = (percent: number) => ({ ...EMPTY_QUOTA, readings: [{ kind: 'five_hour', percentUsed: percent, resetsAt: '2100-01-01T00:00:00.000Z' }] }) as never
const scope = [{ at: 2, kind: 'scope', text: 'sửa ngoài phạm vi' }]
const unverified = [{ at: 2, kind: 'unverified', text: 'bước chưa kiểm' }]
const status = (v: never, quota: never = EMPTY_QUOTA as never) => statusTextOf(v, quota, 1000, settings)
const once = (text: string | undefined, part: string) => expect((text ?? '').split(part).length - 1, part).toBe(1)

describe('0.8.8 N3: đoạn hướng', () => {
  test('ổn: "đúng hướng" ngay sau họ model', () => {
    expect(status(view({ plan: steps('done', 'doing', 'todo') }))).toBe(`${BAR_RUN} · \u2713 đúng hướng`)
    expect(status(view({ plan: steps('done', 'doing', 'todo') }, 'en'))).toBe(`${BAR_RUN} · \u2713 on track`)
  })

  test('mức đỏ: "lệch phạm vi"', () => {
    expect(status(view({ plan: steps('done', 'doing', 'todo'), warnings: scope }))).toBe(`${BAR_RUN} · \u25B2 lệch phạm vi`)
    expect(status(view({ plan: steps('done', 'doing', 'todo'), warnings: scope }, 'en'))).toBe(`${BAR_RUN} · \u25B2 out of scope`)
  })

  test('cần chú ý: "chưa kiểm"', () => {
    expect(status(view({ plan: steps('done', 'doing', 'todo'), warnings: unverified }))).toBe(`${BAR_RUN} · \u25B3 chưa kiểm`)
    expect(status(view({ plan: steps('done', 'doing', 'todo'), warnings: unverified }, 'en'))).toBe(`${BAR_RUN} · \u25B3 unverified`)
  })

  test('xong: "đã kiểm 3/3"', () => {
    expect(status(view({ plan: steps('verified', 'verified', 'verified') }))).toBe('\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501 3/3 · 3\u2713 · opus · \u2713 đã kiểm 3/3')
    expect(status(view({ plan: steps('verified', 'verified', 'verified') }, 'en'))).toBe('\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501 3/3 · 3\u2713 · opus · \u2713 verified 3/3')
  })

  test('nhãn hạn mức, lỗi router, turn lỗi vẫn đứng sau, đúng thứ tự cũ', () => {
    const text = status(
      view({ plan: steps('done', 'doing', 'todo'), warnings: scope, routerFail: { at: 5, kind: 'timeout', reason: 'hết giờ', ms: 45000 }, turnFault: { goalId: 1, goal: 'x', openSteps: ['BƯỚC 2'], at: 6 } }),
      used(85),
    )
    expect(text).toBe(`${BAR_RUN} · \u25B2 lệch phạm vi · báo hạn mức: phiên còn 15% · router lỗi: hết giờ · /conductor reroute · turn lỗi · gõ tiếp để chạy lại`)
  })

  test('chưa có mục tiêu: như 0.8.7; chuỗi không có mã màu', () => {
    expect(statusTextOf({ core: S.EMPTY_CORE, mode: 'auto', isBandHidden: false, lang: 'vi' } as never, EMPTY_QUOTA as never, 1000, settings)).toBe('auto')
    for (const v of [view({ plan: steps('done', 'doing', 'todo') }), view({ plan: steps('done', 'doing', 'todo'), warnings: scope })]) expect(status(v)).not.toMatch(/#[0-9a-fA-F]{6}|rgb\(|ansi256\(/)
  })
})

describe('0.8.8 N3: không lặp nhãn khi mục đầu là tạm dừng, chờ duyệt hay báo mềm', () => {
  test('tạm dừng: không có đoạn hướng; nhãn tạm dừng chỉ một lần', () => {
    const text = status(view({ plan: steps('done', 'doing', 'todo') }), used(97))
    expect(text).toBe(`${BAR_RUN} · tạm dừng: hạn mức · /conductor resume force`)
    expect(text).not.toContain('\u23F8')
    once(text, 'tạm dừng')
  })

  test('chờ duyệt kế hoạch: không có đoạn hướng; nhãn chờ duyệt chỉ một lần', () => {
    const text = status(view({ plan: steps('todo', 'todo'), approval: { goalId: 1, status: 'presented', rounds: 1, asked: true, awaitingAnswer: false } }))
    expect(text).toBe('\u254C\u254C\u254C\u254C\u254C\u254C\u254C\u254C 0/2 · BƯỚC 1 · opus · chờ duyệt kế hoạch')
    once(text, 'chờ duyệt')
  })

  test('báo hạn mức mềm: không có đoạn hướng; nhãn báo mềm chỉ một lần', () => {
    const text = status(view({ plan: steps('done', 'doing', 'todo') }), used(85))
    expect(text).toBe(`${BAR_RUN} · báo hạn mức: phiên còn 15%`)
    once(text, 'hạn mức')
  })
})
