// 0.9.0 B1: router trả thêm hai danh sách tùy chọn: tệp trạng thái của lượt (stateFiles: tệp kế hoạch, tiến độ, bàn giao prompt nêu đường
// dẫn) và nơi ghi phụ prompt cho phép (sideWrites: nơi sao lưu, thư mục tạm, tệp đầu ra). Chép đúng như prompt viết, mỗi danh sách tối đa 8
// mục, vắng thì rỗng. parseRoute bỏ mục là cả cây thư mục, thư mục gốc, thư mục nhà, gốc phiên; tệp trạng thái chỉ nhận đuôi tài liệu nhẹ
// và không nhận tên SKILL.md. Brief lưu hai danh sách; prompt tiếp nối cùng mục tiêu gộp thêm, không xóa; router lỗi thì rỗng.

import { describe, expect, test } from 'claude-code/testing'
import { bareBrief, nextBrief, parseRoute, routerSystem } from '../hooks/lib/router'
import type { Policy, RouterPlan } from '../hooks/lib/router'
import { normalizeCore } from '../hooks/lib/state'
import type { Brief } from '../types'

const normalizeBrief = (brief: Brief): Brief => normalizeCore({ brief } as never).brief as Brief
import { makeBrief } from './support/commands'
import { plan } from './support/engine'

const OPEN: Policy = { allowFable: false, blocked: new Set(), session: null, root: '/work/repo' }
type Lists = { stateFiles?: string[]; sideWrites?: string[] }
const routed = (over: Record<string, unknown>): RouterPlan & Lists => parseRoute(JSON.stringify(plan(over)), OPEN) as RouterPlan & Lists
const S = '/work/run/TIEN-DO.md'

describe('0.9.0 B1: parseRoute đọc stateFiles và sideWrites', () => {
  test('1. đúng dạng: đọc nguyên văn', () => {
    const out = routed({ stateFiles: ['/work/run/KE-HOACH.md', S, '/work/run/DIEM-DUNG.md'], sideWrites: ['/work/backup', '/tmp/out.json'] })
    expect(out.stateFiles).toEqual(['/work/run/KE-HOACH.md', S, '/work/run/DIEM-DUNG.md'])
    expect(out.sideWrites).toEqual(['/work/backup', '/tmp/out.json'])
  })
  test('2. vắng trường: hai danh sách rỗng', () => {
    const out = routed({})
    expect(out.stateFiles).toEqual([])
    expect(out.sideWrites).toEqual([])
  })
  test('3. sai kiểu (chuỗi, số, đối tượng): rỗng; phần tử không phải chuỗi bị bỏ', () => {
    expect(routed({ stateFiles: S, sideWrites: 5 }).stateFiles).toEqual([])
    expect(routed({ sideWrites: { a: 1 } }).sideWrites).toEqual([])
    expect(routed({ stateFiles: [S, 3, null], sideWrites: [true, '/tmp/x'] })).toMatchObject({ stateFiles: [S], sideWrites: ['/tmp/x'] })
  })
  test('4. quá 8 mục: giữ 8 mục đầu', () => {
    const many = Array.from({ length: 12 }, (_, i) => `/work/run/f${i}.md`)
    expect(routed({ stateFiles: many }).stateFiles).toEqual(many.slice(0, 8))
    expect(routed({ sideWrites: many }).sideWrites?.length).toBe(8)
  })
  test('5. mục là cả cây, thư mục gốc, thư mục nhà, gốc phiên: bị bỏ', () => {
    const bad = ['/', '.', './', '~', '~/', '$HOME', '/work/repo', '/work/repo/', '**', 'src/**', '/work/*']
    expect(routed({ sideWrites: [...bad, '/work/backup'] }).sideWrites).toEqual(['/work/backup'])
    expect(routed({ stateFiles: [...bad, S] }).stateFiles).toEqual([S])
  })
  test('6. tệp trạng thái chỉ nhận đuôi tài liệu nhẹ: .ts, .json, thư mục bị bỏ', () => {
    expect(routed({ stateFiles: ['/work/run/a.ts', '/work/run/b.json', '/work/run/', S, '/work/run/log.txt'] }).stateFiles).toEqual([S, '/work/run/log.txt'])
  })
  test('7. tệp trạng thái không nhận SKILL.md', () => {
    expect(routed({ stateFiles: ['/x/skills/abc/SKILL.md', '/x/skill.md', S] }).stateFiles).toEqual(['/x/skill.md', S])
  })
  test('8. chuỗi rỗng, có khoảng trắng, không giống đường dẫn: bị bỏ', () => {
    expect(routed({ stateFiles: ['', '  ', 'tệp tiến độ', S] }).stateFiles).toEqual([S])
  })
})

describe('0.9.0 B1: brief lưu và gộp hai danh sách', () => {
  test('mục tiêu mới: brief mang hai danh sách', () => {
    const out = nextBrief(null, routed({ stateFiles: [S], sideWrites: ['/work/backup'] }), 'làm', 1)
    expect(out.brief).toMatchObject({ stateFiles: [S], sideWrites: ['/work/backup'] })
  })
  test('prompt tiếp nối cùng mục tiêu: gộp thêm, không xóa', () => {
    const prev = { ...makeBrief(), stateFiles: [S], sideWrites: ['/work/backup'] }
    const out = nextBrief(prev, routed({ relation: 'continue', goal: '', stateFiles: ['/work/run/DIEM-DUNG.md'], sideWrites: [] }), 'tiếp', 2)
    expect(out.brief).toMatchObject({ stateFiles: [S, '/work/run/DIEM-DUNG.md'], sideWrites: ['/work/backup'] })
  })
  test('trạng thái từ bản cũ không có trường: normalizeBrief cho hai danh sách rỗng hay vắng, không lỗi', () => {
    const old = normalizeBrief(makeBrief()) as Lists
    expect(old.stateFiles ?? []).toEqual([])
    expect(old.sideWrites ?? []).toEqual([])
    const kept = normalizeBrief({ ...makeBrief(), stateFiles: [S, 3], sideWrites: 'x' } as never) as Lists
    expect(kept.stateFiles).toEqual([S])
    expect(kept.sideWrites ?? []).toEqual([])
  })
  test('router lỗi (brief tối thiểu): hai danh sách rỗng', () => {
    const bare = bareBrief('làm', 1, 1) as Lists
    expect(bare.stateFiles ?? []).toEqual([])
    expect(bare.sideWrites ?? []).toEqual([])
  })
  test('lời dặn router nêu hai trường và có trong mẫu JSON', () => {
    const text = routerSystem()
    expect(text).toContain('"stateFiles": string[]')
    expect(text).toContain('"sideWrites": string[]')
  })
})
