// 0.7.9 X6a: ba ca làm turn chỉ sửa tài liệu bị cảnh báo thường sai. mkdir là thay đổi trung tính; tài liệu đã rm không cần đọc lại,
// tài liệu đã mv chỉ cần đọc lại file đích; Read một đoạn (offset hay limit) không tính là đã đọc lại, trừ khi biết file ngắn hơn đoạn đã đọc.

import { describe, expect, test } from 'claude-code/testing'
import { newTracker, observe, summarize } from '../hooks/lib/drift'
import { bash, edit, makeBrief } from './support/commands'

const brief = makeBrief()
type Call = { tool: string; input: Record<string, unknown>; isError: boolean; isReadOnly: boolean; output?: string }
const read = (path: string, extra: Record<string, unknown> = {}, output?: string): Call => ({
  tool: 'Read',
  input: { file_path: path, ...extra },
  isError: false,
  isReadOnly: true,
  ...(output !== undefined ? { output } : {}),
})
const soft = (calls: readonly Call[]) => {
  const tracker = newTracker('t')
  for (const call of calls) observe(tracker, call as never, brief, [])
  return summarize(tracker, brief, []).find(f => f.kind === 'unverified')?.isSoft === true
}
const lines = (n: number) => Array.from({ length: n }, (_, i) => `dòng ${i + 1}`).join('\n')

describe('0.7.9 X6a: mkdir trung tính', () => {
  test('mkdir thư mục mới, Write .md trong đó rồi đọc lại: nhẹ', () => {
    expect(soft([bash('mkdir /p/docs') as Call, edit('/p/docs/a.md') as Call, read('/p/docs/a.md')])).toBe(true)
  })

  test('mkdir -p: nhẹ', () => {
    expect(soft([bash('mkdir -p /p/docs/sub') as Call, edit('/p/docs/sub/a.md') as Call, read('/p/docs/sub/a.md')])).toBe(true)
  })
})

describe('0.7.9 X6a: rm và mv tài liệu', () => {
  test('rm một .md cùng Edit .md khác đã đọc lại: nhẹ', () => {
    expect(soft([edit('/p/a.md') as Call, bash('rm /p/old.md') as Call, read('/p/a.md')])).toBe(true)
  })

  test('mv a.md sang b.md, đọc lại b.md: nhẹ', () => {
    expect(soft([edit('/p/a.md') as Call, bash('mv /p/a.md /p/b.md') as Call, read('/p/b.md')])).toBe(true)
  })

  test('mv a.md sang b.md, chưa đọc lại b.md: thường', () => {
    expect(soft([edit('/p/a.md') as Call, bash('mv /p/a.md /p/b.md') as Call, read('/p/a.md')])).toBe(false)
  })

  test('rm một .ts: thường', () => {
    expect(soft([edit('/p/a.md') as Call, bash('rm /p/x.ts') as Call, read('/p/a.md')])).toBe(false)
  })
})

describe('0.7.9 X6a: Read một đoạn', () => {
  test('Read có offset: không tính là đọc lại', () => {
    expect(soft([edit('/p/a.md') as Call, read('/p/a.md', { offset: 40, limit: 20 }, lines(20))])).toBe(false)
  })

  test('Read có limit 200 mà file chỉ 12 dòng: tính là đọc lại', () => {
    expect(soft([edit('/p/a.md') as Call, read('/p/a.md', { limit: 200 }, lines(12))])).toBe(true)
  })

  test('Read có limit 20 và đủ 20 dòng: không tính (có thể còn dòng sau)', () => {
    expect(soft([edit('/p/a.md') as Call, read('/p/a.md', { limit: 20 }, lines(20))])).toBe(false)
  })

  test('Read có limit mà không biết số dòng: không tính', () => {
    expect(soft([edit('/p/a.md') as Call, read('/p/a.md', { limit: 200 })])).toBe(false)
  })

  test('Read không offset, không limit: vẫn tính như 0.7.7', () => {
    expect(soft([edit('/p/a.md') as Call, read('/p/a.md')])).toBe(true)
  })
})
