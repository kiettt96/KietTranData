// 0.9.0 C5 (tích hợp): hai subagent đang chạy chung thư mục cùng ghi một file thì luồng chính được nhắc một lần cho mỗi file (ở kết quả tool
// kế tiếp của luồng chính), nhật ký ghi file-clash; subagent có isolation không tính.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { base, plan, submit } from '../support/engine'

const LOG = '/tmp/fc-file-clash-c5-090.jsonl'
type Out = { context?: string[] }
function setup(on: On) {
  base(on, { router: () => plan({ goal: 'Sửa phí', depth: 'substantial', volume: 'medium', kind: 'edit' }) })
  on('tool.call', { tool: /^(?:Edit|Read|Agent)$/ }, () => ({ result: 'ok' }))
  on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: `a-${String((e as { tool_use_id?: unknown }).tool_use_id)}` }) as never)
  const writes: string[] = []
  on('fs.write', (_$, e) => {
    writes.push(e.text)
    return { value: undefined }
  })
  return () => (writes.at(-1) ?? '').trim().split('\n').filter(Boolean).map(l => JSON.parse(l) as Record<string, unknown>)
}
async function spawn($: Engine, id: string, isolation?: string) {
  await $.tool.call({ tool: 'Agent', tool_use_id: id, description: `Sửa phần ${id}`, prompt: 'Sửa.', ...(isolation !== undefined ? { isolation } : {}) } as never)
  await $.agent.spawn({ prompt: 'Sửa.', description: `Sửa phần ${id}`, tool_use_id: id } as never)
}
const edit = ($: Engine, agentId: string, path = '/repo/src/phi.ts') => $.tool.call({ tool: 'Edit', file_path: path, old_string: 'a', new_string: 'b', agentId } as never)
const mainRead = async ($: Engine) => ((await $.tool.call({ tool: 'Read', file_path: '/repo/README.md' } as never)) as Out).context ?? []

describe('0.9.0 C5: một tệp một agent', () => {
  test('hai subagent chung thư mục cùng sửa src/phi.ts: luồng chính được nhắc một lần, nhật ký có file-clash', { options: { planApproval: 'off', decisionLog: LOG } }, async ($, on) => {
    const lines = setup(on)
    await submit($, 'Sửa phí')
    await spawn($, 'p1')
    await spawn($, 'p2')
    await edit($, 'a-p1')
    await edit($, 'a-p2')
    const first = (await mainRead($)).join('\n')
    expect(first).toContain('/repo/src/phi.ts')
    expect(first).toContain('cùng sửa')
    await edit($, 'a-p1')
    expect((await mainRead($)).join('\n')).not.toContain('cùng sửa')
    expect(lines().filter(l => l['kind'] === 'file-clash').length).toBe(1)
  })
  test('một subagent có isolation: không nhắc', { options: { planApproval: 'off' } }, async ($, on) => {
    setup(on)
    await submit($, 'Sửa phí')
    await spawn($, 'p1')
    await spawn($, 'p2', 'worktree')
    await edit($, 'a-p1')
    await edit($, 'a-p2')
    expect((await mainRead($)).join('\n')).not.toContain('cùng sửa')
  })
  test('subagent đầu đã trả về trước khi subagent sau sửa cùng tệp: không nhắc', { options: { planApproval: 'off' } }, async ($, on) => {
    setup(on)
    on('turn.complete', () => ({ text: '' }))
    await submit($, 'Sửa phí')
    await spawn($, 'p1')
    await spawn($, 'p2')
    await edit($, 'a-p1')
    await $.turn.complete({ turnId: 'x1', agentId: 'a-p1', answer: 'xong', durationMs: 5, isAborted: false, reason: 'answer' } as never)
    await edit($, 'a-p2')
    expect((await mainRead($)).join('\n')).not.toContain('cùng sửa')
  })
  test('hai subagent sửa hai tệp khác nhau: không nhắc', { options: { planApproval: 'off' } }, async ($, on) => {
    setup(on)
    await submit($, 'Sửa phí')
    await spawn($, 'p1')
    await spawn($, 'p2')
    await edit($, 'a-p1', '/repo/src/a.ts')
    await edit($, 'a-p2', '/repo/src/b.ts')
    expect((await mainRead($)).join('\n')).not.toContain('cùng sửa')
  })
})
