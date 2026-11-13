// 0.8.7 L2: không còn trần số việc, số yêu cầu, số bước checklist. Tool plan giữ đủ bước (bước không tiêu đề vẫn bị bỏ và báo); mục tiêu
// giữ đủ việc router chia, không còn cảnh báo "giữ N việc đầu"; lời giao "Việc 37" khớp đúng việc 37; bước 37 được nâng verified như bước 3.
// Band và pane với 100 việc, 100 bước không vượt maxRows và có dòng ghi số mục còn lại khi không hiện hết.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { JS } from '../fixtures/runner-output'
import { PANE, base, plan, step, submit, task } from '../support/engine'
import type { Json, Seen } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const ID = 'claude-fable-5-2'
const GOAL = 'Mục tiêu giả nhiều việc'
const PRESENTATION = { isFullscreen: false, columns: 80 }
const reqs = (n: number) => Array.from({ length: n }, (_, i) => `Yêu cầu giả số ${i + 1}`)
const many = (n: number, nReqs = n, run: (i: number) => 'main' | 'agent' = () => 'main') =>
  plan({ goal: GOAL, depth: 'substantial', volume: 'large', kind: 'edit', requirements: reqs(nReqs), tasks: Array.from({ length: n }, (_, i) => task(`Việc giả ${i + 1}`, run(i), run(i) === 'agent' ? 'haiku' : 'sonnet', run(i) === 'agent' ? 'low' : 'medium', { covers: [(i % nReqs) + 1] })) })
const FOLLOW = plan({ goal: '', relation: 'continue', intent: 'amend', depth: 'light', volume: 'small', kind: 'edit', requirements: ['Yêu cầu bổ sung giả'], tasks: [task('Việc bổ sung giả', 'agent', 'haiku', 'low', { covers: [1] })] })
const AGENTS = () => 'agent' as const
const MODES: Array<[string, Json]> = [['conductor tắt', { planApproval: 'off' }], ['conductor fable', { planApproval: 'off', conductor: 'fable' }]]
const status = async ($: Engine) => String(((await $.command.run({ command: 'conductor', args: 'status', origin: { kind: 'composer' }, presentation: PRESENTATION } as never)) as { text?: string }).text ?? '')
const setSteps = async ($: Engine, steps: unknown[]) => String((await $.tool.call({ tool: PLAN, action: 'set', steps } as never)).result)
const show = async ($: Engine) => String((await $.tool.call({ tool: PLAN, action: 'show' })).result)

function setup(on: On, reply: (seen: Seen, request: string) => Json | null): Seen {
  const seen: Seen = base(on, { router: request => (request.startsWith('Requirements:') ? { missing: [], extra: [], issues: [] } : reply(seen, request)) })
  on('turn.complete', () => ({ text: '' }))
  return seen
}

describe('0.8.7 L2: tool plan không còn trần số bước', () => {
  for (const [name, options] of MODES) {
    test(`${name}: set 45 bước giữ 45, không có "vượt giới hạn"; set 130 bước giữ 130; bước không tiêu đề vẫn bị bỏ và báo`, { options }, async ($, on) => {
      setup(on, () => plan({ goal: GOAL, depth: 'substantial', volume: 'large', kind: 'edit' }))
      await submit($, GOAL)
      const out45 = await setSteps($, Array.from({ length: 45 }, (_, i) => ({ title: `Bước giả ${i + 1}` })))
      expect(out45).not.toContain('vượt giới hạn')
      expect(await show($)).toContain('45. Bước giả 45')
      const out130 = await setSteps($, [...Array.from({ length: 130 }, (_, i) => ({ title: `Bước dài ${i + 1}` })), { title: '' }])
      expect(out130).toContain('bỏ 1 bước không có tiêu đề')
      expect(await show($)).toContain('130. Bước dài 130')
    })
  }
})

describe('0.8.7 L2: mục tiêu giữ đủ việc router chia', () => {
  for (const [name, options] of MODES) {
    test(`${name}: router chia 45 việc, 60 yêu cầu: status có việc giao 45, không có cảnh báo giữ việc đầu`, { options }, async ($, on) => {
      setup(on, () => many(45, 60, AGENTS))
      await submit($, GOAL)
      const text = await status($)
      expect(text).toContain('Việc giả 45')
      expect(text).not.toContain('việc đầu trong Phân việc')
      const pane = (await (await $.ui.mount(PANE)).findAll({ type: 'Text' })).map(e => e.text).join('\n')
      expect(pane).not.toContain('việc đầu trong Phân việc')
    })

    test(`${name}: mục tiêu 45 việc rồi tin bổ sung thêm 1 việc: status có cả việc 45 và việc bổ sung`, { options }, async ($, on) => {
      setup(on, (_seen, request) => (request.includes('thêm một việc') ? FOLLOW : many(45, 60, AGENTS)))
      await submit($, GOAL)
      await submit($, 'thêm một việc nữa cho mục tiêu này')
      const text = await status($)
      expect(text).toContain('Việc giả 45')
      expect(text).toContain('Việc bổ sung giả')
    })
  }

  test('conductor fable, router Fable lỗi hai lần rồi router thường đọc tin bổ sung: status có cả việc 45 và việc bổ sung', { options: { planApproval: 'off', conductor: 'fable' } }, async ($, on) => {
    let fable = 0
    setup(on, seen => (seen.routerModels.at(-1) === ID ? (fable++ === 0 ? many(45, 60, AGENTS) : null) : FOLLOW))
    await submit($, GOAL)
    await submit($, 'làm tiếp bước 1')
    await submit($, 'làm tiếp bước 2')
    await submit($, 'thêm một việc nữa cho mục tiêu này')
    const text = await status($)
    expect(text).toContain('Việc giả 45')
    expect(text).toContain('Việc bổ sung giả')
  })
})

describe('0.8.7 L2: việc số lớn', () => {
  test('lời giao Agent "Việc 37: ..." khớp đúng việc 37 và nhận model, effort đã phân như việc 3, không hỏi lại router', { options: { planApproval: 'off' } }, async ($, on) => {
    const seen = setup(on, () => many(45, 45, i => (i === 2 || i === 36 ? 'agent' : 'main')))
    const sent: string[] = []
    on('tool.call', { tool: 'Agent' }, (_x, e) => {
      sent.push(`${String((e as { model?: unknown }).model ?? '')}/${String((e as { effort?: unknown }).effort ?? '')}`)
      return { result: 'đã giao' }
    })
    await submit($, GOAL)
    await $.tool.call({ tool: 'Agent', tool_use_id: 'u3', description: 'Việc 3: làm việc giả 3', prompt: 'x' } as never)
    await $.tool.call({ tool: 'Agent', tool_use_id: 'u37', description: 'Việc 37: làm việc giả 37', prompt: 'x' } as never)
    expect(sent.length).toBe(2)
    expect(sent[1]).toBe(sent[0])
    expect(sent[1]).toContain('/low')
    expect(seen.agentRouted.length).toBe(0)
    expect(await status($)).toMatch(/37\. Việc giả 37: (đang chạy|xong)/)
  })

  test('checklist 40 bước: đóng bước 37 sau lần test đạt thì được nâng verified như bước 3', { options: { planApproval: 'off' } }, async ($, on) => {
    setup(on, () => plan({ goal: GOAL, depth: 'substantial', volume: 'large', kind: 'edit' }))
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: JS.bun_pass, text: JS.bun_pass }))
    await submit($, GOAL)
    await setSteps($, Array.from({ length: 40 }, (_, i) => ({ title: `Bước giả ${i + 1}` })))
    await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'x', new_string: 'y' } as never)
    await $.tool.call({ tool: 'Bash', command: 'bun test' } as never)
    await $.tool.call({ tool: PLAN, action: 'update', step: 3, status: 'done' })
    await $.tool.call({ tool: PLAN, action: 'update', step: 37, status: 'done' })
    const text = await show($)
    expect(text).toContain('[v] 3. Bước giả 3')
    expect(text).toContain('[v] 37. Bước giả 37')
  })
})

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const textOf = (n: unknown): string => (typeof n === 'string' ? n : n !== null && typeof n === 'object' ? (((n as Node).type === 'Button' ? [String((n as Node).props?.label ?? '')] : []).concat(((n as Node).children ?? []).map(textOf))).join(' ') : '')
async function bandRows($: Engine, columns: number, maxRows: number): Promise<string[]> {
  const ui = await $.ui.mount({ plugin: 'focus-conductor', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isCollapsed: false, isWorking: true, maxRows, bodyColumns: columns, scroll: { offset: 0, bodyRows: maxRows }, view: {} } } as never)
  const tree = (await ui.drawn()) as unknown as Node
  await ui.unmount()
  const content = (tree.children ?? []).filter(c => c !== null && typeof c === 'object')[1] as Node
  return (content.children ?? []).filter(c => c !== null && typeof c === 'object').map(textOf)
}
async function paneLines($: Engine, rows: number): Promise<string[]> {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: rows } } } as never)
  const lines = (await ui.findAll({ type: 'Text' })).map(e => e.text)
  await ui.unmount()
  return lines
}

describe('0.8.7 L2: giao diện với 100 việc và 100 bước', () => {
  test('band 56, 72, 120 cột không vượt maxRows; pane 16, 24, 40 dòng dựng được và có dòng ghi số bước còn lại (+N bước mở)', { options: { planApproval: 'off' }, timeoutMs: 30_000 }, async ($, on) => {
    const seen = setup(on, () => many(100, 100))
    await submit($, GOAL)
    await setSteps($, Array.from({ length: 100 }, (_, i) => ({ title: `Bước giả ${i + 1}` })))
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'doing' })
    await step($, seen)
    for (const columns of [56, 72, 120]) {
      for (const maxRows of [1, 2, 3]) expect((await bandRows($, columns, maxRows)).length).toBeLessThanOrEqual(maxRows)
    }
    for (const rows of [16, 24, 40]) {
      const lines = await paneLines($, rows)
      expect(lines.length).toBeGreaterThan(0)
      expect(lines.join('\n')).toMatch(/\+\d+ bước mở/)
    }
  })
})
