// 0.8.0 A2: W4 chỉ tăng lượt khi có lần thử mới. Lần Stop đầu sau lần lỗi gốc vẫn lên lượt 2 và nâng sức. Từ lượt 2, lượt chỉ tăng ở Stop
// khi cùng lệnh đã chạy lại và vẫn lỗi sau lần tăng trước; Stop mà chưa chạy lại thì chặn với câu đòi chạy lại đúng lệnh, không tăng lượt.
// Trần chống vòng lặp: hai lần Stop liên tiếp không chạy lại thì tính một lượt. Mức đã ở trần: câu chặn và báo cáo cuối ghi "đã ở mức cao nhất".

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { JS } from '../fixtures/runner-output'
import { base, plan, step, submit } from '../support/engine'
import type { Json, Seen } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const GOAL = plan({ goal: 'Sửa hàm tính phí', depth: 'substantial', volume: 'medium', main: { model: 'sonnet', effort: 'medium' } })
const TOP = plan({ goal: 'Sửa hàm tính phí', depth: 'hard', volume: 'medium', main: { model: 'opus', effort: 'xhigh' } })

function setup(on: On, goal: Json = GOAL) {
  const seen = base(on, { router: () => goal })
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: JS.bun_fail, isError: true as const }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  return seen
}

const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never)
const stop = async ($: Engine, active = true) => String(((await $.classic.Stop({ stop_hook_active: active } as never)) as { block?: string }).block ?? '')

async function failing($: Engine, seen: Seen) {
  await submit($, 'Sửa hàm tính phí')
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa hàm tính phí' }] })
  await $.turn.start({ text: 'Sửa hàm tính phí', turnId: 't1' })
  await step($, seen, { turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: 'src/phi.ts', old_string: 'a', new_string: 'b' } as never)
  await bash($, 'bun test')
  await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
}

describe('0.8.0 A2: lượt chỉ tăng khi có lần thử mới', () => {
  test('lỗi, Stop (lượt 2), Stop ngay không chạy lại: vẫn lượt 2, có câu đòi chạy lại', { options: { planApproval: 'off' } }, async ($, on) => {
    const seen = setup(on)
    await failing($, seen)
    expect(await stop($, false)).toContain('2/3')
    const reason = await stop($)
    expect(reason).toContain('2/3')
    expect(reason).not.toContain('3/3')
    expect(reason).toContain('chạy lại')
    expect(reason).toContain('bun test')
  })

  test('lỗi, Stop (lượt 2), chạy lại vẫn lỗi, Stop: lượt 3', { options: { planApproval: 'off' } }, async ($, on) => {
    const seen = setup(on)
    await failing($, seen)
    await stop($, false)
    await bash($, 'bun test')
    expect(await stop($)).toContain('3/3')
  })

  test('hai lần Stop liên tiếp không chạy lại: tăng một lượt', { options: { planApproval: 'off' } }, async ($, on) => {
    const seen = setup(on)
    await failing($, seen)
    await stop($, false)
    expect(await stop($)).not.toContain('3/3')
    expect(await stop($)).toContain('3/3')
  })

  test('bắt đầu ở opus/xhigh: câu chặn và báo cáo cuối có "đã ở mức cao nhất"', { options: { planApproval: 'off' } }, async ($, on) => {
    const seen = setup(on, TOP)
    await failing($, seen)
    expect(await stop($, false)).toContain('đã ở mức cao nhất')
    await bash($, 'bun test')
    await stop($)
    await bash($, 'bun test')
    const report = await stop($)
    expect(report).toContain('Chưa đạt yêu cầu')
    expect(report).toContain('đã ở mức cao nhất')
  })
})
