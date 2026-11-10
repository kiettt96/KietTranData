// 0.7.8 vòng sửa 3, W4 (yêu cầu mới của chủ mod): lệnh kiểm chạy lỗi mà chưa có lần chạy đạt phủ nó thì cổng Stop không cho kết thúc;
// mỗi lần chặn là một lượt mới, nâng model/effort một bậc qua subagent general-purpose (description "Sửa lỗi kiểm: "), tối đa 3 lượt.
// Hết 3 lượt vẫn lỗi: mod ghi bước blocked và đòi báo cáo cuối có mục "Chưa đạt yêu cầu". Turn chạy sonnet/medium, chính sách mặc
// định, allowFable tắt.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Core } from '../../types'
import * as S from '../../hooks/lib/state'
import * as RT from '../../hooks/lib/router'
import * as EV from '../../hooks/lib/drift/evidence'
import { JS } from '../fixtures/runner-output'
import { PANE, base, conductor, plan, spawnTool, step, submit } from '../support/engine'
import type { Json, Seen } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const GOAL = plan({ goal: 'Sửa hàm tính phí', depth: 'substantial', volume: 'medium', main: { model: 'sonnet', effort: 'medium' } })
const LOG = '/tmp/fc-retry-w4-078.jsonl'
const POLICY = { allowFable: false, blocked: new Set<never>(), session: null }

type Sent = { description: string; model?: string; effort?: string; subagentType?: string }

function setup(on: On, router: (request: string) => Json = () => GOAL) {
  const passing = new Set<string>()
  const sent: Sent[] = []
  const writes: string[] = []
  const seen = base(on, { router })
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Read' }, () => ({ result: 'nội dung', isReadOnly: true }))
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    const command = String((e as { command?: unknown }).command ?? '')
    return passing.has(command) ? { result: JS.bun_pass } : { result: JS.bun_fail, isError: true }
  })
  on('tool.call', { tool: 'Agent' }, (_$, e) => {
    sent.push({ description: e.description, model: e.model, effort: e.effort !== undefined ? String(e.effort) : undefined, subagentType: e.subagent_type })
    return { result: 'đã giao' }
  })
  on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: `a-${e.tool_use_id}` }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  on('fs.write', (_$, e) => {
    writes.push(e.text)
    return { value: undefined }
  })
  const lines = () => (writes[writes.length - 1] ?? '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
  return { seen, passing, sent, lines }
}

const bash = ($: Engine, command: string, agentId?: string) => $.tool.call({ tool: 'Bash', command, ...(agentId !== undefined ? { agentId } : {}) } as never) as Promise<{ context?: string[] }>
const edit = ($: Engine, path = 'src/phi.ts') => $.tool.call({ tool: 'Edit', file_path: path, old_string: 'a', new_string: 'b' } as never) as Promise<{ context?: string[]; deny?: string }>
const stop = async ($: Engine, active = false, message?: string) =>
  String(((await $.classic.Stop({ stop_hook_active: active, ...(message !== undefined ? { last_assistant_message: message } : {}) } as never)) as { block?: string }).block ?? '')
const fixer = ($: Engine, description = 'Sửa lỗi kiểm: hàm tính phí', prompt = 'Sửa lỗi rồi chạy lại bun test') => $.tool.call({ tool: 'Agent', description, prompt } as never)
const shown = async ($: Engine) => String((await $.tool.call({ tool: PLAN, action: 'show' })).result)

/** Mục tiêu có checklist một bước, turn t1 chạy sonnet/medium, sửa file, `command` lỗi, rồi bước đó đóng done. */
async function failing($: Engine, seen: Seen, command = 'bun test', steps = ['Sửa hàm tính phí']) {
  await submit($, 'Sửa hàm tính phí')
  await $.tool.call({ tool: PLAN, action: 'set', steps: steps.map(title => ({ title })) })
  await $.turn.start({ text: 'Sửa hàm tính phí', turnId: 't1' })
  await step($, seen, { turnId: 't1' })
  await edit($)
  const out = await bash($, command)
  await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
  return out
}

describe('W4: lượt nâng mức khi lệnh kiểm lỗi', () => {
  test('1. lượt 1 sang 2: checklist đóng hẳn vẫn chặn; lý do có lệnh, 2/3, sonnet/high; lần giao "Sửa lỗi kiểm: " không ghi model được nâng tối thiểu sonnet/high, có dòng agent-floor', { options: { planApproval: 'off', decisionLog: LOG } }, async ($, on) => {
    const { seen, sent, lines } = setup(on)
    await failing($, seen)
    const reason = await stop($)
    expect(reason).toContain('bun test')
    expect(reason).toContain('2/3')
    expect(reason).toContain('sonnet/high')
    expect(reason).toContain('Sửa lỗi kiểm: ')
    expect(reason.length).toBeLessThanOrEqual(1200)
    await fixer($)
    expect(sent.at(-1)).toMatchObject({ model: 'sonnet', effort: 'high' })
    expect(lines().some(l => l['kind'] === 'agent-floor' && l['retry'] === 'test:bun test')).toBe(true)
    expect(lines().some(l => l['kind'] === 'retry' && l['round'] === 2 && l['level'] === 'sonnet/high')).toBe(true)
  })

  test('2. lượt 2 sang 3: chạy lại vẫn lỗi, stop_hook_active true vẫn chặn; 3/3, sonnet/xhigh; lần giao sau tối thiểu sonnet/xhigh', { options: { planApproval: 'off' } }, async ($, on) => {
    const { seen, sent } = setup(on)
    await failing($, seen)
    await stop($)
    await bash($, 'bun test')
    const reason = await stop($, true)
    expect(reason).toContain('3/3')
    expect(reason).toContain('sonnet/xhigh')
    await fixer($)
    expect(sent.at(-1)).toMatchObject({ model: 'sonnet', effort: 'xhigh' })
  })

  test('3. thang nâng: sonnet/xhigh lên opus/xhigh; opus/xhigh khi allowFable tắt giữ opus/xhigh và báo mức cao nhất', () => {
    const R = RT
    expect(R.nextLevel({ family: 'sonnet', effort: 'medium' }, POLICY)).toMatchObject({ pick: { family: 'sonnet', effort: 'high' }, isTop: false })
    expect(R.nextLevel({ family: 'sonnet', effort: 'xhigh' }, POLICY)).toMatchObject({ pick: { family: 'opus', effort: 'xhigh' }, isTop: false })
    expect(R.nextLevel({ family: 'opus', effort: 'xhigh' }, POLICY)).toMatchObject({ pick: { family: 'opus', effort: 'xhigh' }, isTop: true })
  })

  test('3b. luồng chính opus/xhigh: lượt vẫn tăng, lý do nói đã ở mức cao nhất chính sách cho phép', { options: { planApproval: 'off' } }, async ($, on) => {
    const top = plan({ goal: 'Sửa hàm tính phí', depth: 'hard', volume: 'medium', main: { model: 'opus', effort: 'xhigh' } })
    const { seen } = setup(on, () => top)
    await failing($, seen)
    const reason = await stop($)
    expect(reason).toContain('2/3')
    expect(reason).toContain('đã ở mức cao nhất chính sách cho phép')
  })

  test('4. đạt ở lượt 2: subagent sửa và bun test đạt phủ lần lỗi; Stop cho qua, không còn sàn, không có cảnh báo hết lượt', { options: { planApproval: 'off' } }, async ($, on) => {
    const { seen, passing, sent } = setup(on)
    await failing($, seen)
    await stop($)
    await spawnTool($, 'u1', 'Sửa lỗi kiểm: hàm tính phí', 'Sửa lỗi rồi chạy lại bun test')
    passing.add('bun test')
    await bash($, 'bun test', 'a-u1')
    expect(await stop($)).toBe('')
    await fixer($, 'Sửa lỗi kiểm: phần khác')
    expect(sent.at(-1)).toMatchObject({ model: 'sonnet', effort: 'medium' })
    const pane = await $.ui.mount(PANE)
    const texts = (await pane.findAll({ type: 'Text' })).map(t => t.text ?? '').join('\n')
    await pane.unmount()
    expect(texts).not.toContain('Chưa đạt sau 3 lượt')
  })

  test('5. lần chạy hẹp không phủ: bun test tests/a.test.ts đạt vẫn chặn; bun test đạt thì cho qua', { options: { planApproval: 'off' } }, async ($, on) => {
    const { seen, passing } = setup(on)
    await failing($, seen)
    passing.add('bun test tests/a.test.ts')
    await bash($, 'bun test tests/a.test.ts')
    expect(await stop($)).toContain('bun test')
    passing.add('bun test')
    await bash($, 'bun test')
    expect(await stop($)).toBe('')
  })

  test('6. hết 3 lượt, Claude chưa ghi blocked: mod ghi đúng một bước blocked kèm lệnh và ba mức, đòi báo cáo, toast, cảnh báo, log; lần sau cho qua; cảnh báo còn sau turn; /conductor status có lệnh', { options: { planApproval: 'off', decisionLog: LOG } }, async ($, on) => {
    const { seen, lines } = setup(on)
    await failing($, seen)
    await stop($)
    await bash($, 'bun test')  // 0.8.0 A2: lượt chỉ tăng khi đã chạy lại
    await stop($, true)
    await bash($, 'bun test')  // 0.8.0 A2: lượt chỉ tăng khi đã chạy lại
    const report = await stop($, true)
    expect(report).toContain('Chưa đạt yêu cầu')
    const rows = (await shown($)).split('\n').filter(l => l.startsWith('[b] '))
    expect(rows.length).toBe(1)
    expect(rows[0]).toContain('bun test')
    expect(rows[0]).toContain('sonnet/medium')
    expect(rows[0]).toContain('sonnet/high')
    expect(rows[0]).toContain('sonnet/xhigh')
    expect(seen.toasts.some(t => t.includes('Chưa đạt sau 3 lượt: bun test'))).toBe(true)
    expect(lines().some(l => l['kind'] === 'retry-exhausted')).toBe(false)
    expect(await stop($, true, 'Đã sửa xong.')).toBe('')
    expect(lines().find(l => l['kind'] === 'retry-exhausted')).toMatchObject({ kind: 'retry-exhausted', signature: 'test:bun test', levels: ['sonnet/medium', 'sonnet/high', 'sonnet/xhigh'], step: 1, reported: false })
    await $.turn.complete({ turnId: 't1', answer: 'xong', durationMs: 5, isAborted: false, reason: 'answer' } as never)
    const pane = await $.ui.mount(PANE)
    const texts = (await pane.findAll({ type: 'Text' })).map(t => t.text ?? '').join('\n')
    await pane.unmount()
    expect(texts).toContain('Chưa đạt sau 3 lượt')
    const status = String((await conductor($, 'status')).text)
    expect(status).toContain('bun test')
    expect(status).toContain('sonnet/xhigh')
  })

  test('6b. bước blocked do mod ghi: đúng một bước, note có lệnh và ba mức, không tính là đã đóng', { options: { planApproval: 'off' } }, async ($, on) => {
    const { seen } = setup(on)
    await failing($, seen)
    await stop($)
    await bash($, 'bun test')  // 0.8.0 A2: lượt chỉ tăng khi đã chạy lại
    await stop($)
    await bash($, 'bun test')  // 0.8.0 A2: lượt chỉ tăng khi đã chạy lại
    await stop($)
    const plan1 = await shown($)
    expect(plan1).toContain('Checklist (0/1 đã đóng, 1 bị chặn)')
    expect(plan1).toContain('[b] 1. Sửa hàm tính phí')
  })

  test('7. hết lượt, Claude đã ghi blocked kèm lệnh: không thêm bước, chỉ chặn đòi báo cáo', { options: { planApproval: 'off' } }, async ($, on) => {
    const { seen } = setup(on)
    await failing($, seen, 'bun test', ['Sửa hàm tính phí', 'Kiểm lại phí'])
    await $.tool.call({ tool: PLAN, action: 'update', step: 2, status: 'blocked', note: 'bun test vẫn lỗi ở ca làm tròn' })
    await stop($)
    await bash($, 'bun test')  // 0.8.0 A2: lượt chỉ tăng khi đã chạy lại
    await stop($, true)
    await bash($, 'bun test')  // 0.8.0 A2: lượt chỉ tăng khi đã chạy lại
    expect(await stop($, true)).toContain('Chưa đạt yêu cầu')
    const listed = await shown($)
    expect(listed).not.toContain('Chưa đạt: bun test')
    expect(listed).toContain('[x] 1.')
    expect(listed.split('\n').filter(l => l.startsWith('[b] ')).length).toBe(1)
  })

  test('8. reported: câu trả lời cuối có mục "Chưa đạt yêu cầu" thì true; không có thì false, toast và cảnh báo vẫn có; không có last_assistant_message thì lấy answer của turn.complete', { options: { planApproval: 'off', decisionLog: LOG } }, async ($, on) => {
    const { seen, lines } = setup(on)
    await failing($, seen)
    await stop($)
    await bash($, 'bun test')  // 0.8.0 A2: lượt chỉ tăng khi đã chạy lại
    await stop($, true)
    await bash($, 'bun test')  // 0.8.0 A2: lượt chỉ tăng khi đã chạy lại
    await stop($, true)
    await stop($, true, '## Chưa đạt yêu cầu\n- Việc 1, bun test: lỗi làm tròn; ba lượt đã thử; cần chủ chốt cách làm tròn.')
    expect(lines().find(l => l['kind'] === 'retry-exhausted')).toMatchObject({ reported: true })
  })

  test('8b. không có mục báo cáo: reported false, toast và cảnh báo vẫn có', { options: { planApproval: 'off', decisionLog: LOG } }, async ($, on) => {
    const { seen, lines } = setup(on)
    await failing($, seen)
    await stop($)
    await bash($, 'bun test')  // 0.8.0 A2: lượt chỉ tăng khi đã chạy lại
    await stop($, true)
    await bash($, 'bun test')  // 0.8.0 A2: lượt chỉ tăng khi đã chạy lại
    await stop($, true)
    await stop($, true, 'Xong.')
    expect(lines().find(l => l['kind'] === 'retry-exhausted')).toMatchObject({ reported: false })
    expect(seen.toasts.some(t => t.includes('Chưa đạt sau 3 lượt'))).toBe(true)
  })

  test('8c. Stop không có last_assistant_message: reported lấy từ answer của turn.complete', { options: { planApproval: 'off', decisionLog: LOG } }, async ($, on) => {
    const { seen, lines } = setup(on)
    await failing($, seen)
    await stop($)
    await bash($, 'bun test')  // 0.8.0 A2: lượt chỉ tăng khi đã chạy lại
    await stop($, true)
    await bash($, 'bun test')  // 0.8.0 A2: lượt chỉ tăng khi đã chạy lại
    await stop($, true)
    expect(await stop($, true)).toBe('')
    await $.turn.complete({ turnId: 't1', answer: '## Chưa đạt yêu cầu\n- bun test', durationMs: 5, isAborted: false, reason: 'answer' } as never)
    expect(lines().find(l => l['kind'] === 'retry-exhausted')).toMatchObject({ reported: true })
  })

  // 0.8.0 A2: Stop chưa chạy lại không tăng lượt; hai lần liên tiếp tính một lượt, nên trần chống vòng lặp là 5 lần chặn thay cho 3.
  test('9. sáu lần Stop liên tiếp không có tool call: lượt 2, chờ, lượt 3, chờ, hết lượt, rồi cho qua; tối đa 5 lần chặn', { options: { planApproval: 'off' } }, async ($, on) => {
    const { seen } = setup(on)
    await failing($, seen)
    const blocks = [await stop($), await stop($, true), await stop($, true), await stop($, true), await stop($, true), await stop($, true)]
    expect(blocks[0]).toContain('2/3')
    expect(blocks[1]).toContain('chưa chạy lại')
    expect(blocks[2]).toContain('3/3')
    expect(blocks[3]).toContain('chưa chạy lại')
    expect(blocks[4]).toContain('Chưa đạt yêu cầu')
    expect(blocks[5]).toBe('')
    expect(blocks.filter(Boolean).length).toBeLessThanOrEqual(5)
  })

  test('11. luồng chính tự sửa file ở lượt 2: kết quả Edit có câu dặn giao subagent đúng một lần, tối đa 200 ký tự, không deny', { options: { planApproval: 'off' } }, async ($, on) => {
    const { seen } = setup(on)
    await failing($, seen)
    await stop($)
    const first = await edit($)
    const note = (first.context ?? []).find(c => c.includes('Sửa lỗi kiểm')) ?? ''
    expect(first.deny).toBeUndefined()
    expect(note.length).toBeGreaterThan(0)
    expect(note.length).toBeLessThanOrEqual(200)
    expect((await edit($, 'src/b.ts')).context?.some(c => c.includes('Sửa lỗi kiểm')) ?? false).toBe(false)
  })

  test('12. turn sau khi còn chưa đạt: router nhận mục quan sát có lệnh, effort luồng chính lên một bậc', { options: { planApproval: 'off' } }, async ($, on) => {
    const later = plan({ relation: 'continue', goal: '', main: { model: 'sonnet', effort: 'medium' } })
    const { seen } = setup(on, request => (request.startsWith('Sửa hàm tính phí') ? GOAL : later))
    await failing($, seen)
    await stop($)
    await $.turn.complete({ turnId: 't1', answer: 'tạm dừng', durationMs: 5, isAborted: false, reason: 'answer' } as never)
    await submit($, 'tiếp tục')
    expect(seen.routed.at(-1) ?? '').toContain('bun test')
    await $.turn.start({ text: 'tiếp tục', turnId: 't2' })
    expect((await step($, seen, { turnId: 't2' }))?.effort).toBe('high')
  })

  test('13. plan update done khi còn chưa đạt: kết quả có câu cảnh báo tối đa 200 ký tự; không còn chưa đạt thì không có', { options: { planApproval: 'off' } }, async ($, on) => {
    const { seen, passing } = setup(on)
    await failing($, seen, 'bun test', ['Sửa hàm tính phí', 'Kiểm lại phí'])
    const warned = String((await $.tool.call({ tool: PLAN, action: 'update', step: 2, status: 'done' })).result)
    const sentence = warned.split('\n').find(l => l.includes('chưa đạt')) ?? ''
    expect(sentence.length).toBeGreaterThan(0)
    expect(sentence.length).toBeLessThanOrEqual(200)
    passing.add('bun test')
    await bash($, 'bun test')
    await $.tool.call({ tool: PLAN, action: 'add', steps: [{ title: 'Ghi chú' }] })
    expect(String((await $.tool.call({ tool: PLAN, action: 'update', step: 3, status: 'done' })).result)).not.toContain('chưa đạt')
  })

  test('14. trạng thái lượt nằm trong Core: còn sau vòng JSON (như sau hot reload); Core cũ mặc định rỗng', () => {
    const item = { sig: 'test:bun test', check: 'test', command: 'bun test', runner: 'bun', isNarrow: false, round: 2, levels: ['sonnet/medium', 'sonnet/high'], floor: { family: 'sonnet', effort: 'high' }, lastError: 'error: expect(received).toBe(expected)' }
    const core = S.withRetry({ goalId: 3, items: [item as never] })(S.EMPTY_CORE)
    const reloaded = S.normalizeCore(JSON.parse(JSON.stringify(core)) as Partial<Core>)
    expect(reloaded.retry.goalId).toBe(3)
    expect(reloaded.retry.items[0]).toMatchObject({ round: 2, floor: { family: 'sonnet', effort: 'high' }, lastError: 'error: expect(received).toBe(expected)' })
    expect(S.normalizeCore({} as Partial<Core>).retry).toEqual({ goalId: -1, items: [] })
  })
})

describe('W4: ngoại lệ, cho kết thúc như trước vòng sửa 3', () => {
  test('enforceChecklist false', { options: { planApproval: 'off', enforceChecklist: false } }, async ($, on) => {
    const { seen } = setup(on)
    await failing($, seen)
    expect(await stop($)).toBe('')
  })

  test('đang tạm dừng vì hạn mức (quota.pause khác null)', { options: { planApproval: 'off' } }, async ($, on) => {
    const { seen } = setup(on)
    await failing($, seen)
    await conductor($, 'pause')
    expect(await stop($)).toBe('')
  })

  test('mode off', { options: { planApproval: 'off' } }, async ($, on) => {
    const { seen } = setup(on)
    await failing($, seen)
    await conductor($, 'mode off')
    expect(await stop($)).toBe('')
  })

  test('turn hỏi đáp không thực thi', { options: { planApproval: 'off' } }, async ($, on) => {
    const answer = plan({ relation: 'new', goal: 'Hỏi', kind: 'answer', depth: 'none', main: { model: 'haiku', effort: 'low' } })
    const { seen } = setup(on, request => (request.startsWith('Sửa hàm tính phí') ? GOAL : answer))
    await failing($, seen)
    await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as never)
    await $.turn.start({ text: 'Hàm phí trả về gì', turnId: 't2' })
    await $.tool.call({ tool: 'Read', file_path: 'src/phi.ts' } as never)
    expect(await stop($)).toBe('')
  })

  test('lỗi của mục tiêu cũ sau khi đổi mục tiêu', { options: { planApproval: 'off' } }, async ($, on) => {
    const other = plan({ goal: 'Đổi màu nút', depth: 'light', volume: 'small', main: { model: 'sonnet', effort: 'medium' } })
    const { seen } = setup(on, request => (request.startsWith('Sửa hàm tính phí') ? GOAL : other))
    await failing($, seen)
    await submit($, 'Đổi màu nút')
    await edit($, 'src/nut.css')
    expect(await stop($)).toBe('')
  })
})

describe('W4: phủ lần lỗi theo lệnh hẹp hay rộng (điều chỉnh 2)', () => {
  const t = (command: string) => ({ check: 'test' as const, command })
  const covers = (pass: string, fail: string) => EV.coversFailure(t(pass), t(fail))
  test('go test ./... đạt phủ go test ./pkg/a lỗi', () => expect(covers('go test ./...', 'go test ./pkg/a')).toBe(true))
  test('npx vitest run đạt phủ npx vitest run tests/a.test.ts lỗi', () => expect(covers('npx vitest run', 'npx vitest run tests/a.test.ts')).toBe(true))
  test('npm run test đạt phủ chính nó lỗi', () => expect(covers('npm run test', 'npm run test')).toBe(true))
  test('pytest tests/ đạt phủ pytest tests/test_a.py::test_x lỗi', () => expect(covers('pytest tests/', 'pytest tests/test_a.py::test_x')).toBe(true))
  test('bun test tests/a.test.ts đạt không phủ bun test lỗi', () => expect(covers('bun test tests/a.test.ts', 'bun test')).toBe(false))
  test('cờ lọc làm lệnh hẹp: bun test -t phí đạt không phủ bun test lỗi', () => expect(covers('bun test -t phí', 'bun test')).toBe(false))
  test('npm run test đạt không phủ npm run lint lỗi (trình chạy không biết: chỉ lệnh trùng)', () => expect(covers('npm run test', 'npm run lint')).toBe(false))
})

describe('W4: nhiều lệnh cùng chưa đạt (điều chỉnh 3, 4)', () => {
  test('7 lệnh khác nhau cùng lỗi: Stop vẫn chặn, lý do có 5 tên và "và 2 lệnh khác"', { options: { planApproval: 'off' } }, async ($, on) => {
    const { seen } = setup(on)
    await failing($, seen, 'bun test tests/a1.test.ts')
    for (let i = 2; i <= 7; i++) await bash($, `bun test tests/a${i}.test.ts`)
    const reason = await stop($)
    for (let i = 1; i <= 5; i++) expect(reason).toContain(`bun test tests/a${i}.test.ts`)
    expect(reason).toContain('và 2 lệnh khác')
    expect(reason.length).toBeLessThanOrEqual(1200)
  })

  test('hai lệnh: một lệnh đạt ở lượt 2, lệnh kia hết lượt và được ghi blocked', { options: { planApproval: 'off' } }, async ($, on) => {
    const { seen, passing } = setup(on)
    await failing($, seen, 'bun test tests/a.test.ts')
    await bash($, 'bun test tests/b.test.ts')
    const first = await stop($)
    expect(first).toContain('bun test tests/a.test.ts')
    expect(first).toContain('bun test tests/b.test.ts')
    passing.add('bun test tests/a.test.ts')
    await bash($, 'bun test tests/a.test.ts')
    await bash($, 'bun test tests/b.test.ts')  // 0.8.0 A2: lượt chỉ tăng khi đã chạy lại
    const second = await stop($, true)
    expect(second).toContain('bun test tests/b.test.ts')
    expect(second).not.toContain('bun test tests/a.test.ts')
    await bash($, 'bun test tests/b.test.ts')  // 0.8.0 A2: lượt chỉ tăng khi đã chạy lại
    expect(await stop($, true)).toContain('Chưa đạt yêu cầu')
    const rows = (await shown($)).split('\n').filter(l => l.startsWith('[b] '))
    expect(rows.length).toBe(1)
    expect(rows[0]).toContain('bun test tests/b.test.ts')
    expect(rows[0]).not.toContain('bun test tests/a.test.ts')
  })
})

describe('W4: sàn chỉ áp cho lần giao sửa lỗi kiểm (điều chỉnh 5)', () => {
  test('lượt 2: giao Explore tra cứu không bị nâng; giao "Sửa lỗi kiểm: ..." được nâng', { options: { planApproval: 'off' } }, async ($, on) => {
    const { seen, sent } = setup(on)
    await failing($, seen)
    await stop($)
    await $.tool.call({ tool: 'Agent', description: 'Tìm chỗ gọi hàm phí', prompt: 'Tìm trong src/ chỗ gọi hàm phí', subagent_type: 'Explore' } as never)
    expect(sent.at(-1)).toMatchObject({ model: 'haiku', effort: 'low' })
    await fixer($)
    expect(sent.at(-1)).toMatchObject({ model: 'sonnet', effort: 'high' })
  })

  test('general-purpose có prompt nhắc đúng lệnh chưa đạt: được nâng; prompt không nhắc: giữ route', { options: { planApproval: 'off' } }, async ($, on) => {
    const { seen, sent } = setup(on)
    await failing($, seen)
    await stop($)
    await $.tool.call({ tool: 'Agent', description: 'Sửa chú thích', prompt: 'Sửa chú thích đầu tệp cấu hình', subagent_type: 'general-purpose' } as never)
    expect(sent.at(-1)).toMatchObject({ model: 'sonnet', effort: 'medium' })
    await $.tool.call({ tool: 'Agent', description: 'Sửa hàm phí', prompt: 'Sửa hàm phí rồi chạy lại bun test cho đạt', subagent_type: 'general-purpose' } as never)
    expect(sent.at(-1)).toMatchObject({ model: 'sonnet', effort: 'high' })
  })
})
