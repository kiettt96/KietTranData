// 0.9.0 B10 (tích hợp): lệnh ghi ở trường check của một bước là lệnh kiểm của riêng bước đó. Lệnh của bước: chuỗi trong cặp backtick đầu
// tiên; không có thì phần trước " => "; không có cả hai thì cả chuỗi. Kết quả mong đợi (tùy chọn): phần sau " => ". Một lần chạy Bash là bằng
// chứng cho bước khi lệnh trùng lệnh của bước, chạy sau thay đổi không nhẹ cuối cùng và sau lần check được lưu hay đổi gần nhất, không lỗi,
// output không rỗng, không có dấu hiệu lỗi, output chứa kết quả mong đợi (khi có), lệnh không tự sửa file. Đủ thì bước done lên verified,
// chỉ đúng bước đó. Dựng lại H4 (hai bước, hai lệnh).

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { PANE, base, conductor, plan, spawnTool, submit } from '../support/engine'
import type { Json } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const GREP = `grep -c '"tong": 6' <(bash thong-ke.sh --json mau)`
const STEPS = [
  { title: 'Sửa thống kê', check: `\`${GREP}\` => 1` },
  { title: 'Chạy test', check: '`bun test`' },
]
const GOAL = (over: Json = {}) => plan({ goal: 'Sửa thống kê', depth: 'substantial', volume: 'medium', kind: 'edit', scope: ['src/thong-ke.sh'], ...over })
const LOG = '/tmp/fc-step-check-b10-090.jsonl'
type Out = { context?: string[]; result?: unknown }

function setup(on: On, outputs: Record<string, string>, reply: Json = GOAL()) {
  const seen = base(on, { router: request => (request.startsWith('Requirements:') ? { missing: [], extra: [], issues: [] } : reply), root: '/repo' })
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
  on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: `a-${e.tool_use_id}` }))
  on('tool.call', { tool: 'Bash' }, (_x, e) => ({ result: outputs[String((e as { command?: unknown }).command ?? '')] ?? '' }))
  on('turn.complete', () => ({ text: '' }))
  const writes: string[] = []
  on('fs.write', (_$, e) => {
    writes.push(e.text)
    return { value: undefined }
  })
  return { seen, lines: () => (writes.at(-1) ?? '').trim().split('\n').filter(Boolean).map(l => JSON.parse(l) as Record<string, unknown>) }
}
const show = async ($: Engine) => String((await $.tool.call({ tool: PLAN, action: 'show' })).result)
const edit = ($: Engine) => $.tool.call({ tool: 'Edit', file_path: '/repo/src/thong-ke.sh', old_string: 'a', new_string: 'b' } as never)
const bash = async ($: Engine, command: string, agentId?: string) => ((await $.tool.call({ tool: 'Bash', command, ...(agentId ? { agentId } : {}) } as never)) as Out)
const OFF = { options: { planApproval: 'off', decisionLog: LOG } }

async function start($: Engine) {
  await submit($, 'Sửa thống kê')
  await $.tool.call({ tool: PLAN, action: 'set', steps: STEPS } as never)
}

describe('0.9.0 B10: bằng chứng theo từng bước', () => {
  test('H4: lệnh của bước 1 chạy đạt sau thay đổi cuối: bước 1 lên verified, bước 2 giữ nguyên; không có câu "không xác định được file đích"', OFF, async ($, on) => {
    setup(on, { [GREP]: '1' })
    await start($)
    await edit($)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await $.tool.call({ tool: PLAN, action: 'update', step: 2, status: 'done' })
    const out = await bash($, GREP)
    expect((out.context ?? []).join('\n')).not.toContain('không xác định được file đích')
    const text = await show($)
    expect(text).toContain('[v] 1. Sửa thống kê')
    expect(text).toContain('[x] 2. Chạy test')
  })
  test('lần chạy đạt trước khi đóng bước, không có thay đổi sau đó: đóng bước thì lên verified ngay', OFF, async ($, on) => {
    setup(on, { [GREP]: '1' })
    await start($)
    await edit($)
    await bash($, GREP)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    expect(await show($)).toContain('[v] 1. Sửa thống kê')
  })
  test('lệnh chạy trước thay đổi cuối không tính', OFF, async ($, on) => {
    setup(on, { [GREP]: '1' })
    await start($)
    await bash($, GREP)
    await edit($)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    expect(await show($)).toContain('[x] 1. Sửa thống kê')
  })
  test('output rỗng không tính; kết quả mong đợi sai không tính', OFF, async ($, on) => {
    setup(on, { [GREP]: '2' })
    await start($)
    await edit($)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await bash($, GREP)
    expect(await show($)).toContain('[x] 1. Sửa thống kê')
  })
  test('output rỗng không tính', OFF, async ($, on) => {
    setup(on, { [GREP]: '' })
    await start($)
    await edit($)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await bash($, GREP)
    expect(await show($)).toContain('[x] 1. Sửa thống kê')
  })
  test('output rỗng không tính khi bước không có kết quả mong đợi', OFF, async ($, on) => {
    setup(on, { 'grep -c tong out.json': '' })
    await submit($, 'Sửa thống kê')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Đếm', check: '`grep -c tong out.json`' }] } as never)
    await edit($)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await bash($, 'grep -c tong out.json')
    expect(await show($)).toContain('[x] 1. Đếm')
  })
  test('lệnh của bước 1 không nâng bước 2', OFF, async ($, on) => {
    setup(on, { [GREP]: '1' })
    await start($)
    await edit($)
    await $.tool.call({ tool: PLAN, action: 'update', step: 2, status: 'done' })
    await bash($, GREP)
    expect(await show($)).toContain('[x] 2. Chạy test')
  })
  test('lệnh có --fix không tính', OFF, async ($, on) => {
    setup(on, { 'eslint --fix src': 'ok, 0 problems' })
    await submit($, 'Sửa thống kê')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Lint', check: '`eslint --fix src`' }] } as never)
    await edit($)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await bash($, 'eslint --fix src')
    expect(await show($)).toContain('[x] 1. Lint')
  })
  test('subagent chạy lệnh của bước cũng tính', OFF, async ($, on) => {
    setup(on, { [GREP]: '1' })
    await start($)
    await edit($)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await spawnTool($, 'k1', 'Kiểm thống kê', 'Chạy lệnh kiểm')
    await bash($, GREP, 'a-k1')
    expect(await show($)).toContain('[v] 1. Sửa thống kê')
  })
  test('sau khi nâng: ghi tệp tài liệu nhẹ giữ verified; sửa src thì hạ về done', OFF, async ($, on) => {
    setup(on, { [GREP]: '1' })
    on('tool.call', { tool: 'Write' }, () => ({ result: 'ok' }))
    await start($)
    await edit($)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await bash($, GREP)
    await $.tool.call({ tool: 'Write', file_path: '/repo/notes/TIEN-DO.md', content: 'x' } as never)
    expect(await show($)).toContain('[v] 1. Sửa thống kê')
    await edit($)
    expect(await show($)).toContain('[x] 1. Sửa thống kê')
  })
  test('lần chạy mới nhất của lệnh của bước lỗi: không nâng dù lần trước đạt', OFF, async ($, on) => {
    let n = 0
    setup(on, {})
    on('tool.call', { tool: 'Bash' }, () => ({ result: n++ === 0 ? '1' : 'FAIL: 2 lỗi', isError: n > 1 }) as never)
    await start($)
    await edit($)
    await bash($, GREP)
    await bash($, GREP)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    expect(await show($)).toContain('[x] 1. Sửa thống kê')
  })
  test('check viết bằng lời: như 0.8.9, không tự nâng', OFF, async ($, on) => {
    setup(on, { [GREP]: '1' })
    await submit($, 'Sửa thống kê')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa thống kê', check: 'tổng đúng bằng 6' }] } as never)
    await edit($)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await bash($, GREP)
    expect(await show($)).toContain('[x] 1. Sửa thống kê')
  })
})

describe('0.9.0 B10: đổi check sau khi kế hoạch đã duyệt', () => {
  const OTHER = 'grep -c tong out/thong-ke.json'
  test('ghi dòng check-changed; pane có dòng cần chú ý; bằng chứng cũ mất hiệu lực, lần chạy sau khi đổi thì tính', { options: { decisionLog: LOG } }, async ($, on) => {
    const { lines } = setup(on, { [GREP]: '1', [OTHER]: '1' }, GOAL())
    await start($)
    await conductor($, 'approve')
    await edit($)
    await bash($, OTHER)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa thống kê', check: `\`${OTHER}\` => 1` }, STEPS[1]] } as never)
    expect(lines().some(l => l['kind'] === 'check-changed')).toBe(true)
    const pane = (await (await $.ui.mount(PANE)).findAll({ type: 'Text' })).map(e => e.text ?? '').join('\n')
    expect(pane).toContain('đổi check')
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    expect(await show($)).toContain('[x] 1. Sửa thống kê')
    await bash($, OTHER)
    expect(await show($)).toContain('[v] 1. Sửa thống kê')
  })
  test('trước khi duyệt: đổi check không ghi check-changed', { options: { decisionLog: LOG } }, async ($, on) => {
    const { lines } = setup(on, { [GREP]: '1', [OTHER]: '1' }, GOAL())
    await start($)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa thống kê', check: `\`${OTHER}\`` }, STEPS[1]] } as never)
    expect(lines().some(l => l['kind'] === 'check-changed')).toBe(false)
  })
})

describe('0.9.0 B10: câu dặn dạng check', () => {
  test('kết quả plan set có dòng dạng check một lần mỗi mục tiêu; câu dặn lập kế hoạch có vế dạng check', {}, async ($, on) => {
    const { seen } = setup(on, {}, GOAL())
    await submit($, 'Sửa thống kê')
    const planning = (seen.contexts.at(-1) ?? []).find(c => c.includes('Việc lớn: lập kế hoạch')) ?? ''
    expect(planning).toContain('`lệnh` => kết quả mong đợi')
    const first = (await $.tool.call({ tool: PLAN, action: 'set', steps: STEPS } as never)) as Out
    const second = (await $.tool.call({ tool: PLAN, action: 'set', steps: STEPS } as never)) as Out
    const text = (out: Out) => [String(out.result ?? ''), ...(out.context ?? [])].join('\n')
    expect(text(first)).toContain('Check dạng `lệnh` => kết quả')
    expect(text(second)).not.toContain('Check dạng `lệnh` => kết quả')
  })
})
