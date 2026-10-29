// 0.7.5 R5 (vòng rà soát 3): prompt được giữ làm tiếp nối (router xếp mục tiêu mới với tin cậy dưới 0,8 mà prompt nhắc bước đang mở)
// chạy luồng chính có sàn: sàn main của mục tiêu (mainBase), sàn model của phiên khi R4 áp, và không bao giờ thấp hơn sonnet.

import { describe, expect, test } from 'claude-code/testing'
import { nextBrief, parseRoute } from '../hooks/lib/router'
import type { Policy, RouterPlan } from '../hooks/lib/router'
import { makeBrief } from './support/commands'
import { plan } from './support/engine'

const OPEN: Policy = { allowFable: false, blocked: new Set(), session: null }
const routed = (over: Record<string, unknown>): RouterPlan => parseRoute(JSON.stringify(plan(over)), OPEN)!
const call = nextBrief as (...a: unknown[]) => ReturnType<typeof nextBrief>
const STEPS = ['BƯỚC 1: Liệt kê các file đầu vào', 'BƯỚC 2: Đối chiếu số liệu']
const PROMPT = 'Ở BƯỚC 1, liệt kê nhanh các file đầu vào'
const lead = (model: string, effort: string) => ({ model, effort, why: '' })
const brief = (over: Record<string, unknown> = {}) => makeBrief({ goalId: 3, goal: 'Cập nhật sổ giá theo 11 bước', steps: STEPS, tasks: [], ...over })
const ask = (prev: ReturnType<typeof makeBrief>, main: ReturnType<typeof lead>, options: Record<string, unknown> = {}) =>
  call(prev, routed({ relation: 'new', confidence: 0.7, goal: 'Liệt kê file', main }), PROMPT, 2, { openSteps: STEPS, ...options })

describe('0.7.5 R5: prompt được giữ có sàn luồng chính', () => {
  test('sàn là main của mục tiêu: router chọn haiku/low, mục tiêu chạy opus/high: ra opus/high', () => {
    const out = ask(brief({ main: { family: 'opus', effort: 'high' } }), lead('haiku', 'low'))
    expect(out.held).toBe(true)
    expect(out.brief.main).toEqual({ family: 'opus', effort: 'high' })
  })

  test('sàn là mainBase chứ không phải main gần nhất', () => {
    const out = ask(brief({ main: { family: 'opus', effort: 'high' }, mainBase: { family: 'sonnet', effort: 'medium' } }), lead('haiku', 'low'))
    expect(out.brief.main).toEqual({ family: 'sonnet', effort: 'medium' })
  })

  test('không bao giờ thấp hơn sonnet: mục tiêu chưa có main, router chọn haiku/low: ra sonnet/low', () => {
    const out = ask(brief({ main: null }), lead('haiku', 'low'))
    expect(out.brief.main).toEqual({ family: 'sonnet', effort: 'low' })
  })

  test('router chọn cao hơn sàn thì giữ lựa chọn của router', () => {
    const out = ask(brief({ main: { family: 'sonnet', effort: 'medium' } }), lead('opus', 'high'))
    expect(out.brief.main).toEqual({ family: 'opus', effort: 'high' })
  })

  test('sàn model của phiên khi quy tắc gán mô hình của phiên cho việc đọc: phiên opus nâng main lên opus', () => {
    const prev = brief({ main: { family: 'sonnet', effort: 'medium' }, constraints: ['Lọc tin dùng sonnet; đọc, giải thích, đúc kết dùng mô hình của phiên'] })
    const out = ask(prev, lead('haiku', 'low'), { sessionFamily: 'opus' })
    expect(out.brief.main).toEqual({ family: 'opus', effort: 'medium' })
  })

  test('không biết model của phiên: không tạo sàn phiên, main theo sàn mục tiêu', () => {
    const prev = brief({ main: { family: 'sonnet', effort: 'medium' }, constraints: ['Lọc tin dùng sonnet; đọc, giải thích, đúc kết dùng mô hình của phiên'] })
    const out = ask(prev, lead('haiku', 'low'))
    expect(out.brief.main).toEqual({ family: 'sonnet', effort: 'medium' })
  })

  test('prompt được giữ không đổi sàn của mục tiêu (mainBase giữ nguyên)', () => {
    const out = ask(brief({ main: { family: 'sonnet', effort: 'medium' } }), lead('opus', 'high'))
    expect((out.brief as { mainBase?: unknown }).mainBase).toEqual({ family: 'sonnet', effort: 'medium' })
  })
})
