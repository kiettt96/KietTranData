// 0.7.4 điểm 3 (thuần): báo hạn mức mềm. Hai option noticeWeekRemainingPct và noticeSessionRemainingPct, mặc định tắt;
// ngưỡng mềm phải lớn hơn ngưỡng dừng cứng cùng cửa sổ; không báo ở vùng dừng cứng, số đo cũ hay thiếu.

import { describe, expect, test } from 'claude-code/testing'

import { quotaSettings, softNotices } from '../hooks/lib/quota'
import { statusText } from '../hooks/lib/state'
import * as S from '../hooks/lib/state'
import { EMPTY_QUOTA } from '../hooks/lib/quota'
import { quotaNoticeText } from '../hooks/lib/text'

const FAR = '2100-01-01T00:00:00.000Z'
const OLD = '1970-01-01T00:00:00.000Z'
const week = (used: number, resetsAt: string | undefined = FAR) => ({ kind: 'seven_day', percentUsed: used, ...(resetsAt !== undefined ? { resetsAt } : {}) })
const session = (used: number) => ({ kind: 'five_hour', percentUsed: used, resetsAt: FAR })

describe('0.7.4 3: quotaSettings đọc ngưỡng mềm', () => {
  test('mặc định tắt: không có option, 0 hay chuỗi rỗng đều là tắt, không cảnh báo', () => {
    for (const raw of [undefined, 0, '', '0']) {
      const settings = quotaSettings({ noticeWeekRemainingPct: raw, noticeSessionRemainingPct: raw })
      expect(settings.notice).toEqual({ session: null, week: null })
      expect(settings.noticeIssues).toEqual([])
    }
  })

  test('số hay chuỗi số đọc được và kẹp như ngưỡng dừng', () => {
    expect(quotaSettings({ noticeWeekRemainingPct: 20 }).notice.week).toBe(20)
    expect(quotaSettings({ noticeSessionRemainingPct: '30' }).notice.session).toBe(30)
    expect(quotaSettings({ noticeWeekRemainingPct: 150 }).notice.week).toBe(99)
    expect(quotaSettings({ noticeWeekRemainingPct: 'abc' }).notice.week).toBe(null)
  })

  test('ngưỡng mềm không lớn hơn ngưỡng dừng cứng cùng cửa sổ: bỏ qua và có câu cảnh báo', () => {
    const equal = quotaSettings({ noticeWeekRemainingPct: 2 })
    expect(equal.notice.week).toBe(null)
    expect(equal.noticeIssues).toEqual(['noticeWeekRemainingPct (2%) phải lớn hơn pauseWeekRemainingPct (2%): bỏ qua báo hạn mức tuần'])
    const lower = quotaSettings({ noticeSessionRemainingPct: 4, pauseSessionRemainingPct: 10 })
    expect(lower.notice.session).toBe(null)
    expect(lower.noticeIssues).toEqual(['noticeSessionRemainingPct (4%) phải lớn hơn pauseSessionRemainingPct (10%): bỏ qua báo hạn mức phiên'])
  })
})

describe('0.7.4 3: softNotices', () => {
  const settings = quotaSettings({ noticeWeekRemainingPct: 20, noticeSessionRemainingPct: 30 })

  test('cửa sổ vào vùng báo: kind, phần còn lại, mốc làm mới và khóa theo cửa sổ', () => {
    expect(softNotices([week(81)], 1000, settings)).toEqual([{ kind: 'seven_day', remaining: 19, resetsAt: FAR, key: `seven_day:${FAR}` }])
    expect(softNotices([week(80)], 1000, settings).map(n => n.remaining)).toEqual([20])
    expect(softNotices([week(70), session(75)], 1000, settings).map(n => n.kind)).toEqual(['five_hour'])
  })

  test('chưa tới ngưỡng, số đo cũ, số hỏng, kind lạ: không báo', () => {
    expect(softNotices([week(79)], 1000, settings)).toEqual([])
    expect(softNotices([week(90, OLD)], 1000, settings)).toEqual([])
    expect(softNotices([{ kind: 'seven_day', percentUsed: 'x' }, { kind: 'other', percentUsed: 90 }, null], 1000, settings)).toEqual([])
    expect(softNotices(null, 1000, settings)).toEqual([])
  })

  test('vùng dừng cứng không báo mềm', () => {
    expect(softNotices([week(98)], 1000, settings)).toEqual([])
    expect(softNotices([week(97.9)], 1000, settings).length).toBe(1)
  })

  test('option tắt hay quotaGuard tắt: không báo', () => {
    expect(softNotices([week(95)], 1000, quotaSettings({}))).toEqual([])
    expect(softNotices([week(95)], 1000, quotaSettings({ quotaGuard: false, noticeWeekRemainingPct: 20 }))).toEqual([])
  })

  test('không có mốc làm mới: khóa vẫn theo cửa sổ', () => {
    expect(softNotices([week(85, undefined)], 1000, settings)).toEqual([{ kind: 'seven_day', remaining: 15, key: 'seven_day:' }])
  })
})

describe('0.7.4 3: câu báo và nhãn status', () => {
  test('câu báo theo đặc tả, có giờ làm mới khi có', () => {
    const text = quotaNoticeText([{ kind: 'seven_day', remaining: 19.5, resetsAt: FAR, key: 'k' }])
    expect(text).toMatch(/^\[focus-conductor\] Hạn mức tuần còn 19,5% \(làm mới lúc \d\d:\d\d \d\d\/\d\d\)\. Nếu prompt có quy tắc dừng theo hạn mức thì áp dụng ngay: làm xong phần đang làm, ghi điểm dừng theo cách prompt quy định, rồi dừng\.$/)
    expect(quotaNoticeText([{ kind: 'five_hour', remaining: 25, key: 'k' }])).toBe(
      '[focus-conductor] Hạn mức phiên (5 giờ) còn 25%. Nếu prompt có quy tắc dừng theo hạn mức thì áp dụng ngay: làm xong phần đang làm, ghi điểm dừng theo cách prompt quy định, rồi dừng.',
    )
  })

  test('status line ghép nhãn báo hạn mức khi ở vùng báo', () => {
    const view = { core: S.EMPTY_CORE, mode: 'auto', lang: 'vi', isBandHidden: false } as unknown as S.View
    const settings = quotaSettings({ noticeWeekRemainingPct: 20 })
    const text = statusText(view, { ...EMPTY_QUOTA, readings: [week(81)] as never }, 1000, settings)
    expect(text).toContain('báo hạn mức: tuần còn 19%')
    expect(statusText(view, { ...EMPTY_QUOTA, readings: [week(70)] as never }, 1000, settings) ?? '').not.toContain('báo hạn mức')
  })
})
