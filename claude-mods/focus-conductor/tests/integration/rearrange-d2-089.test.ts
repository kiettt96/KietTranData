// 0.8.9 D2 (tích hợp): router trả arrange cho prompt tiếp nối, mod áp lên brief. Việc bị bỏ hay bị gộp rời brief, rời danh sách việc chờ
// giao và danh sách việc lỗi, nên không còn là lý do để cổng kết thúc chặn; việc đang chạy hay đã xong thì giữ, mục nhắm vào nó được ghi ở
// dòng rearrange của nhật ký quyết định. Áp cho prompt thường, tin chen ngang và lệnh đọc lại prompt (/conductor reroute).

import { describe, expect, test } from 'claude-code/testing'
import type { On, TurnCompleteInput } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { DEFAULT_ROUTER, FOUR, SEARCH, base, conductor, plan, spawnTool, step, submit, task } from '../support/engine'
import type { Json } from '../support/engine'

const LOG = '/tmp/fc-rearrange-d2-089.jsonl'
const OPTS = { options: { planApproval: 'off', decisionLog: LOG } }
type Line = Record<string, unknown>

function logOf(on: On): () => Line[] {
  const writes: string[] = []
  on('fs.write', (_$, e) => {
    writes.push(e.text)
    return { value: undefined }
  })
  return () => (writes.at(-1) ?? '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Line)
}

function hooks(on: On) {
  on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: `a-${e.tool_use_id}` }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('classic.Stop', () => ({}))
}

const ended = (agentId: string, reason: 'answer' | 'error'): TurnCompleteInput => ({ turnId: `t-${agentId}`, agentId, answer: '', durationMs: 1, isAborted: false, reason }) as TurnCompleteInput
const status = async ($: Engine) => String((await conductor($, 'status')).text)
const stopBlock = async ($: Engine) => String(((await $.classic.Stop({ stop_hook_active: false } as never)) as { block?: string }).block ?? '')
const refine = (arrange: Json, over: Json = {}) => plan({ relation: 'refine', intent: 'amend', goal: '', arrange, ...over })
const lastOf = (lines: Line[], kind: string) => lines.filter(line => line['kind'] === kind).at(-1)
const taskIndexes = (line: Line | undefined) => ((line?.['tasks'] as Array<{ index: number }> | undefined) ?? []).map(t => t.index)

describe('0.8.9 D2: việc bị bỏ rời brief và các danh sách theo dõi', () => {
  test('bỏ việc 2 đang chờ giao: rời brief, rời danh sách chờ giao; cổng kết thúc không nêu việc 2', OPTS, async ($, on) => {
    const lines = logOf(on)
    base(on, { router: request => (request.includes('điều chỉnh') ? refine({ order: [], drop: [{ task: 2, why: 'không đổi tên nữa' }], merge: [] }) : DEFAULT_ROUTER(request)) })
    hooks(on)
    await submit($, FOUR)
    await submit($, 'điều chỉnh: thôi không đổi tên')
    expect(lastOf(lines(), 'rearrange')?.['dropped']).toEqual([2])
    expect(taskIndexes(lastOf(lines(), 'route'))).toEqual([1, 3, 4])
    const text = await status($)
    expect(text).not.toContain('Đổi tên userId')
    expect(await stopBlock($)).not.toContain('Việc 2')
  })

  test('bỏ việc đang chạy và việc đã xong: cả hai còn; dòng rearrange ghi hai mục bị bỏ qua', OPTS, async ($, on) => {
    const lines = logOf(on)
    base(on, { router: request => (request.includes('điều chỉnh') ? refine({ order: [], drop: [{ task: 1, why: 'a' }, { task: 4, why: 'b' }], merge: [] }) : DEFAULT_ROUTER(request)) })
    hooks(on)
    await submit($, FOUR)
    await spawnTool($, 'u1', 'Việc 1: tìm chỗ gọi charge', SEARCH)
    await spawnTool($, 'u4', 'Việc 4: cập nhật README', 'Cập nhật README phần cài đặt.')
    await $.turn.complete(ended('a-u4', 'answer'))
    await submit($, 'điều chỉnh: bỏ việc 1 và 4')
    const rearrange = lastOf(lines(), 'rearrange')
    expect((rearrange?.['skipped'] as Array<{ task: number }>).map(s => s.task)).toEqual([1, 4])
    expect(taskIndexes(lastOf(lines(), 'route'))).toEqual([1, 2, 3, 4])
  })

  test('bỏ việc đã lỗi mà chưa giao lại: rời brief và rời danh sách việc lỗi; cổng kết thúc không chặn vì việc đó', OPTS, async ($, on) => {
    const lines = logOf(on)
    base(on, { router: request => (request.includes('điều chỉnh') ? refine({ order: [], drop: [{ task: 1, why: 'không cần tìm nữa' }], merge: [] }) : DEFAULT_ROUTER(request)) })
    hooks(on)
    await submit($, FOUR)
    await spawnTool($, 'u1', 'Việc 1: tìm chỗ gọi charge', SEARCH)
    await $.turn.complete(ended('a-u1', 'error'))
    expect(await status($)).toContain('lỗi, chưa giao lại')
    await submit($, 'điều chỉnh: thôi không tìm nữa')
    expect(lastOf(lines(), 'rearrange')?.['dropped']).toEqual([1])
    expect(await status($)).not.toContain('lỗi, chưa giao lại')
    await $.tool.call({ tool: 'Edit', file_path: 'src/x.ts', old_string: 'a', new_string: 'b' } as never)
    expect(await stopBlock($)).not.toContain('đã lỗi, chưa giao lại')
  })

  test('gộp việc 2 và 4 vào new1: hai việc rời brief, việc mới mang hợp covers; yêu cầu vẫn được phủ', OPTS, async ($, on) => {
    const lines = logOf(on)
    const first = plan({ goal: 'Nâng cấp module', depth: 'hard', volume: 'medium', kind: 'edit', requirements: ['Yêu cầu A', 'Yêu cầu B', 'Yêu cầu C'], tasks: [task('Việc A', 'main', 'sonnet', 'medium', { covers: [1] }), task('Việc B', 'main', 'sonnet', 'medium', { covers: [2] }), task('Việc C', 'main', 'sonnet', 'medium', { covers: [3] })] })
    const merged = refine({ order: [], drop: [], merge: [{ tasks: [2, 3], into: 'new1' }] }, { tasks: [task('Việc B và C làm chung', 'main', 'sonnet', 'medium')] })
    const seen = base(on, { router: request => (request.includes('điều chỉnh') ? merged : first) })
    hooks(on)
    await submit($, 'Nâng cấp module')
    await submit($, 'điều chỉnh: làm B và C chung một lần')
    expect(lastOf(lines(), 'rearrange')?.['merged']).toEqual([{ tasks: [2, 3], into: 4 }])
    expect(taskIndexes(lastOf(lines(), 'route'))).toEqual([1, 4])
    expect((seen.contexts.at(-1) ?? []).join('\n')).not.toContain('Yêu cầu chưa có việc nào phủ')
  })

  test('order thiếu ba việc còn mở: ba việc đó xếp cuối theo số', OPTS, async ($, on) => {
    const lines = logOf(on)
    base(on, { router: request => (request.includes('điều chỉnh') ? refine({ order: [4], drop: [], merge: [] }) : DEFAULT_ROUTER(request)) })
    hooks(on)
    await submit($, FOUR)
    await submit($, 'điều chỉnh: làm README trước')
    expect(lastOf(lines(), 'rearrange')?.['order']).toEqual([4, 1, 2, 3])
  })

  test('/conductor reroute có arrange: việc đã bỏ rời brief, rời danh sách chờ giao và việc lỗi; nhật ký có dòng rearrange', OPTS, async ($, on) => {
    const lines = logOf(on)
    let isReroute = false
    base(on, { router: request => (isReroute && request.includes('điều chỉnh') ? refine({ order: [], drop: [{ task: 1, why: 'bỏ' }, { task: 2, why: 'bỏ' }], merge: [] }) : request.includes('điều chỉnh') ? refine({ order: [], drop: [], merge: [] }) : DEFAULT_ROUTER(request)) })
    hooks(on)
    await submit($, FOUR)
    await spawnTool($, 'u1', 'Việc 1: tìm chỗ gọi charge', SEARCH)
    await $.turn.complete(ended('a-u1', 'error'))
    await submit($, 'điều chỉnh: xem lại')
    isReroute = true
    await conductor($, 'reroute')
    expect(lastOf(lines(), 'rearrange')?.['dropped']).toEqual([1, 2])
    const text = await status($)
    expect(text).not.toContain('lỗi, chưa giao lại')
    expect(text).not.toContain('Đổi tên userId')
  })
})

describe('0.8.9 D2: ba tin chen ngang liên tiếp khi luồng chính đang chạy', () => {
  test('mục tiêu 12 việc; thêm 2, bỏ 3, gộp 2, đảo thứ tự: sau mỗi tin, việc còn mở, thứ tự và việc đã gỡ đúng', OPTS, async ($, on) => {
    const lines = logOf(on)
    const twelve = plan({ goal: 'Nâng cấp mười hai phần', depth: 'hard', volume: 'large', kind: 'edit', tasks: Array.from({ length: 12 }, (_, i) => task(`Phần ${i + 1}`, 'main', 'sonnet', 'medium')) })
    const replies: Record<string, Json> = {
      'chen một': refine({ order: [], drop: [{ task: 3, why: 'bỏ' }, { task: 7, why: 'bỏ' }, { task: 11, why: 'bỏ' }], merge: [] }, { tasks: [task('Phần thêm A', 'main', 'sonnet', 'medium'), task('Phần thêm B', 'main', 'sonnet', 'medium')] }),
      'chen hai': refine({ order: [], drop: [], merge: [{ tasks: [5, 6], into: 13 }] }),
      'chen ba': refine({ order: [14, 12], drop: [], merge: [] }),
    }
    const seen = base(on, { router: request => Object.entries(replies).find(([key]) => request.includes(key))?.[1] ?? twelve })
    hooks(on)
    await submit($, 'Nâng cấp mười hai phần')
    await $.turn.start({ text: 'làm', turnId: 't1' })
    await step($, seen, { turnId: 't1' })
    const interject = (text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } as never, turnId: 't1' })
    await interject('chen một: thêm hai phần, bỏ phần 3, 7, 11')
    expect(taskIndexes(lastOf(lines(), 'route'))).toEqual([1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14])
    expect(lastOf(lines(), 'rearrange')?.['dropped']).toEqual([3, 7, 11])
    await interject('chen hai: gộp phần 5 và 6 vào phần thêm A')
    expect(taskIndexes(lastOf(lines(), 'route'))).toEqual([1, 2, 4, 8, 9, 10, 12, 13, 14])
    expect(lastOf(lines(), 'rearrange')?.['merged']).toEqual([{ tasks: [5, 6], into: 13 }])
    await interject('chen ba: làm phần thêm B trước, rồi phần 12')
    expect(lastOf(lines(), 'rearrange')?.['order']).toEqual([14, 12, 1, 2, 4, 8, 9, 10, 13])
  })
})
