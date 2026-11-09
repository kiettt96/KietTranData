// 0.8.0 A5: cảnh báo "Turn có N thay đổi nhưng không chạy bước kiểm tra nào" và cổng Y6 chỉ tính thay đổi chắc chắn (Edit, Write, ghi qua
// chuyển hướng hay lệnh ghi đã biết) vào file không nhẹ. Lệnh Bash "có thể ghi" (script lạ) chỉ được đếm riêng; file dữ liệu và báo cáo
// (.md .markdown .txt .csv .tsv .jsonl .log, cộng glob của option softPaths) là thay đổi nhẹ; .json và .yaml không tự nhẹ. Nhiều turn liên tiếp
// cùng nguyên nhân gộp thành một dòng "(n turn)"; còn subagent chạy chưa trả về thì hoãn cảnh báo và Y6 tới khi subagent cuối trả về.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { newTracker, observe, summarize } from '../../hooks/lib/drift'
import { bash as bashCall, edit as editCall, makeBrief } from '../support/commands'
import { PANE, base, plan, spawnTool, submit } from '../support/engine'
import type { Json, Seen } from '../support/engine'

const BAND = { plugin: 'focus-conductor', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 6, bodyColumns: 160, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as const
const PLAN = 'mcp__focus-conductor__plan'
const GOAL = plan({ goal: 'Sửa hàm tính phí', depth: 'substantial', volume: 'medium', main: { model: 'sonnet', effort: 'medium' } })
const router = (request: string): Json => (request.startsWith('làm tiếp') ? { ...GOAL, relation: 'continue', kind: 'mixed' } : GOAL)
const NO_CHECK = 'không chạy bước kiểm tra nào'
const NUDGE = 'chưa chạy lần kiểm nào'
const isUnverified = (t: string) => t.includes(NO_CHECK) || t.includes('chưa được kiểm tra lại')

function setup(on: On): Seen {
  const seen = base(on, { router })
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Write' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Read' }, () => ({ result: 'nội dung', isReadOnly: true }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'log' }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'sub-1' }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  return seen
}

const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never)
const edit = ($: Engine, path: string) => $.tool.call({ tool: 'Edit', file_path: path, old_string: 'a', new_string: 'b' } as never)
const write = ($: Engine, path: string) => $.tool.call({ tool: 'Write', file_path: path, content: 'x' } as never)
const done = (turnId: string, extra: Record<string, unknown> = {}) => ({ turnId, answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer', ...extra }) as never
const stop = async ($: Engine) => String(((await $.classic.Stop({ stop_hook_active: false } as never)) as { block?: string }).block ?? '')

/** Một turn luồng chính: prompt, việc `work`, kết thúc. */
async function turn($: Engine, n: number, work: () => Promise<unknown>, text = n === 1 ? 'Sửa hàm tính phí' : `làm tiếp lần ${n}`) {
  await submit($, text)
  await $.turn.start({ text, turnId: `t${n}` })
  await work()
  await $.turn.complete(done(`t${n}`))
}

/** Mọi chữ trên band và pane. */
async function texts($: Engine): Promise<string[]> {
  const out: string[] = []
  for (const target of [BAND, PANE]) {
    const ui = await $.ui.mount(target)
    out.push(...(await ui.findAll({ type: 'Text' })).map(e => e.text ?? ''))
    await ui.unmount()
  }
  return out
}
const warned = async ($: Engine) => (await texts($)).filter(isUnverified)

describe('0.8.0 A5: chỉ thay đổi chắc chắn vào file không nhẹ mới cảnh báo', () => {
  test('turn chỉ chạy script không rõ, không Edit: không toast, band và pane không có cảnh báo', {}, async ($, on) => {
    const seen = setup(on)
    await turn($, 1, () => bash($, 'python3 scripts/chay_mo_hinh.py --nhanh'))
    expect(seen.toasts.filter(isUnverified)).toEqual([])
    expect(await warned($)).toEqual([])
  })

  test('turn chỉ ghi out/a.csv và bao-cao.md: không cảnh báo', {}, async ($, on) => {
    const seen = setup(on)
    await turn($, 1, async () => {
      await write($, 'out/a.csv')
      await write($, 'bao-cao.md')
    })
    expect(seen.toasts.filter(isUnverified)).toEqual([])
    expect(await warned($)).toEqual([])
  })

  test('Edit src/a.py không kiểm: có toast, band và pane có cảnh báo', { options: { planApproval: 'off' } }, async ($, on) => {
    const seen = setup(on)
    await turn($, 1, () => edit($, 'src/a.py'))
    expect(seen.toasts.filter(isUnverified).length).toBe(1)
    expect((await warned($)).length).toBeGreaterThan(0)
  })

  test('script không rõ cộng một Edit src/a.py: có cảnh báo, số thay đổi vẫn đếm cả hai', { options: { planApproval: 'off' } }, async ($, on) => {
    const seen = setup(on)
    await turn($, 1, async () => {
      await bash($, 'python3 scripts/chay_mo_hinh.py')
      await edit($, 'src/a.py')
    })
    expect(seen.toasts.some(t => t.includes('Turn có 2 thay đổi'))).toBe(true)
  })

  test('.json và .yaml không tự nhẹ: Write cau-hinh.json hay ci.yaml là có cảnh báo', { options: { planApproval: 'off' } }, async ($, on) => {
    const seen = setup(on)
    await turn($, 1, () => write($, 'cau-hinh.json'))
    expect(seen.toasts.filter(isUnverified).length).toBe(1)
    await turn($, 2, () => write($, 'ci.yaml'))
    expect((await warned($)).length).toBeGreaterThan(0)
  })

  test('đuôi dữ liệu .tsv .jsonl .txt .markdown đều nhẹ', {}, async ($, on) => {
    const seen = setup(on)
    await turn($, 1, async () => {
      for (const path of ['out/b.tsv', 'out/c.jsonl', 'ghi-chu.txt', 'docs/d.markdown']) await write($, path)
    })
    expect(seen.toasts.filter(isUnverified)).toEqual([])
  })

  test('echo x >> /a/run/nhat-ky.log là thay đổi nhẹ: không cảnh báo', {}, async ($, on) => {
    const seen = setup(on)
    await turn($, 1, () => bash($, 'echo x >> /a/run/nhat-ky.log'))
    expect(seen.toasts.filter(isUnverified)).toEqual([])
    expect(await warned($)).toEqual([])
  })

  test('đối chứng: echo x >> /a/run/nhat-ky.py là thay đổi chắc chắn vào mã: có cảnh báo', { options: { planApproval: 'off' } }, async ($, on) => {
    const seen = setup(on)
    await turn($, 1, () => bash($, 'echo x >> /a/run/nhat-ky.py'))
    expect(seen.toasts.filter(isUnverified).length).toBe(1)
  })
})

describe('0.8.0 A5: option softPaths', () => {
  const OPTIONS = { options: { softPaths: 'ket-qua/**' } }

const OPTIONS_PA_OFF = { ...OPTIONS, options: { ...OPTIONS.options, planApproval: 'off' } }
  test('softPaths là ket-qua/**: Write ket-qua/x.json là nhẹ', OPTIONS, async ($, on) => {
    const seen = setup(on)
    await turn($, 1, () => write($, 'ket-qua/x.json'))
    expect(seen.toasts.filter(isUnverified)).toEqual([])
    expect(await warned($)).toEqual([])
  })

  test('softPaths khớp cả đường dẫn tuyệt đối trong dự án, và không khớp thư mục khác', OPTIONS_PA_OFF, async ($, on) => {
    const seen = setup(on)
    await turn($, 1, () => write($, '/repo/ket-qua/sub/y.json'))
    expect(seen.toasts.filter(isUnverified)).toEqual([])
    await turn($, 2, () => write($, 'ket-qua-cu/z.json'))
    expect(seen.toasts.filter(isUnverified).length).toBe(1)
  })

  test('đối chứng: không khai softPaths thì Write ket-qua/x.json có cảnh báo', { options: { planApproval: 'off' } }, async ($, on) => {
    const seen = setup(on)
    await turn($, 1, () => write($, 'ket-qua/x.json'))
    expect(seen.toasts.filter(isUnverified).length).toBe(1)
  })
})

describe('0.8.0 A5: cùng nguyên nhân ở turn liên tiếp gộp một dòng', () => {
  test('ba turn liên tiếp cùng nguyên nhân: một dòng "(3 turn)", một toast', { options: { planApproval: 'off' } }, async ($, on) => {
    const seen = setup(on)
    for (const n of [1, 2, 3]) await turn($, n, () => edit($, `src/a${n}.py`))
    const lines = (await texts($)).filter(t => t.includes(NO_CHECK))
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.every(t => t.includes('(3 turn)'))).toBe(true)
    const pane = await $.ui.mount(PANE)
    const inPane = (await pane.findAll({ type: 'Text' })).map(e => e.text ?? '').filter(t => t.includes(NO_CHECK))
    await pane.unmount()
    expect(inPane.length).toBe(1)
    expect(seen.toasts.filter(isUnverified).length).toBe(1)
  })

  test('hai turn cùng nguyên nhân: "(2 turn)"; không có hậu tố ở turn đầu', { options: { planApproval: 'off' } }, async ($, on) => {
    setup(on)
    await turn($, 1, () => edit($, 'src/a.py'))
    expect((await texts($)).some(t => t.includes(NO_CHECK) && t.includes('turn)'))).toBe(false)
    await turn($, 2, () => edit($, 'src/b.py'))
    expect((await texts($)).some(t => t.includes(NO_CHECK) && t.includes('(2 turn)'))).toBe(true)
  })

  test('một turn sạch ở giữa làm đứt chuỗi: dòng mới bắt đầu lại từ một turn', { options: { planApproval: 'off' } }, async ($, on) => {
    setup(on)
    await turn($, 1, () => edit($, 'src/a.py'))
    await turn($, 2, () => write($, 'bao-cao.md'))
    await turn($, 3, async () => {
      await edit($, 'src/b.py')
      await edit($, 'src/c.py')
    })
    const pane = await $.ui.mount(PANE)
    const lines = (await pane.findAll({ type: 'Text' })).map(e => e.text ?? '').filter(t => t.includes(NO_CHECK))
    await pane.unmount()
    expect(lines.length).toBe(2)
    expect(lines.some(t => t.includes('turn)'))).toBe(false)
  })

  test('nguyên nhân khác nhau không gộp: lệnh kiểm bị loại khác nhau là hai dòng', { options: { planApproval: 'off' } }, async ($, on) => {
    setup(on)
    await turn($, 1, async () => {
      await edit($, 'src/a.py')
      await bash($, 'npm test 2>&1 | tail -20')
    })
    await turn($, 2, async () => {
      await edit($, 'src/b.py')
      await bash($, 'npx vitest run 2>&1 | tail -20')
    })
    const pane = await $.ui.mount(PANE)
    const lines = (await pane.findAll({ type: 'Text' })).map(e => e.text ?? '').filter(t => t.includes(NO_CHECK))
    await pane.unmount()
    expect(lines.length).toBe(2)
  })
})

describe('0.8.0 A5: còn subagent chạy chưa trả về thì hoãn cảnh báo', () => {
  test('Edit src/a.py khi subagent còn mở: không cảnh báo ở turn đó; subagent trả về mà chưa kiểm: có cảnh báo', { options: { planApproval: 'off' } }, async ($, on) => {
    const seen = setup(on)
    await submit($, 'Sửa hàm tính phí')
    await $.turn.start({ text: 'Sửa hàm tính phí', turnId: 't1' })
    await spawnTool($, 'u1', 'Chạy nền', 'Chạy phân tích nền')
    await edit($, 'src/a.py')
    await $.turn.complete(done('t1'))
    expect(seen.toasts.filter(isUnverified)).toEqual([])
    expect(await warned($)).toEqual([])
    await $.turn.complete(done('sub-end', { agentId: 'sub-1' }))
    expect(seen.toasts.filter(isUnverified).length).toBe(1)
    expect((await warned($)).length).toBeGreaterThan(0)
  })

  test('subagent trả về sau khi thay đổi đã được kiểm: không cảnh báo', { options: { checkCommands: 'bun test' } }, async ($, on) => {
    const seen = setup(on)
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'bun test v1\n 12 pass\n 0 fail\nRan 12 tests across 2 files. [20ms]' }))
    await submit($, 'Sửa hàm tính phí')
    await $.turn.start({ text: 'Sửa hàm tính phí', turnId: 't1' })
    await spawnTool($, 'u1', 'Chạy nền', 'Chạy phân tích nền')
    await edit($, 'src/a.py')
    await bash($, 'bun test')
    await $.turn.complete(done('t1'))
    await $.turn.complete(done('sub-end', { agentId: 'sub-1' }))
    expect(seen.toasts.filter(isUnverified)).toEqual([])
  })

  test('Stop đầu tiên không còn subagent nào chạy: tính lại cảnh báo đã hoãn', { options: { planApproval: 'off' } }, async ($, on) => {
    const seen = setup(on)
    await submit($, 'Sửa hàm tính phí')
    await $.turn.start({ text: 'Sửa hàm tính phí', turnId: 't1' })
    await spawnTool($, 'u1', 'Chạy nền', 'Chạy phân tích nền')
    await edit($, 'src/a.py')
    await $.turn.complete(done('t1'))
    expect(seen.toasts.filter(isUnverified)).toEqual([])
    await $.turn.complete(done('sub-end', { agentId: 'sub-1' }))
    expect(seen.toasts.filter(isUnverified).length).toBe(1)
    await stop($)
    expect(seen.toasts.filter(isUnverified).length).toBe(1)
  })
})

describe('0.8.0 A5: cổng Y6 dùng cùng cách đếm', () => {
  const DECLARED = { options: { checkCommands: 'bun test' } }

const DECLARED_PA_OFF = { ...DECLARED, options: { ...DECLARED.options, planApproval: 'off' } }
  async function goal($: Engine, seen: Seen, work: () => Promise<unknown>) {
    await submit($, 'Sửa hàm tính phí')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa hàm tính phí' }] })
    await $.turn.start({ text: 'Sửa hàm tính phí', turnId: 't1' })
    await work()
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    return seen
  }

  test('Edit src/a.py chưa kiểm: Stop chặn một lần', DECLARED_PA_OFF, async ($, on) => {
    const seen = setup(on)
    await goal($, seen, () => edit($, 'src/a.py'))
    expect(await stop($)).toContain(NUDGE)
  })

  test('chỉ ghi dữ liệu và báo cáo (csv, md, log): Stop không chặn vì Y6', DECLARED, async ($, on) => {
    const seen = setup(on)
    await goal($, seen, async () => {
      await write($, 'out/a.csv')
      await write($, 'bao-cao.md')
      await bash($, 'echo x >> /a/run/nhat-ky.log')
    })
    expect(await stop($)).not.toContain(NUDGE)
  })

  test('chỉ chạy script không rõ: Stop không chặn vì Y6', DECLARED, async ($, on) => {
    const seen = setup(on)
    await goal($, seen, () => bash($, 'python3 scripts/chay_mo_hinh.py'))
    expect(await stop($)).not.toContain(NUDGE)
  })

  test('softPaths khai ket-qua/**: Write ket-qua/x.json không bị Y6 chặn', { options: { checkCommands: 'bun test', softPaths: 'ket-qua/**' } }, async ($, on) => {
    const seen = setup(on)
    await goal($, seen, () => write($, 'ket-qua/x.json'))
    expect(await stop($)).not.toContain(NUDGE)
  })

  test('còn subagent chạy: Y6 hoãn; subagent trả về mà chưa kiểm thì Stop kế tiếp chặn', DECLARED_PA_OFF, async ($, on) => {
    const seen = setup(on)
    await goal($, seen, async () => {
      await spawnTool($, 'u1', 'Chạy nền', 'Chạy phân tích nền')
      await edit($, 'src/a.py')
    })
    expect(await stop($)).not.toContain(NUDGE)
    await $.turn.complete(done('sub-end', { agentId: 'sub-1' }))
    expect(await stop($)).toContain(NUDGE)
  })
})

describe('0.8.0 A5: tracker', () => {
  const brief = makeBrief()
  const unverified = (calls: ReturnType<typeof editCall>[]) => {
    const tracker = newTracker('t')
    for (const call of calls) observe(tracker, call as never, brief, [])
    return { tracker, finding: summarize(tracker, brief, []).find(f => f.kind === 'unverified') }
  }

  test('lệnh "có thể ghi" chỉ đếm riêng: mutations tăng, maybe tăng, không có phát hiện', () => {
    const { tracker, finding } = unverified([bashCall('python3 scripts/chay.py') as never])
    expect(tracker.mutations).toBe(1)
    expect(tracker.maybe).toBe(1)
    expect(finding).toBeUndefined()
  })

  test('Edit .py cộng ghi csv: có phát hiện thường; chỉ csv thì không', () => {
    expect(unverified([editCall('/p/a.py') as never, editCall('/p/o.csv') as never]).finding?.isSoft).toBeUndefined()
    expect(unverified([editCall('/p/o.csv') as never]).finding).toBeUndefined()
  })
})
