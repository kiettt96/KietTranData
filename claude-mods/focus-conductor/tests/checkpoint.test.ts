// 0.6.0 hạng mục C: điểm dừng (hooks/lib/checkpoint.ts, hàm thuần): khóa theo thư mục, kẹp kích thước, giới hạn số bản ghi.

import { describe, expect, test } from 'claude-code/testing'

import type { QuotaCheckpoint } from '../types'
import { CHECKPOINT_BYTES, CHECKPOINT_LIMIT, FORCE_FALLBACK_MS, NOTE_MAX, briefFromCheckpoint, buildCheckpoint, changedFiles, clampCheckpoint, forceUntil, hashCwd, pruneKeys, recentLine, storeKey, withNote } from '../hooks/lib/checkpoint'
import { RESUME_MAX, quotaStatusLines, resumeContext } from '../hooks/lib/text'
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

describe('0.6.0 D: khối tiếp tục và so sánh file (hàm thuần)', () => {
  test('changedFiles: mtime hay size đổi, hoặc file mất, là đổi sau điểm dừng', () => {
    const files = [
      { path: 'a.ts', mtimeMs: 10, size: 5 },
      { path: 'b.ts', mtimeMs: 10, size: 5 },
      { path: 'c.ts', mtimeMs: 10, size: 5 },
      { path: 'd.ts', mtimeMs: 10, size: 5 },
    ]
    const stats = new Map([
      ['a.ts', { mtimeMs: 10, size: 5 }],
      ['b.ts', { mtimeMs: 11, size: 5 }],
      ['c.ts', { mtimeMs: 10, size: 6 }],
    ])
    expect(changedFiles(files, stats)).toEqual(['b.ts', 'c.ts', 'd.ts'])
  })

  test('resumeContext: tiêu đề ĐIỂM DỪNG, mục tiêu, checklist, note, lệnh bị từ chối, file đổi, quy tắc; tối đa 2000 ký tự', () => {
    const cp = withNote(sample(), 'Chạy lại npm test sau khi sửa b.ts; a.ts đã xong, không sửa lại.')
    const text = resumeContext(cp, ['src/a.ts'])
    expect(text.startsWith('[focus-conductor] ĐIỂM DỪNG')).toBe(true)
    for (const part of ['Sửa module', 'Không đổi API', 'Test xanh', '[~] 2. Sửa', 'Chạy lại npm test', 'Edit {"file_path":"src/b.ts"}', 'src/a.ts', 'git status', 'không chạy lại', 'hạn mức phiên']) {
      expect(text).toContain(part)
    }
    expect(text.length).toBeLessThanOrEqual(RESUME_MAX)
    expect(RESUME_MAX).toBe(2000)
  })

  test('resumeContext dài vẫn không quá 2000 ký tự và vẫn giữ quy tắc tiếp tục', () => {
    const plan = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, title: `Bước ${i + 1} ${'t'.repeat(150)}`, status: 'todo' as const }))
    const cp = withNote(sample({ plan }), 'n'.repeat(600))
    const text = resumeContext(cp, Array.from({ length: 40 }, (_, i) => `src/file-${i}.ts`))
    expect(text.length).toBeLessThanOrEqual(RESUME_MAX)
    expect(text).toContain('Quy tắc tiếp tục')
    expect(text).toContain('ĐIỂM DỪNG')
  })

  test('không có file đổi: không có mục file đổi', () => {
    expect(resumeContext(sample(), [])).not.toContain('đổi sau lúc dừng')
  })

  test('forceUntil: mốc làm mới sớm nhất của các cửa sổ đang dừng, không có thì bốn giờ sau', () => {
    const reasons = [
      { kind: 'five_hour' as const, percentUsed: 97, resetsAt: '1970-01-01T00:10:00.000Z', thresholdRemainingPct: 5 },
      { kind: 'seven_day' as const, percentUsed: 99, resetsAt: '1970-01-01T00:05:00.000Z', thresholdRemainingPct: 2 },
    ]
    expect(forceUntil(reasons, 1_000)).toBe(300_000)
    expect(forceUntil([{ kind: 'five_hour', percentUsed: 97, thresholdRemainingPct: 5 }], 1_000)).toBe(1_000 + FORCE_FALLBACK_MS)
    expect(FORCE_FALLBACK_MS).toBe(4 * 3_600_000)
  })

  test('briefFromCheckpoint: dựng lại mục tiêu đủ trường từ điểm dừng', () => {
    const brief = briefFromCheckpoint(sample(), 7_000)
    expect(brief.goal).toBe('Sửa module')
    expect(brief.constraints).toEqual(['Không đổi API'])
    expect(brief.scopePaths).toEqual(['src/'])
    expect(brief.steps).toEqual(['Đọc', 'Sửa', 'Test'])
    expect(brief.main).toBeNull()
    expect(brief.at).toBe(7_000)
  })
})

describe('0.6.0 F: biên của điểm dừng (mẫu đột biến 060- sống sót ở lượt đầu)', () => {
  test('clampCheckpoint: dài đúng 64 KiB thì giữ nguyên, không cắt recent', () => {
    const cp = sample()
    const pad = CHECKPOINT_BYTES - JSON.stringify(cp).length
    const exact = { ...cp, plan: [{ ...cp.plan[0]!, title: `${cp.plan[0]!.title}${'x'.repeat(pad)}` }, ...cp.plan.slice(1)] }
    expect(JSON.stringify(exact).length).toBe(CHECKPOINT_BYTES)
    expect(clampCheckpoint(exact)).toEqual(exact)
  })

  test('clampCheckpoint: bỏ file cũ nhất trước, giữ các file mới nhất đúng thứ tự', () => {
    const files = Array.from({ length: 50 }, (_, i) => ({ path: `p${i}/${'d'.repeat(1500)}`, mtimeMs: i, size: i }))
    const out = clampCheckpoint({ ...sample(), files })
    expect(out.files.length).toBeGreaterThan(0)
    expect(out.files.length).toBeLessThan(50)
    expect(out.files).toEqual(files.slice(50 - out.files.length))
  })

  test('pruneKeys: không bao giờ xóa bản vừa ghi, kể cả khi nó là consumed cũ nhất', () => {
    const entries = [
      { key: 'keep', status: 'consumed' as const, createdAt: 0 },
      ...Array.from({ length: 5 }, (_, i) => ({ key: `o${i}`, status: 'open' as const, createdAt: i + 1 })),
    ]
    const out = pruneKeys(entries, 'keep')
    expect(out).toEqual(['o0'])
    expect(out).not.toContain('keep')
  })

  test('forceUntil: mốc làm mới đúng bằng bây giờ đã qua, dùng bốn giờ sau', () => {
    expect(forceUntil([{ kind: 'five_hour', percentUsed: 97, resetsAt: '1970-01-01T00:00:01.000Z', thresholdRemainingPct: 5 }], 1_000)).toBe(1_000 + FORCE_FALLBACK_MS)
  })

  test('changedFiles: file không còn (stat null) là đổi sau điểm dừng', () => {
    expect(changedFiles([{ path: 'a.ts', mtimeMs: 1, size: 1 }], new Map([['a.ts', null]]))).toEqual(['a.ts'])
  })

  test('resumeContext: vượt nhẹ thì bỏ tool call cuối trước, giữ nguyên note', () => {
    const note = `Bước kế tiếp: ${'n'.repeat(500)}`
    const recent = Array.from({ length: 5 }, (_, i) => `Bash lệnh ${i} ${'r'.repeat(100)}`)
    const base = withNote(sample({ recent }), note)
    let files: string[] = []
    // Thêm file đổi tới sát ngưỡng: khối không có tool call cuối vẫn vừa (note còn nguyên, checklist đủ ba bước).
    for (let i = 0; i < 200; i++) {
      const more = [...files, `src/f-${i}.ts`]
      const text = resumeContext({ ...base, recent: [] }, more)
      if (!text.includes(note) || !text.includes(' 3. Test')) break
      files = more
    }
    expect(files.length).toBeGreaterThan(0)
    expect(files.length).toBeLessThan(200)
    expect(resumeContext(base, files).length).toBeLessThanOrEqual(RESUME_MAX)
    expect(resumeContext({ ...base, recent: [] }, files)).toBe(resumeContext(base, files))
    expect(resumeContext(base, files)).toContain(note)
    expect(resumeContext(base, files)).not.toContain('Tool call cuối')
  })

  test('resumeContext: cắt checklist từ cuối, luôn giữ ít nhất bước đầu', () => {
    const plan = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, title: `Bước ${i + 1} ${'t'.repeat(150)}`, status: 'todo' as const }))
    const cp = withNote(sample({ plan }), 'n'.repeat(600))
    const text = resumeContext(cp, Array.from({ length: 40 }, (_, i) => `src/file-${i}.ts`))
    expect(text).toContain(' 1. Bước 1 t')
    expect(text).not.toContain(' 20. Bước 20 t')
  })

  test('quotaStatusLines: điểm dừng đã consumed không được liệt kê', () => {
    const input = { enabled: true, limits: [], thresholds: { session: 5, week: 2 }, pause: null, overrideUntil: 0, overrideKinds: [], now: 1_000 }
    expect(quotaStatusLines({ ...input, checkpoint: { ...sample(), status: 'consumed' } }).join('\n')).not.toContain('điểm dừng:')
    expect(quotaStatusLines({ ...input, checkpoint: sample() }).join('\n')).toContain('điểm dừng:')
  })
})
