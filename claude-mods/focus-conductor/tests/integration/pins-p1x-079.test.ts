// 0.7.9 P1x: ghim ba chi tiết của 0.7.7 chưa có test bắt (lộ ra ở lượt đột biến của 0.7.9).
// P1a (mẫu 079-P1a): pane ghi mờ (dimColor) dòng cảnh báo nhẹ của luật X6, cảnh báo thường thì không mờ.
// P1b (mẫu 079-P1b): offerCheckHint không chạy khi cảnh báo cuối turn là cảnh báo nhẹ; cùng điều kiện mà cảnh báo thường thì vẫn gợi ý.
// P1c (mẫu 079-P1c): Read lỗi (isError) không tính là đã đọc lại, nên turn sửa .md rồi Read lỗi không có cảnh báo nhẹ.
// Từ 0.8.0 A5 file .md là thay đổi nhẹ nên Read lỗi cũng không còn cảnh báo thường.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { newTracker, observe, summarize } from '../../hooks/lib/drift'
import { edit, makeBrief } from '../support/commands'
import { COMPLEX_PROMPT, PANE, base, submit } from '../support/engine'

const SOFT_TEXT = /thay đổi tài liệu, đã đọc lại/
const PLAIN_TEXT = /không chạy bước kiểm tra nào/
const CHECK_SCRIPT = 'cd /repo && /usr/bin/python3 -B tests/check-a.py'
const brief = makeBrief()
const read = (path: string, isError: boolean) => ({ tool: 'Read', input: { file_path: path }, isError, isReadOnly: true })

/** Chạy một turn: (tùy chọn) một script kiểm chưa khai (engine báo chỉ đọc, nên không tính là ghi lạ), sửa `file`, Read `file` (lỗi hay không), rồi kết thúc turn. */
async function runTurn($: Engine, on: Parameters<typeof base>[0], file: string, options: { isReadError?: boolean; hasScript?: boolean }) {
  const seen = base(on)
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'RESULT: 47 passed, 0 failed', isReadOnly: true }))
  on('tool.call', { tool: 'Read' }, () => (options.isReadError === true ? { result: 'không đọc được', isError: true } : { result: 'nội dung' }))
  on('turn.complete', () => ({ text: '' }))
  await submit($, COMPLEX_PROMPT)
  if (options.hasScript === true) await $.tool.call({ tool: 'Bash', command: CHECK_SCRIPT } as never)
  await $.tool.call({ tool: 'Edit', file_path: file, old_string: 'a', new_string: 'b' } as never)
  await $.tool.call({ tool: 'Read', file_path: file } as never)
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as never)
  return seen
}

describe('0.7.9 P1a: pane ghi mờ cảnh báo nhẹ', () => {
  test('cảnh báo nhẹ (sửa .md rồi đọc lại) có dimColor, cảnh báo thường (sửa .ts) không mờ', {}, async ($: Engine, on) => {
    await runTurn($, on, 'docs/a.md', {})
    const pane = await $.ui.mount(PANE)
    const soft = await pane.find({ type: 'Text', text: SOFT_TEXT })
    expect(soft).toBeDefined()
    expect(soft?.props?.['dimColor']).toBe(true)
    await pane.unmount()
  })

  test('đối chiếu: cảnh báo thường không mờ', {}, async ($: Engine, on) => {
    await runTurn($, on, 'src/a.ts', {})
    const pane = await $.ui.mount(PANE)
    const plain = await pane.find({ type: 'Text', text: PLAIN_TEXT })
    expect(plain).toBeDefined()
    expect(plain?.props?.['dimColor']).not.toBe(true)
    await pane.unmount()
  })
})

describe('0.7.9 P1b: cảnh báo nhẹ không gợi ý khai checkCommands', () => {
  test('sửa .md đã đọc lại sau một script kiểm chưa khai: cảnh báo nhẹ, không có toast checkCommands', {}, async ($: Engine, on) => {
    const seen = await runTurn($, on, 'docs/a.md', { hasScript: true })
    const pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: SOFT_TEXT })).toBeDefined()
    await pane.unmount()
    expect(seen.toasts.filter(t => t.includes('checkCommands')).length).toBe(0)
  })

  test('đối chiếu: sửa .ts sau cùng script kiểm chưa khai thì vẫn đúng một toast gợi ý', {}, async ($: Engine, on) => {
    const seen = await runTurn($, on, 'src/a.ts', { hasScript: true })
    expect(seen.toasts.filter(t => t.includes('checkCommands')).length).toBe(1)
  })
})

describe('0.7.9 P1c: Read lỗi không tính là đã đọc lại', () => {
  test('tracker: Edit .md rồi Read lỗi là cảnh báo thường; Read thành công là cảnh báo nhẹ', () => {
    const finding = (isError: boolean) => {
      const tracker = newTracker('t')
      for (const call of [edit('/p/a.md'), read('/p/a.md', isError)]) observe(tracker, call, brief, [])
      return summarize(tracker, brief, []).find(f => f.kind === 'unverified')
    }
    expect(finding(true)).toBeUndefined()
    expect(finding(false)?.isSoft).toBe(true)
  })

  test('tích hợp: Edit .md rồi Read trả lỗi: pane không có cảnh báo thường, không có dòng cảnh báo nhẹ', {}, async ($: Engine, on) => {
    await runTurn($, on, 'docs/a.md', { isReadError: true })
    const pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: PLAIN_TEXT })).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: SOFT_TEXT })).toBeUndefined()
    await pane.unmount()
  })

  test('tích hợp: Edit .md rồi Read thành công: pane có cảnh báo nhẹ', {}, async ($: Engine, on) => {
    await runTurn($, on, 'docs/a.md', {})
    const pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: SOFT_TEXT })).toBeDefined()
    await pane.unmount()
  })
})
