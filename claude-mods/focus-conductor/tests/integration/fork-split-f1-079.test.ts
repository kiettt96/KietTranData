// 0.7.9 F1 (yêu cầu bổ sung của chủ mod): việc run: main có volume large chia được thành các phần độc lập thì router ghi `split`, mod
// kẹp `split` trong parseRoute, dặn chạy các phần song song bằng phiên con (Agent subagent_type "fork"), theo dõi từng phần, gom kết quả
// và thu gọn ở pane. F1 đứng sau phân việc của router: không đổi run, model, effort của việc nào. Option `forks` (mặc định tắt) và
// `maxForks` (0 đến 6, mặc định 3). Engine từ chối phiên con (lời gọi lỗi mà không có agent.spawn fork cùng tool_use_id) thì mod ghi
// fork-off một lần, tắt tách đến hết phiên và trả các phần về luồng chính; phiên con đã chạy rồi mới lỗi là lỗi nghiệp vụ, Stop chặn.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Task } from '../../types'
import { parseRoute, routerRequest, routerSystem } from '../../hooks/lib/router'
import type { Policy, RouterPlan } from '../../hooks/lib/router'
import { stepCovers, taskMatch } from '../../hooks/lib/route'
import { missingTasks } from '../../hooks/lib/text'
import { JS } from '../fixtures/runner-output'
import { BIG_USAGE, PANE, base, plan, step, submit, task } from '../support/engine'
import type { Json, Seen } from '../support/engine'
import { quotaMeter, week } from '../support/quota'

const PLAN = 'mcp__focus-conductor__plan'
const LOG = '/tmp/fc-fork-f1-079.jsonl'
const ON = { forks: true, maxForks: 3, decisionLog: LOG, enforceChecklist: true }
/** Description của phiên con theo phần: khác tên phần trong split, để dòng của phần ở pane khác nhãn ở nhật ký điều phối. */
const D = { a: 'Việc 3a: đổi tên ở module thanh toán', b: 'Việc 3b: đổi tên ở module kho', c: 'Việc 3c: đổi tên ở module báo cáo' }
const PROMPT = 'Đổi tên hàm tính phí trong ba module thanh toán, kho và báo cáo'
/** Chuỗi lỗi giả của engine khi không mở được phiên con: mod không dựa vào chữ này, chỉ dựa vào việc không có agent.spawn. */
const REFUSAL = 'Loại agent fork không dùng được trong phiên này'
const BAND = { plugin: 'focus-conductor', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 6, bodyColumns: 160, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as const

const OPEN: Policy = { allowFable: false, blocked: new Set(), session: null }
const withForks = (n: number) => ({ ...OPEN, forks: n }) as Policy

const SPLIT = [
  { title: 'Module thanh toán', files: ['src/pay'] },
  { title: 'Module kho', files: ['src/stock'] },
  { title: 'Module báo cáo', files: ['src/report'] },
]

/** Router trả ba việc: hai việc giao subagent, Việc 3 làm ở luồng chính, khối lượng lớn, `split` như tham số (null là không ghi). */
function big(split: unknown = SPLIT, third: Json = {}, over: Json = {}): Json {
  return plan({
    goal: 'Đổi tên hàm tính phí trong ba module',
    depth: 'substantial',
    volume: 'large',
    kind: 'edit',
    main: { model: 'sonnet', effort: 'medium', why: 'nhiều file' },
    tasks: [
      task('Liệt kê chỗ gọi hàm tính phí', 'agent', 'haiku', 'low', { agent: 'Explore', kind: 'investigate', depth: 'none' }),
      task('Viết test cho tên hàm mới', 'agent', 'sonnet', 'medium'),
      task('Đổi tên hàm tính phí trong ba module', 'main', 'sonnet', 'medium', { depth: 'substantial', volume: 'large', ...(split === null ? {} : { split }), ...third }),
    ],
    ...over,
  })
}

/** Kế hoạch chỉ có Việc 3 (không có việc giao subagent nào), cho strictDelegation. */
function lone(): Json {
  return plan({
    goal: 'Đổi tên hàm tính phí trong ba module',
    depth: 'substantial',
    volume: 'large',
    main: { model: 'sonnet', effort: 'medium' },
    tasks: [
      task('Đọc quy ước đặt tên', 'main', 'sonnet', 'medium'),
      task('Ghi chú thay đổi', 'main', 'sonnet', 'medium'),
      task('Đổi tên hàm tính phí trong ba module', 'main', 'sonnet', 'medium', { depth: 'substantial', volume: 'large', split: SPLIT }),
    ],
  })
}

const routed = (json: Json, policy: Policy = withForks(3)): RouterPlan => parseRoute(JSON.stringify(json), policy) as RouterPlan
const third = (p: RouterPlan): Task => p.tasks.find(t => t.index === 3) as Task

type Call = { context?: string[]; result?: unknown; isError?: boolean; deny?: string }

/**
 * Engine giả: Agent của phiên con khởi động qua $.agent.spawn (fork true) rồi trả kết quả; `fail` là phiên con đã chạy rồi lỗi,
 * `refuse` là engine từ chối trước khi có agent.spawn. Bash đạt khi lệnh nằm trong `passing`. Nhật ký quyết định đọc từ lần ghi cuối.
 */
function setup(on: On, $: Engine, router: (request: string) => Json | null = () => big()) {
  const seen = base(on, { router })
  const modes = new Map<string, 'fail' | 'refuse'>()
  const passing = new Set<string>()
  const writes: string[] = []
  const state = { refuseAll: false }
  on('tool.call', { tool: 'Agent' }, async (_x, e) => {
    const id = String(e.tool_use_id)
    const how = state.refuseAll ? 'refuse' : (modes.get(id) ?? 'spawn')
    if (how === 'refuse') return { result: REFUSAL, isError: true }
    await $.agent.spawn({ prompt: e.prompt, description: e.description, tool_use_id: id, fork: e.subagent_type === 'fork', subagentType: e.subagent_type ?? 'general-purpose' } as never)
    return how === 'fail' ? { result: 'phiên con dừng vì lỗi khi sửa file', isError: true } : { result: 'đã xong phần việc' }
  })
  on('agent.spawn', (_x, e) => ({ model: 'claude-sonnet-5-5', agentId: `f-${e.tool_use_id}` }))
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Read' }, () => ({ result: 'nội dung', isReadOnly: true }))
  on('tool.call', { tool: 'Bash' }, (_x, e) => {
    const command = String((e as { command?: unknown }).command ?? '')
    return passing.has(command) ? { result: JS.bun_pass } : { result: JS.bun_fail, isError: true }
  })
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  on('fs.write', (_x, e) => {
    if (e.path === LOG) writes.push(e.text)
    return { value: undefined }
  })
  const lines = () => (writes[writes.length - 1] ?? '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
  return { seen, modes, passing, lines, state }
}

const fork = ($: Engine, id: string, description: string, prompt = 'Làm phần việc được giao') =>
  $.tool.call({ tool: 'Agent', tool_use_id: id, subagent_type: 'fork', description, prompt } as never) as Promise<Call>
const finish = ($: Engine, id: string, reason = 'answer', usage?: Record<string, unknown>) =>
  $.turn.complete({ turnId: `f-${id}`, agentId: `f-${id}`, answer: '', durationMs: 1, isAborted: false, reason, ...(usage !== undefined ? { usage } : {}) } as never)
const readFile = ($: Engine) => $.tool.call({ tool: 'Read', file_path: 'src/pay/a.ts' } as never) as Promise<Call>
const edit = ($: Engine, path: string, agentId?: string) =>
  $.tool.call({ tool: 'Edit', file_path: path, old_string: 'a', new_string: 'b', ...(agentId !== undefined ? { agentId } : {}) } as never) as Promise<Call>
const bash = ($: Engine, command: string, agentId?: string) => $.tool.call({ tool: 'Bash', command, ...(agentId !== undefined ? { agentId } : {}) } as never) as Promise<Call>
const stop = async ($: Engine) => String(((await $.classic.Stop({ stop_hook_active: false } as never)) as { block?: string }).block ?? '')
const contextOf = (seen: Seen) => (seen.contexts.at(-1) ?? []).join('\n')
const blockOf = (context: string, index = 3) => context.split('\n').find(line => line.startsWith(`Việc ${index} khối lượng lớn, tách`))
const noteOf = (out: Call, mark: string) => (out.context ?? []).filter(c => c.includes(mark))
async function textsOf($: Engine, target: typeof PANE | typeof BAND = PANE): Promise<string> {
  const ui = await $.ui.mount(target as never)
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '').join('\n')
  await ui.unmount()
  return texts
}

/** Mục tiêu từ PROMPT, checklist một bước của Việc 3, luồng chính đang chạy turn t1. */
async function started($: Engine, seen: Seen, steps = ['Việc 3: đổi tên trong ba module']) {
  await submit($, PROMPT)
  await $.tool.call({ tool: PLAN, action: 'set', steps: steps.map(title => ({ title })) })
  await $.turn.start({ text: PROMPT, turnId: 't1' })
  await step($, seen, { turnId: 't1' })
}

describe('F1: router đề xuất tách, mod kẹp trong parseRoute', () => {
  test('1. đủ bốn điều kiện: khối dặn tách có đủ ba phần, không quá 600 ký tự; việc giao subagent giữ nguyên dòng phân việc', { options: ON }, async ($, on) => {
    const { seen } = setup(on, $)
    await submit($, PROMPT)
    const context = contextOf(seen)
    const block = blockOf(context)
    expect(block).toBeDefined()
    expect((block ?? '').length).toBeLessThanOrEqual(600)
    for (const code of ['3a', '3b', '3c']) expect(block).toContain(code)
    expect(block).toContain('subagent_type "fork"')
    expect(block).toContain('Module kho')
    expect(context).toContain('1. Liệt kê chỗ gọi hàm tính phí → giao Explore haiku/low')
    expect(context).toContain('2. Viết test cho tên hàm mới → giao general-purpose sonnet/medium')
    expect(third(routed(big())).split?.map(p => p.part)).toEqual(['a', 'b', 'c'])
  })

  test('2. việc volume medium có split: split bị bỏ, notes có lý do, context không có khối tách', { options: ON }, async ($, on) => {
    const parsed = routed(big(SPLIT, { volume: 'medium' }))
    expect(third(parsed).split).toBeUndefined()
    expect(parsed.notes.some(n => n.includes('split') && n.includes('3'))).toBe(true)
    const { seen } = setup(on, $, () => big(SPLIT, { volume: 'medium' }))
    await submit($, PROMPT)
    expect(blockOf(contextOf(seen))).toBeUndefined()
  })

  test('3. việc run: agent, volume large, có split: split bị bỏ, việc vẫn giao agent đúng pick router chấm', () => {
    const json = big()
    const tasks = json['tasks'] as Json[]
    tasks[1] = task('Viết test cho tên hàm mới', 'agent', 'sonnet', 'high', { volume: 'large', depth: 'substantial', split: SPLIT })
    const parsed = routed(json)
    const second = parsed.tasks.find(t => t.index === 2) as Task
    expect(second.split).toBeUndefined()
    expect(second.run).toBe('agent')
    expect(second.agentType).toBe('general-purpose')
    expect(second.pick).toEqual({ family: 'sonnet', effort: 'high' })
    expect(parsed.notes.some(n => n.includes('split') && n.includes('2'))).toBe(true)
  })

  test('4. phân việc không đổi: cùng câu trả lời có và không có split thì run, loại agent, model, effort của mọi việc và luồng chính giống hệt', () => {
    const shape = (p: RouterPlan) => ({ main: p.main, tasks: p.tasks.map(t => ({ index: t.index, run: t.run, agentType: t.agentType, pick: t.pick, depth: t.depth, volume: t.volume, kind: t.kind })) })
    expect(shape(routed(big()))).toEqual(shape(routed(big(null))))
    expect(shape(routed(big()))).toEqual(shape(routed(big(), OPEN)))
  })

  test('5. chung file: hai phần cùng src/a.ts, hoặc src/ với src/a.ts, thì split bị bỏ; src/a với src/ab.ts không giao nhau', () => {
    const same = [{ title: 'Phần một', files: ['src/a.ts'] }, { title: 'Phần hai', files: ['src/b.ts', 'src/a.ts'] }]
    const nested = [{ title: 'Phần một', files: ['src/'] }, { title: 'Phần hai', files: ['src/a.ts'] }]
    const apart = [{ title: 'Phần một', files: ['src/a'] }, { title: 'Phần hai', files: ['src/ab.ts'] }]
    for (const split of [same, nested]) {
      const parsed = routed(big(split))
      expect(third(parsed).split).toBeUndefined()
      expect(parsed.notes.some(n => n.includes('split'))).toBe(true)
    }
    expect(third(routed(big(apart))).split?.length).toBe(2)
  })

  test('6. split chỉ có một phần: bị bỏ', () => {
    const parsed = routed(big([{ title: 'Một phần duy nhất', files: ['src/pay'] }]))
    expect(third(parsed).split).toBeUndefined()
    expect(parsed.notes.some(n => n.includes('split'))).toBe(true)
  })

  test('7. trần: maxForks 2 với 4 phần còn 2 phần, phần dư gộp vào phần cuối; maxForks 0 bỏ mọi split', () => {
    const four = [...SPLIT, { title: 'Module hóa đơn', files: ['src/bill'] }]
    const capped = third(routed(big(four), withForks(2))).split ?? []
    expect(capped.length).toBe(2)
    expect(capped[0]).toMatchObject({ part: 'a', title: 'Module thanh toán', files: ['src/pay'] })
    expect(capped[1]?.part).toBe('b')
    expect(capped[1]?.title).toContain('Module kho')
    expect(capped[1]?.title).toContain('Module báo cáo')
    expect(capped[1]?.title).toContain('Module hóa đơn')
    expect(capped[1]?.files).toEqual(['src/stock', 'src/report', 'src/bill'])
    expect(third(routed(big(four), withForks(0))).split).toBeUndefined()
  })

  test('17. split hỏng (chuỗi, phần thiếu title, files không phải mảng): parseRoute vẫn trả kế hoạch, việc giữ run, model, effort, notes có lý do', () => {
    const broken: unknown[] = [
      'src/pay, src/stock',
      [{ files: ['src/pay'] }, { title: 'Module kho', files: ['src/stock'] }],
      [{ title: 'Module thanh toán', files: 'src/pay' }, { title: 'Module kho', files: ['src/stock'] }],
    ]
    for (const split of broken) {
      const parsed = parseRoute(JSON.stringify(big(split)), withForks(3))
      expect(parsed).not.toBeNull()
      const t = third(parsed as RouterPlan)
      expect(t.split).toBeUndefined()
      expect(t.run).toBe('main')
      expect(t.pick).toEqual({ family: 'sonnet', effort: 'medium' })
      expect((parsed as RouterPlan).tasks.length).toBe(3)
      expect((parsed as RouterPlan).notes.some(n => n.includes('split'))).toBe(true)
    }
  })

  test('18. routerSystem khi bật forks dài thêm không quá 400 ký tự, nằm trong khối cache, có trường split; nhóm luật cũ giữ nguyên chữ', () => {
    const before = routerSystem()
    const system = routerRequest({ text: 'x', prev: null, ran: null, policy: withForks(3), model: 'sonnet' }).system ?? []
    expect(system.length).toBe(1)
    expect(system[0]?.cache).toBe(true)
    const after = system[0]?.text ?? ''
    expect(after.length).toBeGreaterThan(before.length)
    expect(after.length - before.length).toBeLessThanOrEqual(400)
    expect(after).toContain('"split"')
    for (const line of before.split('\n')) expect(after).toContain(line)
  })

  test('chủ mod 1. forks tắt: routerSystem giữ nguyên chữ như trước F1 (8826 ký tự, cùng mã băm)', async () => {
    const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')
    const text = routerSystem()
    expect(text.length).toBe(8826)
    expect(hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).toBe('713126c2a23389b3d457a3b36ab6f5000b758ada5fb631d2c0717a42e11ece0a')
    for (const policy of [OPEN, withForks(0)]) {
      expect(routerRequest({ text: 'x', prev: null, ran: null, policy, model: 'sonnet' }).system?.[0]?.text).toBe(text)
    }
    expect(routed(big(), OPEN).tasks.every(t => t.split === undefined)).toBe(true)
  })
})

describe('F1: không tách thì không đổi gì', () => {
  test('16. router không trả split nào: khối context giữ nguyên chữ như trước F1', { options: ON }, async ($, on) => {
    const { seen } = setup(on, $, () => big(null))
    await submit($, PROMPT)
    expect(seen.contexts.at(-1)).toEqual([
      [
        '[focus-conductor] Bản đọc prompt của router (đối chiếu lại với prompt gốc trước khi làm)',
        'Mục tiêu cuối: Đổi tên hàm tính phí trong ba module',
        'Phân việc (router đã chấm trước khi làm; khi giao, description của Agent mở đầu "Việc N: " với N là số thứ tự của việc; việc mang mã riêng như "BƯỚC 7" thì mở đầu bằng chính mã đó):',
        '1. Liệt kê chỗ gọi hàm tính phí → giao Explore haiku/low',
        '2. Viết test cho tên hàm mới → giao general-purpose sonnet/medium',
        '3. Đổi tên hàm tính phí trong ba module → làm trực tiếp ở luồng chính (sonnet/medium)',
        'Đánh giá: độ sâu substantial, khối lượng large, bản chất edit (việc vừa)',
        'Điều phối: luồng chính sonnet/medium; việc ghi "giao" chạy đúng model đã ghi; subagent ngoài danh sách được router chấm khi giao.',
        'Trước khi thực thi: xác nhận mục tiêu, rồi gọi mcp__focus-conductor__plan action "set" với checklist chuẩn hóa.',
      ].join('\n'),
    ])
  })
})

describe('F1: nhận diện, gom và dọn phiên con', () => {
  test('9. agent.spawn có fork, description "Việc 3a: ...": khớp phần 3a, router không được gọi, không có agent-floor, có dòng fork', { options: ON }, async ($, on) => {
    const { seen, lines } = setup(on, $)
    await started($, seen)
    await fork($, 'u1', D.a)
    expect(seen.agentRouted).toEqual([])
    expect(await textsOf($)).toContain('Việc 3a: Module thanh toán')
    await finish($, 'u1')
    expect(seen.agentRouted).toEqual([])
    expect(lines().some(l => l['kind'] === 'agent-floor')).toBe(false)
    expect(lines().some(l => l['kind'] === 'fork' && l['task'] === 3 && l['part'] === 'a' && l['result'] === 'done')).toBe(true)
  })

  test('10. ba phiên con của Việc 3 xong: kết quả tool kế tiếp có câu "Việc 3 đã đủ kết quả" đúng một lần, có fork-archive, pane thu thành một dòng', { options: ON }, async ($, on) => {
    const { seen, lines } = setup(on, $)
    await started($, seen)
    await fork($, 'u1', D.a)
    await fork($, 'u2', D.b)
    await fork($, 'u3', D.c)
    await finish($, 'u1')
    await finish($, 'u2')
    expect(noteOf(await readFile($), 'Việc 3 đã đủ kết quả')).toEqual([])
    expect(await textsOf($)).not.toContain('phiên con đã gom')
    await finish($, 'u3')
    const first = noteOf(await readFile($), 'Việc 3 đã đủ kết quả')
    expect(first.length).toBe(1)
    expect((first[0] ?? '').length).toBeLessThanOrEqual(200)
    expect(noteOf(await readFile($), 'Việc 3 đã đủ kết quả')).toEqual([])
    const archive = lines().filter(l => l['kind'] === 'fork-archive')
    expect(archive.length).toBe(1)
    expect(archive[0]).toMatchObject({ task: 3, parts: 3, results: { a: 'done', b: 'done', c: 'done' } })
    const pane = await textsOf($)
    expect(pane).toContain('Việc 3: 3 phiên con đã gom')
    expect(pane).not.toContain('Việc 3b: Module kho')
  })

  test('11. phiên con lỗi: Stop chặn, Việc 3 chưa tính là xong, phiên con lỗi chưa bị dọn', { options: ON }, async ($, on) => {
    const { seen } = setup(on, $)
    await started($, seen)
    await fork($, 'u1', D.a)
    await fork($, 'u2', D.b)
    await fork($, 'u3', D.c)
    await finish($, 'u1')
    await finish($, 'u2', 'error')
    await finish($, 'u3')
    expect(noteOf(await readFile($), 'đã đủ kết quả')).toEqual([])
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    const reason = await stop($)
    expect(reason).toContain('3b')
    expect(reason).toContain('phiên con')
    const pane = await textsOf($)
    expect(pane).not.toContain('phiên con đã gom')
    expect(pane).toContain('Việc 3b: Module kho')
  })

  test('12. phiên con sửa file ngoài files của phần: có cảnh báo phạm vi; sửa trong files thì không', { options: ON }, async ($, on) => {
    const { seen } = setup(on, $)
    await started($, seen)
    await fork($, 'u1', D.a)
    await edit($, 'src/pay/fee.ts', 'f-u1')
    expect(await textsOf($)).not.toContain('ngoài phạm vi')
    await edit($, 'src/stock/item.ts', 'f-u1')
    const pane = await textsOf($)
    expect(pane).toContain('src/stock/item.ts')
    expect(pane).toContain('ngoài phạm vi')
  })

  test('13. phiên con tự sửa rồi chạy bun test đạt: là bằng chứng cho phần nó sửa; luồng chính sửa thêm thì lần test đó không phủ', { options: ON }, async ($, on) => {
    const { seen, passing } = setup(on, $)
    passing.add('bun test')
    await started($, seen, ['Việc 3a: Module thanh toán', 'Việc 3b: Module kho'])
    await fork($, 'u1', D.a)
    await edit($, 'src/pay/fee.ts', 'f-u1')
    await bash($, 'bun test', 'f-u1')
    const own = await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: 'phiên con chạy bun test: 2 pass' })
    expect(String(own.result)).toContain('[v] 1.')
    await edit($, 'src/stock/item.ts')
    await fork($, 'u2', D.b)
    await edit($, 'src/stock/list.ts', 'f-u2')
    await bash($, 'bun test', 'f-u2')
    const other = await $.tool.call({ tool: PLAN, action: 'update', step: 2, status: 'verified', evidence: 'phiên con chạy bun test: 2 pass' })
    expect(String(other.result)).toContain('[x] 2.')
  })

  test('22. đếm: Việc 3 có 3 phần vẫn là một việc trên band; chi phí phiên con vào nhóm subagent, pane ghi nhãn phiên con', { options: ON }, async ($, on) => {
    const { seen } = setup(on, $)
    await submit($, PROMPT)
    await $.turn.start({ text: PROMPT, turnId: 't1' })
    await step($, seen, { turnId: 't1' })
    await fork($, 'u1', D.a)
    await fork($, 'u2', D.b)
    await fork($, 'u3', D.c)
    const band = await textsOf($, BAND)
    expect(band).toContain('3 bước dự kiến')
    await finish($, 'u1', 'answer', { ...BIG_USAGE, model: 'claude-sonnet-5-5' })
    const status = String(((await $.command.run({ command: 'conductor', args: 'status', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as never)) as { text?: string }).text ?? '')
    expect(status).toMatch(/subagent \$(?!0,00)[0-9,]+ trong 1 lượt/)
    const pane = await textsOf($)
    expect(pane).toContain('phiên con')
    expect(await textsOf($, BAND)).toContain('3 bước dự kiến')
  })
})

describe('F1: engine không có phiên con', () => {
  test('8. engine từ chối phiên con: dòng fork-off, các phần về luồng chính bằng một câu nêu Việc 3 và các phần, lần sau không còn khối tách', { options: ON }, async ($, on) => {
    const { seen, lines, state } = setup(on, $)
    await started($, seen)
    state.refuseAll = true
    const out = await fork($, 'u1', D.a)
    const back = noteOf(out, 'luồng chính')
    expect(back.length).toBe(1)
    expect((back[0] ?? '').length).toBeLessThanOrEqual(200)
    expect(back[0]).toContain('Việc 3')
    for (const code of ['3a', '3b', '3c']) expect(back[0]).toContain(code)
    expect(lines().filter(l => l['kind'] === 'fork-off').length).toBe(1)
    await submit($, 'Làm mục tiêu khác: đổi tên hàm tính thuế trong ba module')
    expect(blockOf(contextOf(seen))).toBeUndefined()
  })

  test('chủ mod 2. engine từ chối: fork-off đúng một lần, không còn split ở các lượt sau, Stop không chặn vì các phần đã chuyển về', { options: ON }, async ($, on) => {
    const { seen, lines, state } = setup(on, $)
    await started($, seen)
    state.refuseAll = true
    const outs = [await fork($, 'u1', D.a), await fork($, 'u2', D.b), await fork($, 'u3', D.c)]
    expect(outs.flatMap(out => noteOf(out, 'Engine không mở được phiên con')).length).toBe(1)
    expect(lines().filter(l => l['kind'] === 'fork-off').length).toBe(1)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    expect(await stop($)).toBe('')
    await submit($, 'Làm tiếp: đổi tên thêm ở module hóa đơn')
    expect(blockOf(contextOf(seen))).toBeUndefined()
    await submit($, 'Làm mục tiêu khác: đổi tên hàm tính thuế trong ba module')
    expect(blockOf(contextOf(seen))).toBeUndefined()
    expect(lines().filter(l => l['kind'] === 'fork-off').length).toBe(1)
  })

  test('chủ mod 3. phiên con đã chạy rồi lỗi vì lý do nghiệp vụ: không phải engine từ chối, Stop vẫn chặn', { options: ON }, async ($, on) => {
    const { seen, lines, modes } = setup(on, $)
    await started($, seen)
    modes.set('u2', 'fail')
    await fork($, 'u1', D.a)
    const out = await fork($, 'u2', D.b)
    expect(noteOf(out, 'Engine không mở được phiên con')).toEqual([])
    expect(lines().some(l => l['kind'] === 'fork-off')).toBe(false)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    const reason = await stop($)
    expect(reason).toContain('3b')
    expect(reason).toContain('phiên con')
  })
})

describe('F1: hạn mức, W4, strictDelegation, chen ngang', () => {
  test('14a. đang tạm dừng hạn mức: không có khối tách', { options: ON }, async ($, on) => {
    const { seen } = setup(on, $)
    quotaMeter(on, [week(99)])
    await submit($, PROMPT)
    expect(blockOf(contextOf(seen))).toBeUndefined()
  })

  test('14b. đã vào vùng báo hạn mức mềm: không có khối tách', { options: { ...ON, noticeWeekRemainingPct: 20 } }, async ($, on) => {
    const { seen } = setup(on, $)
    quotaMeter(on, [week(85)])
    await submit($, PROMPT)
    const context = contextOf(seen)
    expect(context).toContain('Đổi tên hàm tính phí trong ba module')
    expect(blockOf(context)).toBeUndefined()
  })

  test('19. W4 lượt 2: phiên con "Sửa lỗi kiểm: " không tính là lượt nâng, có câu dặn giao subagent; việc mới lúc này không có khối tách', { options: ON }, async ($, on) => {
    const later = plan({ relation: 'continue', goal: '', tasks: [task('Đổi tên hàm trong module hóa đơn và module thuế', 'main', 'sonnet', 'medium', { volume: 'large', depth: 'substantial', split: [{ title: 'Hóa đơn', files: ['src/bill'] }, { title: 'Thuế', files: ['src/tax'] }] })] })
    const { seen, lines } = setup(on, $, request => (request.startsWith('Đổi tên hàm tính phí') ? big() : later))
    await started($, seen)
    await edit($, 'src/pay/fee.ts')
    await bash($, 'bun test')
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    expect(await stop($)).toContain('2/3')
    const out = await fork($, 'u9', 'Sửa lỗi kiểm: hàm tính phí')
    const told = noteOf(out, 'general-purpose')
    expect(told.length).toBe(1)
    expect((told[0] ?? '').length).toBeLessThanOrEqual(200)
    expect(lines().some(l => l['kind'] === 'agent-floor')).toBe(false)
    await submit($, 'Làm thêm module hóa đơn và module thuế')
    const context = contextOf(seen)
    expect(context).toContain('Đổi tên hàm trong module hóa đơn và module thuế')
    expect(blockOf(context, 4)).toBeUndefined()
  })

  test('20. strictDelegation block: phiên con của Việc 3 đang chạy, luồng chính sửa file để gộp không bị từ chối', { options: { ...ON, strictDelegation: 'block' } }, async ($, on) => {
    const { seen, lines } = setup(on, $, () => lone())
    await submit($, PROMPT)
    await $.turn.start({ text: PROMPT, turnId: 't1' })
    await step($, seen, { turnId: 't1' })
    await fork($, 'u1', D.a)
    const merged = await edit($, 'src/pay/index.ts')
    expect(merged.deny).toBeUndefined()
    expect(String(merged.result ?? '')).not.toContain('chưa giao')
    await finish($, 'u1')
    expect(lines().some(l => l['kind'] === 'fork' && l['task'] === 3 && l['part'] === 'a')).toBe(true)
  })

  test('15. chen ngang thêm một việc lớn chia được: router xét split cho việc mới; việc đang có phiên con giữ nguyên', { options: ON }, async ($, on) => {
    const later = plan({ goal: 'Đổi định dạng hóa đơn', tasks: [task('Đổi định dạng hóa đơn bán và mua', 'main', 'sonnet', 'medium', { volume: 'large', depth: 'substantial', split: [{ title: 'Hóa đơn bán', files: ['src/sale'] }, { title: 'Hóa đơn mua', files: ['src/buy'] }] })] })
    const { seen, lines } = setup(on, $, request => (request.startsWith('Đổi tên hàm tính phí') ? big() : later))
    await started($, seen)
    await fork($, 'u1', D.a)
    await $.prompt.submit({ text: 'Đổi luôn định dạng hóa đơn bán và mua', wait: false, origin: { kind: 'composer' }, turnId: 't1' } as never)
    const block = blockOf(contextOf(seen), 4)
    expect(block).toBeDefined()
    expect(block).toContain('4a')
    expect(block).toContain('4b')
    await fork($, 'u2', D.b)
    await finish($, 'u1')
    await finish($, 'u2')
    expect(lines().some(l => l['kind'] === 'fork' && l['task'] === 3 && l['part'] === 'b' && l['result'] === 'done')).toBe(true)
  })

  test('23. chen ngang chuyển việc lớn sang subagent: split của việc đó bị bỏ, phiên con của nó không còn được theo dõi', { options: ON }, async ($, on) => {
    const later = plan({ goal: 'Đổi định dạng hóa đơn', tasks: [task('Đổi định dạng hóa đơn bán và mua', 'main', 'opus', 'high', { volume: 'large', depth: 'hard', split: [{ title: 'Hóa đơn bán', files: ['src/sale'] }, { title: 'Hóa đơn mua', files: ['src/buy'] }] })] })
    const { seen, lines } = setup(on, $, request => (request.startsWith('Đổi tên hàm tính phí') ? big() : later))
    await started($, seen)
    await $.prompt.submit({ text: 'Đổi luôn định dạng hóa đơn bán và mua', wait: false, origin: { kind: 'composer' }, turnId: 't1' } as never)
    expect(blockOf(contextOf(seen), 4)).toBeUndefined()
    await $.session.append({ message: { type: 'attachment', name: 'queued_command', content: [{ type: 'text', text: 'Đổi luôn định dạng hóa đơn' }] }, door: 'delivery', origin: { kind: 'composer' }, uuid: 'q1' } as never)
    await fork($, 'u4', 'Việc 4a: Hóa đơn bán')
    await finish($, 'u4')
    await fork($, 'u1', D.a)
    await finish($, 'u1')
    expect(lines().some(l => l['kind'] === 'fork' && l['task'] === 4)).toBe(false)
    expect(lines().some(l => l['kind'] === 'fork' && l['task'] === 3 && l['part'] === 'a')).toBe(true)
  })
})

describe('F1: khớp mã phần', () => {
  test('21. "Việc 3a" khớp Việc 3 phần a, "Việc 3b" phần b, "Việc 31" không khớp Việc 3; bước "Việc 3a: ..." phủ Việc 3', () => {
    const tasks = routed(big()).tasks
    expect(taskMatch(tasks, 'Việc 3a: Module thanh toán')).toMatchObject({ task: { index: 3 }, part: 'a' })
    expect(taskMatch(tasks, 'Việc 3b: Module kho')).toMatchObject({ task: { index: 3 }, part: 'b' })
    expect(taskMatch(tasks, 'Việc 31: việc khác').task?.index).not.toBe(3)
    expect(taskMatch(tasks, 'Việc 3d: phần không có').task).toBeUndefined()
    expect(taskMatch(tasks, 'Việc 3: cả việc')).toMatchObject({ task: { index: 3 } })
    expect(taskMatch(tasks, 'Việc 3: cả việc').part).toBeUndefined()
    expect(stepCovers(tasks, 'Việc 3a: Module thanh toán')?.index).toBe(3)
    const steps = [
      { id: 1, title: 'Việc 1: liệt kê', status: 'todo' as const },
      { id: 2, title: 'Việc 2: viết test', status: 'todo' as const },
      { id: 3, title: 'Việc 3a: Module thanh toán', status: 'todo' as const },
    ]
    expect(missingTasks(tasks, steps).map(t => t.index)).toEqual([])
  })
})
