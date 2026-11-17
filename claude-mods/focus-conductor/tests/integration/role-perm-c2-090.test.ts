// 0.9.0 C2 (tích hợp): quyền theo vai. Subagent vai search, review, design bị từ chối Edit, Write, NotebookEdit và lệnh Bash có tác động
// ghi mức definite ngoài thư mục tạm; vai audit bị từ chối sửa file ngoài thư mục tạm, được chạy lệnh kiểm. Lời từ chối không quá 200 ký
// tự, nêu vai và việc nên làm (báo lại cho luồng chính). Vai do mod suy (0.9.0 B): Explore là search, Plan là design; review và audit theo
// tiền tố description ("Duyệt: ", "Kiểm: "). Subagent không có vai như 0.8.9.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { base, plan, spawnTool, submit, task } from '../support/engine'

const GOAL = plan({
  goal: 'Sửa luồng thanh toán',
  depth: 'substantial',
  volume: 'medium',
  kind: 'edit',
  tasks: [
    task('Tra chỗ gọi phí', 'agent', 'haiku', 'low', { role: 'search', agent: 'Explore', kind: 'investigate' }),
    task('Duyệt thay đổi', 'agent', 'opus', 'high', { role: 'review', kind: 'investigate' }),
    task('Thiết kế lại', 'agent', 'opus', 'high', { role: 'design', agent: 'Plan', kind: 'answer' }),
    task('Chạy kiểm', 'agent', 'haiku', 'low', { role: 'audit', kind: 'investigate' }),
    task('Sửa hàm phí', 'agent', 'sonnet', 'medium', { role: 'build' }),
    task('Ghi tài liệu', 'agent', 'sonnet', 'medium'),
  ],
})
type Out = { deny?: string }
const call = ($: Engine, input: Record<string, unknown>) => $.tool.call(input as never) as Promise<Out>

function setup(on: On) {
  base(on, { router: () => GOAL })
  on('tool.call', { tool: /^(?:Edit|Write|Read|Bash|Agent|NotebookEdit)$/ }, () => ({ result: 'ok' }))
  on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: `a-${String((e as { tool_use_id?: unknown }).tool_use_id)}` }) as never)
}
/** Vai review và audit theo tiền tố (0.9.0 B2); search và design theo loại agent của việc đã phân. */
const DESCRIPTIONS: Record<number, string> = { 2: 'Duyệt: thay đổi phí', 4: 'Kiểm: bun test' }
async function agent($: Engine, n: number, title: string): Promise<string> {
  await spawnTool($, `t${n}`, DESCRIPTIONS[n] ?? `Việc ${n}: ${title}`, title)
  return `a-t${n}`
}
const edit = (agentId: string) => ({ tool: 'Edit', file_path: '/repo/src/phi.ts', old_string: 'a', new_string: 'b', agentId })

describe('0.9.0 C2: quyền theo vai', () => {
  for (const [n, title, name] of [[1, 'Tra chỗ gọi phí', 'tra'], [2, 'Duyệt thay đổi', 'duyệt'], [3, 'Thiết kế lại', 'thiết kế']] as const) {
    test(`vai ${name}: Edit, Write, NotebookEdit và rm bị từ chối; Read và ghi /tmp bằng Bash qua`, { options: { planApproval: 'off' } }, async ($, on) => {
      setup(on)
      await submit($, 'Sửa luồng thanh toán')
      const id = await agent($, n, title)
      const denied = await call($, edit(id))
      expect(denied.deny ?? '').toContain(name)
      expect(denied.deny ?? '').toContain('luồng chính')
      expect((denied.deny ?? '').length).toBeLessThanOrEqual(200)
      expect((await call($, { tool: 'Write', file_path: '/tmp/x.md', content: 'x', agentId: id })).deny ?? '').toContain(name)
      expect((await call($, { tool: 'NotebookEdit', notebook_path: '/repo/a.ipynb', agentId: id })).deny ?? '').toContain(name)
      expect((await call($, { tool: 'Bash', command: 'rm -f /repo/src/phi.ts', agentId: id })).deny ?? '').toContain(name)
      expect((await call($, { tool: 'Read', file_path: '/repo/src/phi.ts', agentId: id })).deny).toBeUndefined()
      expect((await call($, { tool: 'Bash', command: 'grep -rn phi /repo/src > /tmp/ket-qua.txt', agentId: id })).deny).toBeUndefined()
    })
  }
  test('vai kiểm: Edit src bị từ chối; Write /tmp qua; bun test qua; rm src bị từ chối', { options: { planApproval: 'off' } }, async ($, on) => {
    setup(on)
    await submit($, 'Sửa luồng thanh toán')
    const id = await agent($, 4, 'Chạy kiểm')
    expect((await call($, edit(id))).deny ?? '').toContain('kiểm')
    expect((await call($, { tool: 'Write', file_path: '/tmp/bao-cao.md', content: 'x', agentId: id })).deny).toBeUndefined()
    expect((await call($, { tool: 'Bash', command: 'bun test', agentId: id })).deny).toBeUndefined()
    expect((await call($, { tool: 'Bash', command: 'rm -f /repo/src/phi.ts', agentId: id })).deny ?? '').toContain('kiểm')
  })
  test('vai làm và việc không có vai: sửa file như 0.8.9', { options: { planApproval: 'off' } }, async ($, on) => {
    setup(on)
    await submit($, 'Sửa luồng thanh toán')
    expect((await call($, edit(await agent($, 5, 'Sửa hàm phí')))).deny).toBeUndefined()
    expect((await call($, edit(await agent($, 6, 'Ghi tài liệu')))).deny).toBeUndefined()
  })
  test('lời gọi "Kiểm độc lập: " là vai duyệt: Edit bị từ chối', { options: { planApproval: 'off' } }, async ($, on) => {
    setup(on)
    await submit($, 'Sửa luồng thanh toán')
    await spawnTool($, 'k1', 'Kiểm độc lập: rà thay đổi phí', 'rà thay đổi')
    expect((await call($, edit('a-k1'))).deny ?? '').toContain('duyệt')
  })
})
