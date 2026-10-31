// 0.7.5 R4 (vòng rà soát 3): ràng buộc gán "mô hình của phiên" cho loại việc mà luồng chính tự làm (đọc, giải thích, đúc kết, tổng
// hợp, tóm tắt, viết, sửa) thì sàn của luồng chính là model của phiên. Loại việc của subagent (lọc tin...) không tạo sàn. Không biết
// model của phiên thì không tạo sàn, main giữ nguyên (không tự nâng lên opus).

import { describe, expect, test } from 'claude-code/testing'
import { nextBrief, parseRoute } from '../hooks/lib/router'
import type { Policy, RouterPlan } from '../hooks/lib/router'
import { sessionFloor } from '../hooks/lib/route'
import { makeBrief } from './support/commands'
import { plan } from './support/engine'

const OPEN: Policy = { allowFable: false, blocked: new Set(), session: null }
const routed = (over: Record<string, unknown>): RouterPlan => parseRoute(JSON.stringify(plan(over)), OPEN)!
const lead = (family: string, effort: string) => ({ model: family, effort, why: '' })
const REAL = 'Lọc tin dùng sonnet; đọc, giải thích, đúc kết dùng mô hình của phiên'

describe('0.7.5 R4: sessionFloor với quy tắc thật', () => {
  test('đúng câu của người dùng với phiên opus: sàn là opus', () => {
    expect(sessionFloor([REAL], 'opus')).toBe('opus')
  })

  test('mỗi loại việc của luồng chính tạo sàn: đọc, giải thích, đúc kết, tổng hợp, tóm tắt, viết, sửa', () => {
    for (const kind of ['đọc', 'giải thích', 'đúc kết', 'tổng hợp', 'tóm tắt', 'viết', 'sửa']) {
      expect(sessionFloor([`${kind} dùng model của phiên`], 'opus'), kind).toBe('opus')
      expect(sessionFloor([`Việc ${kind} tri thức chạy bằng session model`], 'opus'), kind).toBe('opus')
    }
  })

  test('cặp đứng sau loại việc của subagent: danh sách "lọc tin, đọc dùng mô hình của phiên" có "đọc" nên có sàn', () => {
    expect(sessionFloor(['Lọc tin, đọc dùng mô hình của phiên'], 'opus')).toBe('opus')
  })

  test('loại việc của subagent không tạo sàn: "Lọc tin dùng mô hình của phiên", "Gom số liệu dùng model của phiên"', () => {
    expect(sessionFloor(['Lọc tin dùng mô hình của phiên'], 'opus')).toBe(null)
    expect(sessionFloor(['Gom số liệu dùng model của phiên'], 'opus')).toBe(null)
    expect(sessionFloor(['Lọc tin dùng sonnet; đọc dùng sonnet'], 'opus')).toBe(null)
  })

  test('phủ định không tạo sàn', () => {
    expect(sessionFloor(['Không dùng mô hình của phiên cho việc đọc'], 'opus')).toBe(null)
    expect(sessionFloor(['Đọc, tránh dùng mô hình của phiên'], 'opus')).toBe(null)
  })

  test('chưa biết model của phiên: không có sàn', () => {
    expect(sessionFloor([REAL], null)).toBe(null)
  })

  test('động từ chỉ khớp ở đầu loại việc và là từ trọn vẹn: "Docker" không phải "đọc"', () => {
    expect(sessionFloor(['Docker xử lý dùng mô hình của phiên'], 'opus')).toBe(null)
    expect(sessionFloor(['Sửa lỗi chính tả dùng mô hình của phiên'], 'opus')).toBe('opus')
  })
})

describe('0.7.5 R4: main của brief', () => {
  test('mục tiêu mới: router chọn sonnet/medium cho luồng chính, quy tắc thật, phiên opus: main là opus, effort giữ', () => {
    const out = nextBrief(null, routed({ goal: 'Cập nhật kho tri thức', constraints: [REAL], kind: 'answer', main: lead('sonnet', 'medium') }), 'p', 1, { sessionFamily: 'opus' })
    expect(out.brief.main?.family).toBe('opus')
    expect(out.brief.main?.effort).toBe('medium')
  })

  test('tiếp nối: main không rơi về sonnet dưới phiên opus', () => {
    const prev = makeBrief({ constraints: [REAL], main: { family: 'opus', effort: 'medium' } })
    const out = nextBrief(prev, routed({ relation: 'continue', goal: '', main: lead('sonnet', 'low') }), 'tiếp', 2, { sessionFamily: 'opus' })
    expect(out.brief.main?.family).toBe('opus')
  })

  test('phiên không có model (sessionFamily null hay không truyền): main giữ nguyên sonnet, không tự nâng lên opus', () => {
    for (const options of [{ sessionFamily: null }, {}]) {
      const out = nextBrief(null, routed({ goal: 'Cập nhật kho tri thức', constraints: [REAL], kind: 'answer', main: lead('sonnet', 'medium') }), 'p', 1, options)
      expect(out.brief.main?.family).toBe('sonnet')
      expect((out.brief as { mainBase?: { family: string } }).mainBase?.family).toBe('sonnet')
    }
  })

  test('quy tắc chỉ nêu loại việc của subagent: main giữ sonnet dưới phiên opus', () => {
    const out = nextBrief(null, routed({ goal: 'Cập nhật kho tri thức', constraints: ['Lọc tin dùng mô hình của phiên'], kind: 'answer', main: lead('sonnet', 'medium') }), 'p', 1, { sessionFamily: 'opus' })
    expect(out.brief.main?.family).toBe('sonnet')
  })
})
