// 0.9.0 vòng 2 M14: lần ghi nhật ký quyết định đầu tiên của một tiến trình đọc tệp hiện có và giữ các dòng cũ đứng trước, trong trần kích
// thước hiện có. Tiến trình chạy tiếp (`claude -p --continue`) không phát session.start trước lần ghi đầu thì các dòng cũ vẫn còn. Tệp hỏng
// hay không đọc được thì ghi mới, không văng lỗi.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { base, plan, submit } from '../support/engine'

const LOG = '/tmp/fc-m14-decisions.jsonl'
const OLD = ['{"at":1,"kind":"route","goalId":1}', '{"at":2,"kind":"plan","goalId":1}']
const OPTS = { options: { planApproval: 'off', decisionLog: LOG } }
function logFs(on: On, read: () => string) {
  const writes: string[] = []
  on('fs.read', (_$, e, next) => {
    const ev = e as { path?: string }
    if (ev.path === LOG) return { value: read() } as never
    return next(e)
  })
  on('fs.write', (_$, e, next) => {
    const ev = e as { path?: string; text?: string; content?: string }
    if (ev.path === LOG) writes.push(String(ev.text ?? ev.content ?? ''))
    return next(e)
  })
  return writes
}

describe('0.9.0 vòng 2 M14: nhật ký quyết định nối tiếp', () => {
  test('tệp có sẵn hai dòng, tiến trình mới ghi quyết định: hai dòng cũ đứng trước, rồi dòng mới', OPTS, async ($, on) => {
    const writes = logFs(on, () => `${OLD.join('\n')}\n`)
    base(on, { router: () => plan({ goal: 'Sửa luồng phí', depth: 'substantial', volume: 'medium', kind: 'edit' }) })
    await submit($, 'Sửa luồng phí')
    const lines = (writes.at(-1) ?? '').split('\n').filter(Boolean)
    expect(lines.slice(0, 2)).toEqual(OLD)
    expect(lines.length).toBeGreaterThanOrEqual(3)
  })
  test('tệp hỏng: ghi mới, không văng lỗi', OPTS, async ($, on) => {
    const writes = logFs(on, () => 'không phải JSONL\n{hỏng')
    base(on, { router: () => plan({ goal: 'Sửa luồng phí', depth: 'substantial', volume: 'medium', kind: 'edit' }) })
    await submit($, 'Sửa luồng phí')
    const lines = (writes.at(-1) ?? '').split('\n').filter(Boolean)
    expect(lines.length).toBeGreaterThanOrEqual(1)
    expect(lines.every(line => line.startsWith('{') && line.endsWith('}'))).toBe(true)
  })
})
