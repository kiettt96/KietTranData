// 0.7.3 điểm 3: turn của luồng chính chết vì lỗi (turn.complete reason "error") để lại một bản ghi riêng `Core.turnFault`, nhãn trên
// status line ("turn lỗi · gõ tiếp để chạy lại"), một toast, một dòng nhật ký loại net. Tách hẳn khỏi bảo vệ hạn mức: không tạo hay
// sửa điểm dừng, không chặn tool call nào. Nhãn mất khi turn kế tiếp của luồng chính kết thúc bằng câu trả lời.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import type { Core, QuotaCheckpoint } from '../../types'
import { storeKey } from '../../hooks/lib/checkpoint'
import { EMPTY_QUOTA, quotaSettings } from '../../hooks/lib/quota'
import { EMPTY_CORE, statusText } from '../../hooks/lib/state'
import { turnFaultLabel, withTurnFaultStatus } from '../../hooks/lib/text'
import { COMPLEX_PROMPT, base, conductor, submit } from '../support/engine'
import { RESUME, memoryStore, quotaMeter, session } from '../support/quota'

const PLAN = 'mcp__focus-conductor__plan'
const LABEL = 'turn lỗi · gõ tiếp để chạy lại'
const DONE = (turnId: string, reason = 'answer', agentId?: string) => ({ turnId, answer: 'ok', durationMs: 5, isAborted: reason === 'aborted', reason, ...(agentId ? { agentId } : {}) }) as never
const lastStatus = (statuses: Array<string | undefined>) => statuses[statuses.length - 1] ?? ''

function startHooks(on: On) {
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('turn.complete', () => ({ text: '' }))
}

describe('0.7.3 điểm 3: nhãn status', () => {
  test('nhãn vi và en; không có bản ghi thì status giữ nguyên', () => {
    expect(turnFaultLabel('vi')).toBe(LABEL)
    expect(turnFaultLabel('en')).toBe('turn failed · type to retry')
    expect(withTurnFaultStatus('auto', null, 'vi')).toBe('auto')
    expect(withTurnFaultStatus(undefined, { goalId: 1, goal: 'x', openSteps: [], at: 1 }, 'vi')).toBeUndefined()
    expect(withTurnFaultStatus('auto', { goalId: 1, goal: 'x', openSteps: [], at: 1 }, 'vi')).toBe(`auto · ${LABEL}`)
  })

  test('thứ tự nhãn: hạn mức, lỗi router, turn lỗi', () => {
    const core: Core = {
      ...EMPTY_CORE,
      routerFail: { at: 1, kind: 'timeout', reason: 'hết giờ', ms: 45_000, timeoutMs: 45_000, maxTokens: 8000, outputTokens: null },
      turnFault: { goalId: 1, goal: 'x', openSteps: [], at: 2 },
    }
    const quota = { ...EMPTY_QUOTA, readings: [{ kind: 'five_hour', percentUsed: 97 }] }
    const text = statusText({ core, mode: 'auto', isBandHidden: false, lang: 'vi' }, quota, 1000, quotaSettings({}))
    expect(text).toBeDefined()
    const at = (needle: string) => (text ?? '').indexOf(needle)
    expect(at('hạn mức')).toBeGreaterThan(-1)
    expect(at('router lỗi')).toBeGreaterThan(at('hạn mức'))
    expect(at(LABEL)).toBeGreaterThan(at('router lỗi'))
  })

  test('hạn mức tắt: vẫn ghép lỗi router rồi turn lỗi', () => {
    const core: Core = {
      ...EMPTY_CORE,
      routerFail: { at: 1, kind: 'timeout', reason: 'hết giờ', ms: 45_000, timeoutMs: 45_000, maxTokens: 8000, outputTokens: null },
      turnFault: { goalId: 1, goal: 'x', openSteps: [], at: 2 },
    }
    const text = statusText({ core, mode: 'auto', isBandHidden: false, lang: 'vi' }, EMPTY_QUOTA, 1000, { ...quotaSettings({}), enabled: false }) ?? ''
    expect(text.indexOf(LABEL)).toBeGreaterThan(text.indexOf('router lỗi'))
  })
})

describe('0.7.3 điểm 3: turn lỗi của luồng chính', () => {
  test('reason error: status ghi nhãn, một toast', {}, async ($, on) => {
    const seen = base(on)
    startHooks(on)
    await submit($, COMPLEX_PROMPT)
    await $.turn.start({ text: 'x', turnId: 't1' })
    await $.turn.complete(DONE('t1', 'error'))
    expect(lastStatus(seen.statuses)).toContain(LABEL)
    expect(seen.toasts.filter(t => t.includes('turn lỗi')).length).toBe(1)
  })

  test('lỗi liên tiếp khi bản ghi còn đó: không toast lần hai', {}, async ($, on) => {
    const seen = base(on)
    startHooks(on)
    await submit($, COMPLEX_PROMPT)
    await $.turn.start({ text: 'x', turnId: 't1' })
    await $.turn.complete(DONE('t1', 'error'))
    await $.turn.start({ text: 'x', turnId: 't2' })
    await $.turn.complete(DONE('t2', 'error'))
    expect(seen.toasts.filter(t => t.includes('turn lỗi')).length).toBe(1)
  })

  test('turn lỗi không làm tool call sau đó bị từ chối', {}, async ($, on) => {
    base(on)
    startHooks(on)
    await submit($, COMPLEX_PROMPT)
    await $.turn.start({ text: 'x', turnId: 't1' })
    await $.turn.complete(DONE('t1', 'error'))
    const out = await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' } as never)
    expect(out.deny).toBeUndefined()
  })

  test('turn trả lời bình thường kế tiếp xóa nhãn', {}, async ($, on) => {
    const seen = base(on)
    startHooks(on)
    await submit($, COMPLEX_PROMPT)
    await $.turn.start({ text: 'x', turnId: 't1' })
    await $.turn.complete(DONE('t1', 'error'))
    expect(lastStatus(seen.statuses)).toContain(LABEL)
    await $.turn.start({ text: 'y', turnId: 't2' })
    await $.turn.complete(DONE('t2', 'answer'))
    expect(lastStatus(seen.statuses)).not.toContain(LABEL)
  })

  test('sau khi nhãn đã xóa, lỗi mới báo toast lại', {}, async ($, on) => {
    const seen = base(on)
    startHooks(on)
    await submit($, COMPLEX_PROMPT)
    await $.turn.start({ text: 'x', turnId: 't1' })
    await $.turn.complete(DONE('t1', 'error'))
    await $.turn.start({ text: 'y', turnId: 't2' })
    await $.turn.complete(DONE('t2', 'answer'))
    await $.turn.start({ text: 'z', turnId: 't3' })
    await $.turn.complete(DONE('t3', 'error'))
    expect(seen.toasts.filter(t => t.includes('turn lỗi')).length).toBe(2)
  })

  for (const reason of ['aborted', 'refusal']) {
    test(`reason ${reason}: không tạo nhãn`, {}, async ($, on) => {
      const seen = base(on)
      startHooks(on)
      await submit($, COMPLEX_PROMPT)
      await $.turn.start({ text: 'x', turnId: 't1' })
      await $.turn.complete(DONE('t1', reason))
      expect(lastStatus(seen.statuses)).not.toContain(LABEL)
      expect(seen.toasts.some(t => t.includes('turn lỗi'))).toBe(false)
    })
  }

  test('aborted hay refusal không xóa nhãn đang có', {}, async ($, on) => {
    const seen = base(on)
    startHooks(on)
    await submit($, COMPLEX_PROMPT)
    await $.turn.start({ text: 'x', turnId: 't1' })
    await $.turn.complete(DONE('t1', 'error'))
    await $.turn.start({ text: 'y', turnId: 't2' })
    await $.turn.complete(DONE('t2', 'aborted'))
    expect(lastStatus(seen.statuses)).toContain(LABEL)
  })

  test('turn lỗi của subagent không tạo nhãn', {}, async ($, on) => {
    const seen = base(on)
    startHooks(on)
    await submit($, COMPLEX_PROMPT)
    await $.turn.complete(DONE('ag-1', 'error', 'agent-1'))
    expect(lastStatus(seen.statuses)).not.toContain(LABEL)
    expect(seen.toasts.some(t => t.includes('turn lỗi'))).toBe(false)
  })

  test('turn của subagent kết thúc bằng câu trả lời không xóa nhãn của luồng chính', {}, async ($, on) => {
    const seen = base(on)
    startHooks(on)
    await submit($, COMPLEX_PROMPT)
    await $.turn.start({ text: 'x', turnId: 't1' })
    await $.turn.complete(DONE('t1', 'error'))
    await $.turn.complete(DONE('ag-2', 'answer', 'agent-2'))
    expect(lastStatus(seen.statuses)).toContain(LABEL)
  })

  test('mục tiêu mới (/conductor goal) và /conductor reset xóa nhãn', {}, async ($, on) => {
    const seen = base(on)
    startHooks(on)
    await submit($, COMPLEX_PROMPT)
    await $.turn.start({ text: 'x', turnId: 't1' })
    await $.turn.complete(DONE('t1', 'error'))
    await conductor($, 'goal Làm việc khác hẳn')
    expect(lastStatus(seen.statuses)).not.toContain(LABEL)
    await $.turn.start({ text: 'x', turnId: 't2' })
    await $.turn.complete(DONE('t2', 'error'))
    expect(lastStatus(seen.statuses)).toContain(LABEL)
    await conductor($, 'reset')
    expect(lastStatus(seen.statuses)).not.toContain(LABEL)
  })

  test('mode off: không nhãn, không toast', {}, async ($, on) => {
    const seen = base(on)
    startHooks(on)
    await conductor($, 'mode off')
    await submit($, COMPLEX_PROMPT)
    await $.turn.start({ text: 'x', turnId: 't1' })
    await $.turn.complete(DONE('t1', 'error'))
    expect(seen.toasts.some(t => t.includes('turn lỗi'))).toBe(false)
    expect(lastStatus(seen.statuses)).not.toContain(LABEL)
  })

  test('nhật ký quyết định có dòng net kèm mục tiêu và số bước còn mở', { options: { decisionLog: '/tmp/fc-turn-fault.jsonl' } }, async ($, on) => {
    const writes: string[] = []
    on('fs.write', (_$, e) => {
      writes.push(e.text)
      return { value: undefined }
    })
    base(on)
    startHooks(on)
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Một' }, { title: 'Hai' }] })
    await $.turn.start({ text: 'x', turnId: 't1' })
    await $.turn.complete(DONE('t1', 'error'))
    const lines = writes.join('').trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    expect(lines.find(line => line['kind'] === 'net')).toMatchObject({ kind: 'net', reason: 'turn-error', openSteps: 2 })
  })
})

describe('0.7.3 điểm 3: tách khỏi bảo vệ hạn mức', () => {
  const EDIT = { tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' } as const

  /** Dừng vì hạn mức rồi tiếp tục bằng một turn; trả bảng số đo, kho điểm dừng và đồng hồ. */
  async function resumedTurn($: Engine, on: On) {
    const seen = base(on, RESUME)
    on('tool.register', () => ({ value: { tool: PLAN } }))
    on('command.register', () => ({ value: { command: 'conductor' } }))
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    startHooks(on)
    const box = memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }, { title: 'Kiểm' }] })
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'doing' })
    await $.tool.call(EDIT)
    meter.set([session(97)])
    await seen.clock.advance(10_000)
    await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
    await $.tool.call({ tool: PLAN, action: 'checkpoint', note: 'Tiếp: chạy npm test.' })
    meter.set([session(1)])
    await seen.clock.advance(10_000)
    await submit($, 'tiếp tục')
    await $.turn.start({ text: 'tiếp tục', turnId: 'r1' })
    return { seen, box }
  }

  test('turn tiếp tục chết vì lỗi: điểm dừng hạn mức về open như cũ và nhãn turn lỗi cùng có', {}, async ($, on) => {
    const { seen, box } = await resumedTurn($, on)
    await $.turn.complete(DONE('r1', 'error'))
    expect((box.data.get(storeKey('/repo')) as QuotaCheckpoint).status).toBe('open')
    expect(lastStatus(seen.statuses)).toContain(LABEL)
  })

  test('điểm dừng hạn mức có sẵn không bị bản ghi turn lỗi đè: nội dung điểm dừng không đổi sau turn lỗi', {}, async ($, on) => {
    const { box } = await resumedTurn($, on)
    const before = JSON.stringify({ ...(box.data.get(storeKey('/repo')) as QuotaCheckpoint), status: 'x' })
    await $.turn.complete(DONE('r1', 'error'))
    const after = JSON.stringify({ ...(box.data.get(storeKey('/repo')) as QuotaCheckpoint), status: 'x' })
    expect(after).toBe(before)
  })

  test('đang dừng vì hạn mức mà turn lỗi: nhãn hạn mức vẫn hiện, đứng trước nhãn turn lỗi', {}, async ($, on) => {
    const seen = base(on, RESUME)
    on('tool.register', () => ({ value: { tool: PLAN } }))
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    startHooks(on)
    memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] })
    await $.tool.call(EDIT)
    meter.set([session(97)])
    await seen.clock.advance(10_000)
    await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
    await $.turn.start({ text: 'x', turnId: 't1' })
    await $.turn.complete(DONE('t1', 'error'))
    const text = lastStatus(seen.statuses)
    expect(text).toContain('tạm dừng')
    expect(text.indexOf(LABEL)).toBeGreaterThan(text.indexOf('tạm dừng'))
  })
})
