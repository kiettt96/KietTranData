// 0.8.6 R6: trạng thái vai điều phối của mục tiêu (Core.conduct), lối thoát /conductor solo, cờ "lời gọi Agent gần nhất bị từ chối" và
// đoạn dặn điều phối mới. Cờ miễn hiện trên dòng Điều phối của /conductor status ("đang miễn (lệnh solo)" hay "đang miễn (Agent bị từ
// chối)"). Cờ Agent chỉ bật khi lời gọi bị từ chối hay lỗi mà không có agent.spawn nào cho tool_use_id đó.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Core } from '../../types'
import * as S from '../../hooks/lib/state'
import { CONDUCTOR_CHARS, CONDUCTOR_KEEP_CHARS, conductorContext, conductorKeepText } from '../../hooks/lib/text'
import { base, plan, submit, task } from '../support/engine'
import type { Json } from '../support/engine'
import { makeBrief } from '../support/commands'

const MAIN = { model: 'sonnet', effort: 'medium', why: '' }
const A = 'Sửa luồng thanh toán'
const BIG = plan({ goal: A, depth: 'substantial', volume: 'medium', kind: 'edit', main: MAIN, tasks: [task('Sửa hàm phí', 'main', 'sonnet', 'medium'), task('Sửa hàm thuế', 'main', 'sonnet', 'medium')] })
const LIGHT = plan({ goal: 'Sửa chú thích', depth: 'light', volume: 'small', kind: 'edit', main: MAIN, tasks: [] })
const NEW_GOAL = plan({ goal: 'Viết trang giới thiệu', relation: 'new', confidence: 0.95, depth: 'substantial', volume: 'medium', kind: 'edit', main: MAIN, tasks: [] })
const FABLE = { options: { planApproval: 'off', conductor: 'fable' } }
const PRESENTATION = { isFullscreen: false, columns: 80 }
const run = ($: Engine, args: string, origin: Json = { kind: 'composer' }) => $.command.run({ command: 'conductor', args, origin, presentation: PRESENTATION } as never) as Promise<{ text?: string }>
const conductLine = async ($: Engine) => String((await run($, 'status')).text ?? '').split('\n').find(line => line.startsWith('Điều phối')) ?? ''

/** Engine giả: Agent theo `agent.how` (run: chạy không spawn, spawn-fail: sinh subagent rồi lỗi, refuse: lỗi trước khi chạy, deny: từ chối). */
function setup(on: On, $: Engine, reply: (request: string) => Json) {
  base(on, { router: request => (request.startsWith('Requirements:') ? { missing: [], extra: [], issues: [] } : reply(request)) })
  const agent = { how: 'run' as 'run' | 'spawn-fail' | 'refuse' | 'deny' }
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Agent' }, async (_x, e) => {
    if (agent.how === 'deny') return { deny: 'quyền: người dùng từ chối' }
    if (agent.how === 'refuse') return { result: 'không khởi động được agent', isError: true }
    if (agent.how === 'spawn-fail') {
      await $.agent.spawn({ prompt: e.prompt, description: e.description, tool_use_id: String(e.tool_use_id) } as never)
      return { result: 'subagent dừng vì lỗi', isError: true }
    }
    return { result: 'đã giao' }
  })
  on('agent.spawn', (_x, e) => ({ model: 'claude-sonnet-5-5', agentId: `a-${String(e.tool_use_id)}` }))
  return agent
}
const callAgent = ($: Engine, id: string, n = 1) => $.tool.call({ tool: 'Agent', tool_use_id: id, description: `Việc ${n}: làm`, prompt: 'x' } as never) as Promise<{ deny?: string }>

describe('0.8.6 R6: /conductor solo', () => {
  test('người gõ khi đang điều phối: bật cờ miễn, kết quả một dòng; solo off tắt cờ', FABLE, async ($, on) => {
    setup(on, $, () => BIG)
    await submit($, A)
    const on1 = String((await run($, 'solo')).text)
    expect(on1).not.toContain('\n')
    expect(on1).toContain('Đã miễn')
    expect(await conductLine($)).toContain('đang miễn (lệnh solo)')
    const off = String((await run($, 'solo off')).text)
    expect(off).not.toContain('\n')
    expect(await conductLine($)).not.toContain('đang miễn')
  })

  test('nguồn không phải người gõ: không đổi trạng thái, kết quả giải thích', FABLE, async ($, on) => {
    setup(on, $, () => BIG)
    await submit($, A)
    expect(String((await run($, 'solo', { kind: 'plugin', name: 'khác' })).text)).toContain('Chỉ nhận /conductor solo do người gõ')
    expect(await conductLine($)).not.toContain('đang miễn')
  })

  test('mục tiêu light: không đổi trạng thái', FABLE, async ($, on) => {
    setup(on, $, () => LIGHT)
    await submit($, 'Sửa chú thích README')
    expect(String((await run($, 'solo')).text)).toContain('không đang giữ vai điều phối')
    expect(await conductLine($)).not.toContain('đang miễn')
  })

  test('conductor tắt: không đổi trạng thái, status không có dòng Điều phối', { options: { planApproval: 'off' } }, async ($, on) => {
    setup(on, $, () => BIG)
    await submit($, A)
    expect(String((await run($, 'solo')).text)).toContain('không đang giữ vai điều phối')
    expect(await conductLine($)).toBe('')
  })
})

describe('0.8.6 R6: cờ lời gọi Agent bị từ chối', () => {
  test('Agent bị từ chối trước khi chạy: cờ bật; lời gọi Agent kế tiếp chạy được: cờ tắt', FABLE, async ($, on) => {
    const agent = setup(on, $, () => BIG)
    await submit($, A)
    agent.how = 'deny'
    await callAgent($, 'u1')
    expect(await conductLine($)).toContain('đang miễn (Agent bị từ chối)')
    agent.how = 'run'
    await callAgent($, 'u2')
    expect(await conductLine($)).not.toContain('đang miễn')
  })

  test('Agent lỗi mà không sinh subagent: cờ bật', FABLE, async ($, on) => {
    const agent = setup(on, $, () => BIG)
    await submit($, A)
    agent.how = 'refuse'
    await callAgent($, 'u1')
    expect(await conductLine($)).toContain('đang miễn (Agent bị từ chối)')
  })

  test('subagent đã spawn rồi kết quả isError: cờ không bật, Edit của luồng chính vẫn bị từ chối', FABLE, async ($, on) => {
    const agent = setup(on, $, () => BIG)
    await submit($, A)
    agent.how = 'spawn-fail'
    await callAgent($, 'u1')
    expect(await conductLine($)).not.toContain('đang miễn')
    const edit = (await $.tool.call({ tool: 'Edit', file_path: 'src/phi.ts', old_string: 'a', new_string: 'b' } as never)) as { deny?: string }
    expect(edit.deny ?? '').toContain('vai điều phối không tự sửa file')
  })

  test('Agent bị chính mod từ chối (cổng duyệt đang planning): cờ không bật', { options: { planApproval: 'auto', conductor: 'fable' } }, async ($, on) => {
    setup(on, $, () => BIG)
    await submit($, A)
    expect(String((await callAgent($, 'u1')).deny ?? '')).not.toBe('')
    expect(await conductLine($)).not.toContain('đang miễn')
  })
})

describe('0.8.6 vòng 2 V1: cờ Agent chỉ đổi theo lời gọi của luồng chính đang điều phối', () => {
  const LOG = '/tmp/fc-conduct-r6-v1.jsonl'
  const ID = 'fable'
  const FOLLOW = plan({ goal: '', relation: 'continue', depth: 'substantial', volume: 'medium', kind: 'edit', main: MAIN })
  /** Ghi nhật ký quyết định; trả các dòng conduct-exempt. */
  function exempts(on: On) {
    const writes: string[] = []
    on('fs.write', (_x, e) => {
      if (e.path === LOG) writes.push(e.text)
      return { value: undefined }
    })
    return () => (writes.at(-1) ?? '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>).filter(l => l['kind'] === 'conduct-exempt')
  }
  const editMain = ($: Engine) => $.tool.call({ tool: 'Edit', file_path: 'src/phi.ts', old_string: 'a', new_string: 'b' } as never) as Promise<{ deny?: string }>

  test('Agent lồng do subagent gọi bị từ chối: cờ không bật, Edit của luồng chính vẫn bị từ chối', { options: { planApproval: 'off', conductor: 'fable', decisionLog: LOG } }, async ($, on) => {
    const agent = setup(on, $, () => BIG)
    const lines = exempts(on)
    await submit($, A)
    agent.how = 'deny'
    await $.tool.call({ tool: 'Agent', tool_use_id: 'n1', agentId: 'a-x', description: 'Việc phụ', prompt: 'x' } as never)
    expect(await conductLine($)).not.toContain('đang miễn')
    expect(lines()).toEqual([])
    expect((await editMain($)).deny ?? '').toContain('vai điều phối không tự sửa file')
  })

  test('Fable tạm ngừng (không điều phối) khi Agent bị từ chối: cờ không bật; Fable điều phối lại thì Edit của luồng chính bị từ chối', { options: { planApproval: 'off', conductor: 'fable', decisionLog: LOG } }, async ($, on) => {
    let fable = 0
    const seen = base(on, { router: request => (request.startsWith('Requirements:') ? { missing: [], extra: [], issues: [] } : seen.routerModels.at(-1) === ID ? (fable++ === 0 ? BIG : fable <= 3 ? null : FOLLOW) : FOLLOW) })
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Agent' }, () => ({ deny: 'quyền: người dùng từ chối' }))
    const lines = exempts(on)
    await submit($, A)
    await submit($, 'làm tiếp bước 1')
    await submit($, 'làm tiếp bước 2')
    expect(await conductLine($)).toContain('Fable tạm ngừng')
    await callAgent($, 'u1')
    expect(lines()).toEqual([])
    for (let i = 3; i <= 6; i++) await submit($, `làm tiếp bước ${i}`)
    expect(await conductLine($)).toContain('đang điều phối')
    expect(await conductLine($)).not.toContain('đang miễn')
    expect((await editMain($)).deny ?? '').toContain('vai điều phối không tự sửa file')
  })
})

describe('0.8.6 R6: trạng thái theo mục tiêu', () => {
  test('đổi mục tiêu: trạng thái vai điều phối về mặc định', FABLE, async ($, on) => {
    let n = 0
    setup(on, $, () => (n++ === 0 ? BIG : NEW_GOAL))
    await submit($, A)
    await run($, 'solo')
    expect(await conductLine($)).toContain('đang miễn (lệnh solo)')
    await submit($, 'Viết trang giới thiệu cho sản phẩm mới')
    expect(await conductLine($)).not.toContain('đang miễn')
  })

  test('mục tiêu bị cất rồi khôi phục: trạng thái giữ', () => {
    const a = makeBrief({ goalId: 1, goal: A, depth: 'substantial', kind: 'edit' })
    const open = [{ id: 1, title: 'Sửa hàm phí', status: 'todo' as const }]
    const withA: Core = { ...S.EMPTY_CORE, brief: a, plan: open }
    const marked = S.withConduct(1, () => ({ solo: true, deniedWrites: 2, reads: 7 }))(withA)
    const replaced = S.adoptGoal(makeBrief({ goalId: 2, goal: 'Sửa chú thích', depth: 'light', kind: 'edit' }))(marked)
    expect(S.conductOf(replaced).solo).toBe(false)
    const outcome = S.restoreArchived(replaced, 1)
    if ('error' in outcome) throw new Error(outcome.error)
    const back = S.conductOf(outcome.core)
    expect(back.goalId).toBe(outcome.core.brief?.goalId ?? -1)
    expect([back.solo, back.deniedWrites, back.reads]).toEqual([true, 2, 7])
  })

  test('nạp trạng thái 0.8.5 không có trường conduct: trạng thái là mặc định', () => {
    const { conduct: _drop, ...old } = S.EMPTY_CORE as Core & { conduct?: unknown }
    const brief = makeBrief({ goalId: 3, goal: A, depth: 'substantial', kind: 'edit' })
    const n = S.normalizeCore({ ...old, brief } as Partial<Core>)
    expect(n.conduct).toEqual(S.emptyConduct(-1))
    expect(S.conductOf(n)).toEqual(S.emptyConduct(3))
  })

  test('withConduct cho mục tiêu khác mục tiêu đang mở: không đổi gì', () => {
    const brief = makeBrief({ goalId: 4, goal: A, depth: 'substantial', kind: 'edit' })
    const core: Core = { ...S.EMPTY_CORE, brief }
    expect(S.conductOf(S.withConduct(3, () => ({ solo: true }))(core)).solo).toBe(false)
  })
})

describe('0.8.6 R6: đoạn dặn điều phối', () => {
  test('conductorContext không còn "Chỉ tự sửa file", nói không tự sửa file và không tự chạy lệnh kiểm, trong trần 480', () => {
    const text = conductorContext()
    expect(text).not.toContain('Chỉ tự sửa file')
    expect(text).toContain('Không tự sửa file')
    expect(text).toContain('không tự chạy lệnh kiểm')
    expect(text).toContain('lệnh kiểm giao một subagent chạy')
    expect(text.length).toBeLessThanOrEqual(CONDUCTOR_CHARS)
  })

  test('conductorKeepText nói không tự sửa file, không tự chạy kiểm, trong trần 200', () => {
    const text = conductorKeepText()
    expect(text).toContain('không tự sửa file')
    expect(text).toContain('không tự chạy kiểm')
    expect(text.length).toBeLessThanOrEqual(CONDUCTOR_KEEP_CHARS)
  })
})
