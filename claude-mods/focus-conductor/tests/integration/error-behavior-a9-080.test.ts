// 0.8.0 A9: nhật ký lỗi errors.json ghi cả sự cố hành vi của mod (nhóm behavior): retry-exhausted theo danh tính lệnh, verify-reject lặp từ
// lần hai cho cùng bước, mục prompt bị bỏ hay bị thay, router lỗi theo loại lỗi. Cùng cơ chế gộp theo khóa, trần và pruneFixed của L1;
// /conductor errors hiện nhóm này sau nhóm lỗi mã; không chèn gì vào context.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import * as errlog from '../../hooks/lib/errlog'
import { EMPTY_ERRORS, mergeEntry, parseErrorFile, pruneFixed, setErrorSink } from '../../hooks/lib/errlog'
import type { ErrorEvent, ErrorFile } from '../../hooks/lib/errlog'
import { labels } from '../../hooks/ui/labels'
import { JS } from '../fixtures/runner-output'
import { LONG_CODED_PROMPT } from '../fixtures/prompt-long-coded'
import { COMPLEX_PROMPT, ROUTER_TIMEOUT, base, conductor, plan, step, submit } from '../support/engine'
import type { Seen } from '../support/engine'

// Hàm mới của A9 lấy qua namespace, để test đỏ đếm từng ca khi mã chưa có hàm (không làm tệp hỏng khi nạp).
type BehaviorWhere = 'retry-exhausted' | 'verify-reject' | 'dropped' | 'replaced' | 'router-fail'
const api = errlog as unknown as Record<string, unknown>
const noteBehavior = (where: BehaviorWhere, message: string): void => (api['noteBehavior'] as (w: BehaviorWhere, m: string) => void)(where, message)
const behaviorEntries = (file: ErrorFile, limit: number): ErrorFile['entries'] =>
  (api['behaviorEntries'] as ((f: ErrorFile, n: number) => ErrorFile['entries']) | undefined)?.(file, limit) ?? []

const FILE = '/repo/.focus-conductor/errors.json'
const PLAN = 'mcp__focus-conductor__plan'
const T0 = '2026-11-05T10:00:00+07:00'
const GOAL = plan({ goal: 'Sửa hàm tính phí', depth: 'substantial', volume: 'medium', main: { model: 'sonnet', effort: 'medium' } })

function disk(on: On) {
  const files = new Map<string, string>()
  on('fs.read', (_$, e) => {
    const text = files.get(e.path)
    if (text === undefined) return { deny: `ENOENT: no such file or directory, open '${e.path}'` } as never
    return { value: text } as never
  })
  on('fs.write', (_$, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  return { files, log: (): ErrorFile => parseErrorFile(files.get(FILE) ?? ''), behavior: () => behaviorEntries(parseErrorFile(files.get(FILE) ?? ''), 50) }
}

function startHooks(on: On) {
  on('tool.register', () => ({ value: { tool: PLAN } }) as never)
  on('command.register', () => ({ value: { command: 'conductor' } }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
}

const behaviorEvent = (where: BehaviorWhere, message: string): ErrorEvent => ({ group: 'behavior', where, message })

describe('0.8.0 A9: nhóm behavior (hàm thuần)', () => {
  test('hai lần retry-exhausted cùng lệnh: một mục, count 2; lệnh khác: mục thứ hai', () => {
    let file: ErrorFile = EMPTY_ERRORS
    file = mergeEntry(file, behaviorEvent('retry-exhausted', 'hết lượt chạy lại: npm test'), T0, '0.8.0')
    file = mergeEntry(file, behaviorEvent('retry-exhausted', 'hết lượt chạy lại: npm test'), '2026-11-05T10:05:00+07:00', '0.8.0')
    expect(file.entries.length).toBe(1)
    expect(file.entries[0]).toMatchObject({ group: 'behavior', where: 'retry-exhausted', count: 2, firstSeen: T0, lastSeen: '2026-11-05T10:05:00+07:00' })
    file = mergeEntry(file, behaviorEvent('retry-exhausted', 'hết lượt chạy lại: pytest'), T0, '0.8.0')
    expect(file.entries.length).toBe(2)
  })

  test('mục có đường dẫn tuyệt đối: lưu <path>', () => {
    const file = mergeEntry(EMPTY_ERRORS, behaviorEvent('retry-exhausted', 'hết lượt chạy lại: bash /srv/du-an/scripts/check.sh'), T0, '0.8.0')
    expect(file.entries[0]!.message).toContain('<path>')
    expect(file.entries[0]!.message).not.toContain('/srv/du-an')
    expect(file.entries[0]!.key).not.toContain('/srv/du-an')
  })

  test('noteBehavior đi qua bộ nhận lỗi với nhóm behavior', () => {
    const got: ErrorEvent[] = []
    setErrorSink(event => got.push(event))
    noteBehavior('router-fail', 'timeout')
    setErrorSink(null)
    expect(got).toEqual([{ group: 'behavior', where: 'router-fail', message: 'timeout' }])
  })

  test('pruneFixed hoạt động với mục behavior; file có mục behavior vẫn đọc được', () => {
    const file = mergeEntry(EMPTY_ERRORS, behaviorEvent('dropped', 'mục bị bỏ'), T0, '0.7.9')
    expect(parseErrorFile(JSON.stringify(file)).entries.length).toBe(1)
    expect(pruneFixed(file, '0.8.0', [{ key: file.entries[0]!.key, fixedIn: '0.8.0', note: 'đã sửa' }]).entries).toEqual([])
  })

  test('nhãn mới có vi và en', () => {
    expect(labels('vi').behaviorHead(2)).toContain('hành vi')
    expect(labels('en').behaviorHead(2)).toContain('behavior')
    expect(labels('en').behaviorLine('dropped', 'm', 2, 'a', 'b')).toContain('times')
  })
})

describe('0.8.0 A9: nối vào mod', () => {
  test('verify-reject một lần: không ghi; lần hai cùng bước: ghi, count 1, kèm lần đầu và lần cuối', {}, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    const fs = disk(on)
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }, { title: 'Viết' }] })
    await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: 'npm test: 12 pass' })
    await conductor($, 'errors')
    expect(fs.behavior().filter(e => e.where === 'verify-reject')).toEqual([])
    await $.tool.call({ tool: PLAN, action: 'update', step: 2, status: 'verified', evidence: 'npm test: 12 pass' })
    await conductor($, 'errors')
    expect(fs.behavior().filter(e => e.where === 'verify-reject')).toEqual([])
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: 'npm test: 12 pass' })
    const out = await conductor($, 'errors')
    const rejects = fs.behavior().filter(e => e.where === 'verify-reject')
    expect(rejects.length).toBe(1)
    expect(rejects[0]).toMatchObject({ group: 'behavior', count: 1 })
    expect(rejects[0]!.firstSeen).toBe(rejects[0]!.lastSeen)
    expect(rejects[0]!.message).toMatch(/^bước <n> bị từ chối lần <n>/)
    expect(JSON.stringify(out)).toContain('Sự cố hành vi')
  })

  test('router lỗi ba lần cùng loại: một mục behavior router-fail, nhóm router vẫn có; hiện sau nhóm lỗi mã', {}, async ($, on) => {
    base(on, { router: () => ROUTER_TIMEOUT })
    const fs = disk(on)
    for (const text of ['Sửa module thanh toán', 'Thêm báo cáo doanh thu', 'Viết test đăng ký']) await submit($, text)
    const out = JSON.stringify(await conductor($, 'errors'))
    const fails = fs.behavior().filter(e => e.where === 'router-fail')
    expect(fails.length).toBe(1)
    expect(fails[0]!.count).toBeGreaterThanOrEqual(2)
    expect(fs.log().entries.some(e => e.group === 'router')).toBe(true)
    expect(out.indexOf('router · ')).toBeGreaterThanOrEqual(0)
    expect(out.indexOf('router · ')).toBeLessThan(out.indexOf('Sự cố hành vi'))
  })

  test('mục prompt tiếp nối bị bỏ: một mục dropped; mô tả không chứa nội dung prompt', {}, async ($, on) => {
    const first = plan({ goal: 'Cập nhật sổ giá theo 11 bước', depth: 'hard', volume: 'large', requirements: Array.from({ length: 30 }, (_, i) => `Yêu cầu gốc ${i + 1}`) })
    const many = plan({ relation: 'refine', goal: '', requirements: Array.from({ length: 12 }, (_, i) => `Tinh chỉnh ${i + 1}`) })
    base(on, { router: request => (request.includes('thêm 12 yêu cầu') ? many : first) })
    const fs = disk(on)
    await submit($, LONG_CODED_PROMPT)
    await submit($, 'thêm 12 yêu cầu')
    await conductor($, 'errors')
    const dropped = fs.behavior().filter(e => e.where === 'dropped')
    expect(dropped.length).toBe(1)
    expect(dropped[0]!.message).not.toContain('Tinh chỉnh')
    expect(dropped[0]!.message).toContain('<n> mục')
  })

  test('bộ nhớ context không đổi: errors không có trong context của lượt kế', {}, async ($, on) => {
    const seen = base(on, { router: () => ROUTER_TIMEOUT })
    disk(on)
    await submit($, 'Sửa module thanh toán')
    await conductor($, 'errors')
    const result = await $.turn.start({ text: 'tiếp', turnId: 't9' })
    expect(JSON.stringify(result) + JSON.stringify(seen.contexts)).not.toContain('router-fail')
  })
})

describe('0.8.0 A9: retry-exhausted theo danh tính lệnh (W4)', () => {
  function setup(on: On) {
    const passing = new Set<string>()
    const seen = base(on, { router: () => GOAL })
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, (_$, e) => (passing.has(String((e as { command?: unknown }).command ?? '')) ? { result: JS.bun_pass } : { result: JS.bun_fail, isError: true as const }))
    on('turn.complete', () => ({ text: '' }))
    on('classic.Stop', () => ({}))
    return { seen, fs: disk(on) }
  }
  const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never)
  const stop = async ($: Engine, active = false, last?: string) =>
    String(((await $.classic.Stop({ stop_hook_active: active, ...(last !== undefined ? { last_assistant_message: last } : {}) } as never)) as { block?: string }).block ?? '')

  /** Một mục tiêu: sửa file, `npm test` lỗi, rồi chạy lại xen Stop cho tới khi hết lượt (A2: từ lượt 2 phải chạy lại lệnh trước Stop). */
  async function exhaust($: Engine, seen: Seen, goal: string, turn: string) {
    await submit($, goal)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa hàm tính phí' }, { title: 'Ghi tài liệu' }] })
    await $.turn.start({ text: goal, turnId: turn })
    await step($, seen, { turnId: turn })
    await $.tool.call({ tool: 'Edit', file_path: 'src/phi.ts', old_string: 'a', new_string: 'b' } as never)
    await bash($, 'npm test')
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done', note: 'đã đổi công thức phí' })
    await stop($)
    await bash($, 'npm test')
    await stop($, true)
    await bash($, 'npm test')
    await stop($, true)
    return stop($, true, 'Đã sửa xong.')
  }

  test('hai lần hết lượt cùng lệnh: một mục retry-exhausted, count 2', { options: { planApproval: 'off' } }, async ($, on) => {
    const { seen, fs } = setup(on)
    await exhaust($, seen, 'Sửa hàm tính phí', 't1')
    await conductor($, 'errors')
    expect(fs.behavior().filter(e => e.where === 'retry-exhausted').map(e => e.count)).toEqual([1])
    await exhaust($, seen, 'Thêm báo cáo doanh thu quý', 't2')
    await conductor($, 'errors')
    const rows = fs.behavior().filter(e => e.where === 'retry-exhausted')
    expect(rows.length).toBe(1)
    expect(rows[0]!.count).toBe(2)
    expect(rows[0]!.message).toContain('npm test')
  })
})
