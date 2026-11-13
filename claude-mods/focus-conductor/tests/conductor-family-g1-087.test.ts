// 0.8.7 G1: vai điều phối không gắn cứng với Fable. Một bảng họ model (hooks/lib/families.ts) là nguồn duy nhất của tên họ, thứ hạng, ID
// ghim, giá, cửa sổ, thông số đọc và thời gian chờ của vai điều phối. Option conductor nhận off hay tên một họ có cờ điều phối (fable, opus);
// giá trị khác là off. Họ dự phòng trùng họ chính là không có dự phòng. Chữ 'fable' trong hooks/ chỉ còn ở các vị trí được phép.

import { describe, expect, test } from 'claude-code/testing'
import type { ModelFamily } from '../types'
import { CONDUCTOR_FAMILIES, DEFAULT_CONDUCTOR, FAMILY_TABLE } from '../hooks/lib/families'
import { FAMILIES, pinnedId } from '../hooks/lib/route'
import { DEFAULT_WINDOWS, bundledPrices } from '../hooks/lib/cost'
import { READ_PARAMS, readParamsOf } from '../hooks/lib/reading'
import { activeConductor, conductorOf } from '../hooks/lib/conductor'
import type { ConductorInputs } from '../hooks/lib/conductor'
import * as S from '../hooks/lib/state'
import { FABLE_SITES } from './fixtures/fable-sites'

describe('0.8.7 G1: bảng họ model', () => {
  test('mỗi họ có đủ mọi trường; FAMILIES theo thứ hạng của bảng; khóa của bảng khớp FAMILIES', () => {
    const keys = Object.keys(FAMILY_TABLE) as ModelFamily[]
    expect([...keys].sort((a, b) => FAMILY_TABLE[a].rank - FAMILY_TABLE[b].rank)).toEqual([...FAMILIES])
    expect([...FAMILIES]).toEqual(['haiku', 'sonnet', 'opus', 'fable'])
    for (const family of keys) {
      const row = FAMILY_TABLE[family]
      expect(typeof row.rank).toBe('number')
      expect(row.pinnedId.startsWith('claude-')).toBe(true)
      expect(Object.keys(row.price).sort()).toEqual(['cacheRead', 'input', 'output'])
      expect(row.window).toBeGreaterThan(0)
      expect('read' in row && 'conductor' in row).toBe(true)
    }
  })

  test('ID ghim, bảng giá, bảng cửa sổ và thông số đọc khớp bảng', () => {
    const prices = bundledPrices()
    for (const family of FAMILIES) {
      expect(pinnedId(family)).toBe(FAMILY_TABLE[family].pinnedId)
      expect(prices[family]).toEqual(FAMILY_TABLE[family].price)
      expect(DEFAULT_WINDOWS[family]).toBe(FAMILY_TABLE[family].window)
      const read = FAMILY_TABLE[family].read
      if (read !== null) expect(readParamsOf(family)).toEqual(read)
    }
    expect(READ_PARAMS.fable).toEqual(FAMILY_TABLE.fable.read)
    expect(READ_PARAMS.sonnet).toEqual(FAMILY_TABLE.sonnet.read)
  })

  test('họ làm được vai điều phối: fable và opus; mặc định khuyến nghị fable; thời gian chờ của opus bằng của Fable', () => {
    expect([...CONDUCTOR_FAMILIES]).toEqual(['opus', 'fable'])
    expect(DEFAULT_CONDUCTOR).toBe('fable')
    expect(FAMILY_TABLE.opus.conductor).toEqual(FAMILY_TABLE.fable.conductor)
  })
})

describe('0.8.7 G1: option conductor', () => {
  test('off, fable, opus; họ không có cờ điều phối, chuỗi lạ, rỗng hay viết hoa: off', () => {
    expect(conductorOf({})).toBe('off')
    expect(conductorOf({ conductor: 'off' })).toBe('off')
    expect(conductorOf({ conductor: 'fable' })).toBe('fable')
    expect(conductorOf({ conductor: 'opus' })).toBe('opus')
    expect(conductorOf({ conductor: 'haiku' })).toBe('off')
    expect(conductorOf({ conductor: 'sonnet' })).toBe('off')
    expect(conductorOf({ conductor: 'gpt' })).toBe('off')
    expect(conductorOf({ conductor: '' })).toBe('off')
    expect(conductorOf({ conductor: 'Fable' })).toBe('off')
  })

  test('họ chính opus: điều phối là opus; dự phòng sonnet nhận vai khi opus tạm ngừng; dự phòng trùng họ chính là không có', () => {
    const base: ConductorInputs = { option: 'opus', mode: 'auto', headless: false, blocked: new Set(), pauseLeft: 0, sessionPolicy: 'auto', sessionFamily: null, fallback: 'sonnet', fallbackPauseLeft: 0 }
    expect(activeConductor(base)).toEqual({ family: 'opus', isFallback: false, reason: null })
    expect(activeConductor({ ...base, pauseLeft: 2 })).toEqual({ family: 'sonnet', isFallback: true, reason: 'paused' })
    expect(activeConductor({ ...base, pauseLeft: 2, fallback: 'opus' })).toBeNull()
    expect(activeConductor({ ...base, blocked: new Set<ModelFamily>(['opus']) })).toEqual({ family: 'sonnet', isFallback: true, reason: 'blocked' })
  })
})

describe('0.8.7 G1: chữ fable trong hooks/', () => {
  test("chuỗi 'fable' chỉ còn ở các vị trí được phép", () => {
    // Vị trí được phép và lý do:
    // - lib/families.ts: DEFAULT_CONDUCTOR, giá trị mặc định khuyến nghị của option conductor.
    // - lib/route.ts (2 lần, avoidBlocked): luật allowFable, họ opus bị chặn thì lên fable khi được phép.
    // - lib/router.ts (4 lần): allowedLine, fitPick, topFamily (quyền thực thi của allowFable, luật kẹp fable về opus) và giá của fable
    //   trong danh mục model của lời dặn router (không đổi một byte, golden không ghi lại).
    const ALLOWED: Record<string, number> = { 'lib/families.ts': 1, 'lib/route.ts': 3, 'lib/router.ts': 4 }
    // Kit test không đọc được tệp nguồn: phép đếm chạy ở node scripts/version-check.mjs (CI), ghi vào tests/fixtures/fable-sites.ts; script
    // báo lỗi khi tệp đó không khớp mã hiện tại.
    expect(FABLE_SITES).toEqual(ALLOWED)
  })
})

describe('0.8.7 G1: nạp trạng thái 0.8.6', () => {
  test('Core có trường fable của vai điều phối cũ: đọc được, giữ nguyên', () => {
    const old = { ...S.EMPTY_CORE, fable: { failures: 1, pauseLeft: 2, ready: true, reason: 'paused', holdKey: '', briefedGoal: 3, promptPaused: false } } as Record<string, unknown>
    delete old['fallback']
    const core = S.normalizeCore(old as never)
    expect(core.fable).toEqual({ failures: 1, pauseLeft: 2, ready: true, reason: 'paused', holdKey: '', briefedGoal: 3, promptPaused: false })
  })
})
