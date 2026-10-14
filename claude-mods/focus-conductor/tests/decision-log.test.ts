// Log quyết định (option decisionLog): ghi một dòng JSON mỗi quyết định, giữ DECISION_LIMIT dòng cuối, và flushDecisions
// ghi file bằng hàm ghi do hook truyền vào (engine không cho `$` đi qua import).

import { describe, expect, test } from 'claude-code/testing'

import { createContext } from '../hooks/context'
import { DECISION_LIMIT, clipText, decisionLine, keptLines } from '../hooks/lib/decisions'

describe('flushDecisions', () => {
  test('chưa bật decisionLog: không gọi hàm ghi, record cũng không lưu dòng nào', async () => {
    const ctx = createContext({})
    ctx.record(1000, 'route', { prompt: 'x' })
    const writes: Array<[string, string]> = []
    await ctx.flushDecisions(async (path, text) => void writes.push([path, text]))
    expect(writes).toEqual([])
    expect(ctx.decisionText()).toBe('\n')
  })

  test('đã bật: ghi đúng đường dẫn với toàn bộ các dòng, mỗi dòng một JSON và kết thúc bằng xuống dòng', async () => {
    const ctx = createContext({ decisionLog: '  /tmp/fc-decisions.jsonl  ' })
    ctx.record(0, 'route', { prompt: 'một' })
    ctx.record(1000, 'skip', { prompt: 'hai' })
    const writes: Array<[string, string]> = []
    await ctx.flushDecisions(async (path, text) => void writes.push([path, text]))
    expect(writes.length).toBe(1)
    expect(writes[0]?.[0]).toBe('/tmp/fc-decisions.jsonl')
    const text = writes[0]?.[1] ?? ''
    expect(text.endsWith('\n')).toBe(true)
    const lines = text.trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    expect(lines).toEqual([
      { at: '1970-01-01T00:00:00.000Z', kind: 'route', prompt: 'một' },
      { at: '1970-01-01T00:00:01.000Z', kind: 'skip', prompt: 'hai' },
    ])
  })

  test('lỗi ghi file bị bỏ qua, không làm hỏng hook', async () => {
    const ctx = createContext({ decisionLog: '/tmp/fc-decisions.jsonl' })
    ctx.record(0, 'route', {})
    const failing = async (): Promise<never> => {
      throw new Error('đĩa đầy')
    }
    await ctx.flushDecisions(failing)
    expect(ctx.decisionText().trim().split('\n').length).toBe(1)
  })

  test('giữ DECISION_LIMIT dòng cuối', () => {
    const ctx = createContext({ decisionLog: '/tmp/fc-decisions.jsonl' })
    for (let i = 0; i < DECISION_LIMIT + 5; i++) ctx.record(i, 'route', { n: i })
    const lines = ctx.decisionText().trim().split('\n')
    expect(lines.length).toBe(DECISION_LIMIT)
    expect(JSON.parse(lines[0] ?? '{}').n).toBe(5)
    expect(JSON.parse(lines[lines.length - 1] ?? '{}').n).toBe(DECISION_LIMIT + 4)
  })
})

describe('dòng log', () => {
  test('prompt dài bị cắt ở 300 ký tự, có dấu lược', () => {
    expect(clipText('a'.repeat(300))).toBe('a'.repeat(300))
    expect(clipText('a'.repeat(301))).toBe(`${'a'.repeat(299)}…`)
  })

  test('decisionLine ghi thời điểm ISO và loại; keptLines chỉ giữ dòng JSON hợp lệ', () => {
    expect(JSON.parse(decisionLine(86_400_000, 'drift', { onTrack: true }))).toEqual({ at: '1970-01-02T00:00:00.000Z', kind: 'drift', onTrack: true })
    expect(keptLines('{"a":1}\nrác\n{"b":2}\n')).toEqual(['{"a":1}', '{"b":2}'])
  })
})
