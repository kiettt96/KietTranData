// 0.8.0, kịch bản đầu cuối tái hiện phiên thật (fixture ẩn danh): hai lệnh khai in output dạng A10, một lần đối chứng cố ý đỏ do subagent
// chạy, một lệnh ghép "&& ls" trả mã 1, ba đợt giao việc. Kỳ vọng: không có dòng retry-exhausted, không còn bước blocked ở cuối, cảnh báo
// chưa kiểm chỉ ở turn sửa mã thật. Kèm số đo của kịch bản ba đợt: tổng ký tự chèn, số câu báo đợt, số yêu cầu của đợt 3 còn trong brief.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { nextBrief, parseRoute } from '../../hooks/lib/router'
import type { Policy } from '../../hooks/lib/router'
import { base, plan, spawnTool, step, submit, task } from '../support/engine'
import type { Json, Seen } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const LOG = '/tmp/fc-e2e-080.jsonl'
const CHECK_A = '/usr/bin/python3 -B /a/tools/check_a.py'
const CHECK_B = '/usr/bin/python3 -B /a/tools/check_b.py'
const PASS = ['K1: ĐẠT (0 dòng đỏ)', 'K2: ĐẠT (0 dòng đỏ)', 'K3: ĐẠT (0 dòng đỏ)', 'TỔNG: ĐẠT | 13 phép, 0 phép đỏ'].join('\n')
const FAIL = ['K1: CHƯA ĐẠT (3 dòng đỏ)', 'TỔNG: CHƯA ĐẠT | 13 phép, 3 phép đỏ'].join('\n')
const MISSING = 'ls: cannot access /a/out/missing.txt: No such file or directory'
const CONTROL = 'a-ctl'

const tasks = (code: string, n: number) => Array.from({ length: n }, (_, i) => task(`${code}${i}: phần ${code}${i}`, 'main', 'sonnet', 'medium'))
const listOf = (code: string, n: number) => Array.from({ length: n }, (_, i) => `${code}${i}: phần ${code}${i}`).join('\n')
const REQ = (phase: number) => Array.from({ length: 4 }, (_, i) => `Yêu cầu đợt ${phase} số ${i + 1}`)
const PLANS: Json[] = [
  plan({ goal: 'Chạy lô kiểm giá', depth: 'substantial', volume: 'large', tasks: tasks('S', 4), requirements: REQ(1) }),
  plan({ relation: 'continue', goal: '', depth: 'substantial', volume: 'large', tasks: tasks('T', 4), requirements: REQ(2) }),
  plan({ relation: 'continue', goal: '', depth: 'substantial', volume: 'large', tasks: tasks('V', 4), requirements: REQ(3) }),
]

type Out = { context?: string[] }

const OPEN: Policy = { allowFable: false, blocked: new Set(), session: null }
/** Số yêu cầu của đợt 3 còn trong brief sau ba đợt, mỗi đợt việc của đợt trước đã xong (nextBrief như prompt.submit gọi). */
function keptPhase3(): number {
  const prompts = ['Chạy lô kiểm giá S0 đến S3', listOf('T', 4), listOf('V', 4)]
  let brief = nextBrief(null, parseRoute(JSON.stringify(PLANS[0]), OPEN)!, prompts[0] ?? '', 1).brief
  for (const k of [1, 2]) {
    const done = new Set(brief.tasks.map(t => t.index))
    brief = nextBrief(brief, parseRoute(JSON.stringify(PLANS[k]), OPEN)!, prompts[k] ?? '', 1 + k, { openSteps: [], doneTasks: done }).brief
  }
  return REQ(3).filter(item => (brief.requirements ?? []).includes(item)).length
}

function setup(on: On) {
  const writes: string[] = []
  let call = 0
  const seen = base(on, { router: () => PLANS[Math.min(call++, PLANS.length - 1)] ?? null })
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Write' }, () => ({ result: 'đã ghi' }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã xong' }))
  on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: e.tool_use_id === 'ctl' ? CONTROL : `a-${e.tool_use_id}` }))
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    const command = String((e as { command?: unknown }).command ?? '')
    const agentId = (e as { agentId?: string }).agentId
    if (agentId === CONTROL) return { result: FAIL, isError: true as const }
    if (command.includes('&& ls')) return { result: `${PASS}\n${MISSING}`, isError: true as const }
    if (command.startsWith('cd ') && !command.includes('&&')) return { result: '' }
    if (command.includes('check_')) return { result: PASS }
    return { result: 'đã ghi 120 dòng' }
  })
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  on('fs.write', (_$, e) => {
    if (e.path === LOG) writes.push(e.text)
    return { value: undefined }
  })
  const lines = () => (writes[writes.length - 1] ?? '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
  return { seen, lines }
}

const answer = (turnId: string) => ({ turnId, answer: 'xong', durationMs: 5, isAborted: false, reason: 'answer' }) as never
const stop = async ($: Engine) => String(((await $.classic.Stop({ stop_hook_active: false } as never)) as { block?: string }).block ?? '')

describe('0.8.0: kịch bản đầu cuối tái hiện phiên thật', () => {
  test('ba đợt, đối chứng đỏ, lệnh ghép && ls: không retry-exhausted, không bước blocked, cảnh báo chưa kiểm chỉ ở turn sửa mã', { options: { checkCommands: `${CHECK_A},${CHECK_B}`, decisionLog: LOG } }, async ($, on) => {
    const { seen, lines } = setup(on)
    let injected = 0
    const tool = async (input: Record<string, unknown>) => {
      const out = (await $.tool.call(input as never)) as Out
      for (const c of out.context ?? []) injected += c.length
      return out
    }
    const bash = (command: string, agentId?: string) => tool({ tool: 'Bash', command, ...(agentId !== undefined ? { agentId } : {}) })
    const turn = async (id: string, text: string, s: Seen) => {
      await $.turn.start({ text, turnId: id })
      await step($, s, { turnId: id })
    }
    const closeAll = async (from: number, to: number) => {
      for (let id = from; id <= to; id++) await tool({ tool: PLAN, action: 'update', step: id, status: 'done' })
    }

    // Đợt 1: sửa mã, đối chứng cố ý đỏ do subagent, lệnh ghép && ls trả mã 1, rồi chạy lại dạng tương đối và đạt.
    await submit($, 'Chạy lô kiểm giá S0 đến S3')
    await tool({ tool: PLAN, action: 'set', steps: tasks('S', 4).map(t => ({ title: String(t['title']) })) })
    await turn('t1', 'Chạy lô kiểm giá', seen)
    await tool({ tool: 'Edit', file_path: '/a/src/gia.py', old_string: 'a', new_string: 'b' })
    await spawnTool($, 'ctl', 'Đối chứng cố ý đỏ', `Chạy ${CHECK_A}`)
    await bash(CHECK_A, CONTROL)
    await bash(`${CHECK_B} && ls /a/out/missing.txt`)
    await bash('cd /a/tools && python3 -B check_a.py')
    await bash(`${CHECK_B} 2>&1 | tail -5`)
    await closeAll(1, 4)
    expect(await stop($)).toBe('')
    await $.turn.complete(answer('t1'))

    // Đợt 2: chỉ chạy script phân tích và ghi dữ liệu, báo cáo (không sửa mã).
    await submit($, listOf('T', 4))
    await tool({ tool: PLAN, action: 'set', steps: tasks('T', 4).map(t => ({ title: String(t['title']) })) })
    await turn('t2', 'Đợt 2', seen)
    await bash('python3 /a/tools/phan_tich.py --lo 3')
    await tool({ tool: 'Write', file_path: '/a/out/ket_qua.csv', content: 'a,b' })
    await tool({ tool: 'Write', file_path: '/a/out/bao-cao.md', content: '# báo cáo' })
    await closeAll(1, 4)
    expect(await stop($)).toBe('')
    await $.turn.complete(answer('t2'))

    // Đợt 3: sửa mã rồi kiểm bằng hai lần Bash tách nhau (cd rồi tên trần).
    await submit($, listOf('V', 4))
    await tool({ tool: PLAN, action: 'set', steps: tasks('V', 4).map(t => ({ title: String(t['title']) })) })
    await turn('t3', 'Đợt 3', seen)
    await tool({ tool: 'Edit', file_path: '/a/src/kho.py', old_string: 'a', new_string: 'b' })
    await bash('cd /a/tools')
    await bash('python3 -B check_b.py')
    await closeAll(1, 4)
    expect(await stop($)).toBe('')
    await $.turn.complete(answer('t3'))

    const log = lines()
    expect(log.some(l => l['kind'] === 'retry-exhausted')).toBe(false)
    expect(String((await $.tool.call({ tool: PLAN, action: 'show' })).result)).not.toContain('[b] ')
    // Cảnh báo chưa kiểm: không turn nào bị ghi (turn 1 và 3 sửa mã rồi đã kiểm; turn 2 chỉ có dữ liệu, báo cáo).
    expect(log.filter(l => l['kind'] === 'unverified').length).toBe(0)
    // Ba đợt: hai câu báo đợt (đợt 2, đợt 3), mỗi câu tối đa 160 ký tự; yêu cầu của đợt 3 còn đủ trong brief.
    const contexts = seen.contexts.flat()
    const phaseNotes = contexts.filter(c => c.startsWith('[focus-conductor] Đợt '))
    expect(phaseNotes.length).toBe(2)
    for (const note of phaseNotes) expect(note.length).toBeLessThanOrEqual(160)
    // Chỉ hai lần mở đợt, đều do prompt; plan set ngay sau prompt không cất các việc vừa giao (chưa có bước nào của chúng đóng).
    expect(log.filter(l => l['kind'] === 'phase').map(l => l['cause'])).toEqual(['prompt', 'prompt'])
    expect(phaseNotes.every(note => note.includes('đã cất'))).toBe(true)
    const kept = keptPhase3()
    expect(kept).toBe(4)
    // Số đo [Đo trực tiếp] ghi vào VERIFICATION: ký tự chèn ở kết quả tool và ở prompt (đo bằng bản sao in ra hai số này).
    expect(injected + contexts.reduce((sum, c) => sum + c.length, 0)).toBeGreaterThan(0)
  })

  test('checklist đóng hết bằng các bước không mang mã việc: prompt mở đợt không cất việc nào chưa có bước riêng', { options: { decisionLog: LOG } }, async ($, on) => {
    const { seen, lines } = setup(on)
    await submit($, 'Chạy lô kiểm giá S0 đến S3')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Chuẩn bị dữ liệu' }, { title: 'Dọn thư mục tạm' }] })
    await $.turn.start({ text: 'Chạy lô kiểm giá', turnId: 't1' })
    await step($, seen, { turnId: 't1' })
    for (const id of [1, 2]) await $.tool.call({ tool: PLAN, action: 'update', step: id, status: 'done' })
    await submit($, listOf('T', 4))
    expect(lines().filter(l => l['kind'] === 'phase').map(l => l['tasks'])).toEqual([0])
  })

  test('lệnh ghép && ls trả mã 1 trong đợt đầu: không tạo mục W4, có đúng một câu đề nghị chạy riêng', { options: { checkCommands: `${CHECK_A},${CHECK_B}`, decisionLog: LOG } }, async ($, on) => {
    const { seen, lines } = setup(on)
    await submit($, 'Chạy lô kiểm giá S0 đến S3')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'S0: phần S0' }] })
    await $.turn.start({ text: 'Chạy lô kiểm giá', turnId: 't1' })
    await step($, seen, { turnId: 't1' })
    await $.tool.call({ tool: 'Edit', file_path: '/a/src/gia.py', old_string: 'a', new_string: 'b' } as never)
    const out = (await $.tool.call({ tool: 'Bash', command: `${CHECK_B} && ls /a/out/missing.txt` } as never)) as Out
    expect((out.context ?? []).filter(c => c.includes('chạy riêng')).length).toBe(1)
    await $.tool.call({ tool: 'Bash', command: CHECK_B } as never)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    expect(await stop($)).toBe('')
    expect(lines().some(l => l['kind'] === 'retry')).toBe(false)
  })
})
