// 0.7.5 B4: turn chạy tiếp từ điểm dừng mà không kết thúc bằng câu trả lời: điểm dừng dựng lại từ trạng thái hiện tại (tiến
// độ của turn đó không mất), giữ id, giờ tạo và note, trạng thái open. session.end khi điểm dừng đang resuming thì kho về open.
// 0.7.5 L1 (vòng sửa 2): điểm dừng dựng lại sau turn chạy tiếp lỗi xóa lệnh bị từ chối (denied) của lần dừng cũ: turn chạy tiếp
// đã nhận lệnh đó trong khối ĐIỂM DỪNG và xử lý nó, không mang sang lần tiếp tục kế.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import type { QuotaCheckpoint } from '../../types'
import { storeKey } from '../../hooks/lib/checkpoint'
import { COMPLEX_PROMPT, base, submit } from '../support/engine'
import { RESUME, memoryStore, quotaMeter, session } from '../support/quota'

const PLAN = 'mcp__focus-conductor__plan'

function startHooks(on: On) {
  on('tool.register', () => ({ value: { tool: PLAN } }))
  on('command.register', () => ({ value: { command: 'conductor' } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
}

/** Dừng vì hạn mức, ghi note, rồi hạn mức làm mới và prompt tiếp tục bắt đầu turn r1 (điểm dừng resuming). */
async function pauseAndResume($: Engine, meter: ReturnType<typeof quotaMeter>, clock: { advance: (ms: number) => Promise<void> }) {
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }, { title: 'Kiểm' }] })
  await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'doing' })
  await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' } as never)
  meter.set([session(97)])
  await clock.advance(10_000)
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  await $.tool.call({ tool: PLAN, action: 'checkpoint', note: 'Tiếp: chạy npm test; Sửa a.ts đã xong.' })
  meter.set([session(10)])
  await clock.advance(10_000)
  await submit($, 'tiếp tục')
  await $.turn.start({ text: 'tiếp tục', turnId: 'r1' })
}

describe('0.7.5 B4: turn chạy tiếp không xong', () => {
  for (const reason of ['aborted', 'error', 'refusal']) {
    test(`reason ${reason}: điểm dừng dựng lại từ tiến độ của turn, giữ id, giờ tạo, note; xóa lệnh bị từ chối cũ`, {}, async ($, on) => {
      const seen = base(on, RESUME)
      startHooks(on)
      const box = memoryStore(on)
      const meter = quotaMeter(on, [session(10)])
      on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
      on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: 900, isLink: false } }) as never)
      await submit($, COMPLEX_PROMPT)
      await pauseAndResume($, meter, seen.clock)
      const before = box.data.get(storeKey('/repo')) as QuotaCheckpoint
      await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
      await $.tool.call({ tool: 'Edit', file_path: 'src/b.ts', old_string: 'a', new_string: 'b' } as never)
      await $.turn.complete({ turnId: 'r1', answer: '', durationMs: 5, isAborted: reason === 'aborted', reason } as never)
      const after = box.data.get(storeKey('/repo')) as QuotaCheckpoint
      expect(after.status).toBe('open')
      expect(after.plan.find(step => step.id === 1)?.status).toBe('done')
      expect(after.recent.some(line => line.includes('src/b.ts'))).toBe(true)
      expect(after.id).toBe(before.id)
      expect(after.createdAt).toBe(before.createdAt)
      expect(after.note).toBe(before.note)
      expect(before.denied).not.toBeNull()
      expect(after.denied).toBeNull()
    })
  }
})

describe('0.7.5 L1: lệnh bị từ chối của lần dừng sau không lấy lại lệnh cũ', () => {
  test('dựng lại hai lần liên tiếp (hai turn chạy tiếp lỗi): lần hai vẫn không có lệnh bị từ chối', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    const box = memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: 900, isLink: false } }) as never)
    await submit($, COMPLEX_PROMPT)
    await pauseAndResume($, meter, seen.clock)
    await $.turn.complete({ turnId: 'r1', answer: '', durationMs: 5, isAborted: true, reason: 'aborted' } as never)
    expect((box.data.get(storeKey('/repo')) as QuotaCheckpoint).denied).toBeNull()
    await submit($, 'tiếp tục lần nữa')
    await $.turn.start({ text: 'tiếp tục lần nữa', turnId: 'r2' })
    await $.turn.complete({ turnId: 'r2', answer: '', durationMs: 5, isAborted: true, reason: 'aborted' } as never)
    expect((box.data.get(storeKey('/repo')) as QuotaCheckpoint).denied).toBeNull()
  })
})

describe('0.7.5 B4: session.end khi đang resuming', () => {
  test('kho về open', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    const box = memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    await pauseAndResume($, meter, seen.clock)
    expect((box.data.get(storeKey('/repo')) as QuotaCheckpoint).status).toBe('resuming')
    await $.session.end({ reason: 'prompt_input_exit' } as never)
    expect((box.data.get(storeKey('/repo')) as QuotaCheckpoint).status).toBe('open')
  })
})
