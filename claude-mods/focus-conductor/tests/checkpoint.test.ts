// 0.6.0 hạng mục C: điểm dừng (hooks/lib/checkpoint.ts, hàm thuần): khóa theo thư mục, kẹp kích thước, giới hạn số bản ghi.

import { describe, expect, test } from 'claude-code/testing'

import type { QuotaCheckpoint } from '../types'
import { CHECKPOINT_BYTES, CHECKPOINT_LIMIT, NOTE_MAX, buildCheckpoint, clampCheckpoint, hashCwd, pruneKeys, recentLine, storeKey, withNote } from '../hooks/lib/checkpoint'
import { makeBrief } from './support/commands'

function sample(over: Partial<Parameters<typeof buildCheckpoint>[0]> = {}): QuotaCheckpoint {
  return buildCheckpoint({
    id: 'c1',
    now: 5_000,
    cwd: '/repo/a',
    reason: [{ kind: 'five_hour', percentUsed: 96, resetsAt: '2100-01-01T00:00:00.000Z', thresholdRemainingPct: 5 }],
    brief: makeBrief({ goal: 'Sửa module', constraints: ['Không đổi API'], quality: ['Test xanh'], scopePaths: ['src/'] }),
    plan: [
      { id: 1, title: 'Đọc', status: 'done' },
      { id: 2, title: 'Sửa', status: 'doing', note: 'đang sửa a.ts' },
      { id: 3, title: 'Test', status: 'todo' },
    ],
    delegations: [{ index: 1, title: 'Tìm', state: 'failed' }],
    recent: ['Edit src/a.ts', 'Bash npm test (lỗi)'],
    files: [{ path: 'src/a.ts', mtimeMs: 4_000, size: 120 }],
    denied: { tool: 'Edit', input: '{"file_path":"src/b.ts"}' },
    ...over,
  })
}

describe('0.6.0 C: dựng điểm dừng', () => {
  test('đủ trường, version 1, trạng thái open, bước doing, chưa có note', () => {
    const cp = sample()
    expect(cp.version).toBe(1)
    expect(cp.status).toBe('open')
    expect(cp.doing).toEqual([2])
    expect(cp.note).toBe('')
    expect(cp.brief.goal).toBe('Sửa module')
    expect(cp.brief.constraints).toEqual(['Không đổi API'])
    expect(cp.brief.scopePaths).toEqual(['src/'])
    expect(cp.plan.map(s => s.status)).toEqual(['done', 'doing', 'todo'])
    expect(cp.denied).toEqual({ tool: 'Edit', input: '{"file_path":"src/b.ts"}' })
    expect(cp.cwd).toBe('/repo/a')
  })

  test('chỉ giữ năm tool call cuối, mỗi dòng tối đa 120 ký tự; tối đa 50 file', () => {
    const cp = sample({ recent: Array.from({ length: 9 }, (_, i) => `Bash lệnh ${i} ${'x'.repeat(200)}`), files: Array.from({ length: 70 }, (_, i) => ({ path: `f${i}`, mtimeMs: i, size: i })) })
    expect(cp.recent).toHaveLength(5)
    expect(cp.recent[0]).toContain('lệnh 4')
    for (const line of cp.recent) expect(line.length).toBeLessThanOrEqual(120)
    expect(cp.files).toHaveLength(50)
    expect(cp.files[49]?.path).toBe('f69')
  })

  test('recentLine: tên tool, đối tượng rút gọn, đánh dấu lỗi', () => {
    expect(recentLine('Edit', 'src/a.ts', false)).toBe('Edit src/a.ts')
    expect(recentLine('Bash', 'npm test', true)).toBe('Bash npm test (lỗi)')
    expect(recentLine('Bash', 'x'.repeat(300), false).length).toBeLessThanOrEqual(120)
  })

  test('withNote: kẹp 600 ký tự', () => {
    expect(withNote(sample(), 'y'.repeat(900)).note).toHaveLength(NOTE_MAX)
    expect(NOTE_MAX).toBe(600)
  })
})

describe('0.6.0 C: kẹp kích thước bản ghi 64 KiB', () => {
  test('bản ghi quá lớn bị cắt recent, rồi files, rồi note, tới khi vừa', () => {
    const big = { ...sample(), note: 'n'.repeat(NOTE_MAX), files: Array.from({ length: 50 }, (_, i) => ({ path: `p${i}/${'d'.repeat(1500)}`, mtimeMs: i, size: i })) }
    const out = clampCheckpoint(big)
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(CHECKPOINT_BYTES)
    expect(out.recent).toEqual([])
    expect(out.files.length).toBeLessThan(50)
    expect(out.note).toBe(big.note)
  })

  test('bản ghi vừa thì giữ nguyên', () => {
    const cp = sample()
    expect(clampCheckpoint(cp)).toEqual(cp)
    expect(CHECKPOINT_BYTES).toBe(64 * 1024)
  })
})

describe('0.6.0 C: khóa theo thư mục, tối đa năm bản ghi', () => {
  test('hai thư mục khác nhau cho hai khóa khác nhau; cùng thư mục cùng khóa', () => {
    expect(storeKey('/repo/a')).not.toBe(storeKey('/repo/b'))
    expect(storeKey('/repo/a')).toBe(storeKey('/repo/a'))
    expect(storeKey('/repo/a').startsWith('checkpoint:')).toBe(true)
    expect(hashCwd('/repo/a')).toMatch(/^[0-9a-f]{8}$/)
  })

  test('vượt năm bản ghi: bỏ consumed cũ nhất trước, rồi open cũ nhất; không bỏ bản vừa ghi', () => {
    expect(CHECKPOINT_LIMIT).toBe(5)
    const entries = [
      { key: 'k1', status: 'open' as const, createdAt: 1 },
      { key: 'k2', status: 'consumed' as const, createdAt: 2 },
      { key: 'k3', status: 'open' as const, createdAt: 3 },
      { key: 'k4', status: 'consumed' as const, createdAt: 4 },
      { key: 'k5', status: 'open' as const, createdAt: 5 },
      { key: 'k6', status: 'open' as const, createdAt: 6 },
      { key: 'k7', status: 'resuming' as const, createdAt: 7 },
    ]
    expect(pruneKeys(entries, 'k7')).toEqual(['k2', 'k4'])
    expect(pruneKeys(entries.filter(e => e.status !== 'consumed'), 'k1')).toEqual([])
    const opens = Array.from({ length: 7 }, (_, i) => ({ key: `o${i}`, status: 'open' as const, createdAt: i }))
    expect(pruneKeys(opens, 'o0')).toEqual(['o1', 'o2'])
  })
})
