// 0.9.0 C, D (tích hợp, thay C3 của router): đội hình do mod áp. Bật khi closingReview là auto, mục tiêu edit hay mixed, và router chấm
// substantial hay hard, hoặc đã có từ 3 file không nhẹ khác nhau được sửa (không tính tệp trạng thái, nơi ghi phụ, tài liệu). Khi bật lần đầu
// mod chèn một lần đoạn dặn bước đóng (không quá 300 ký tự): "Kiểm: " chỉ khi có lệnh kiểm, rồi "Duyệt: ", việc hard thêm "Sẵn sàng: ", và
// các từ kết luận; pane hiện các bước đóng. Kết luận nhận theo câu trả lời (D): subagent không ghi file ngoài thư mục tạm, xong sau thay đổi
// không nhẹ cuối, có dòng kết luận ở đầu; tiền tố không bắt buộc. Chưa bật thì không chèn gì.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { JS } from '../fixtures/runner-output'
import { CLOSING_NOTE_CHARS, TEAM_FILES } from '../../hooks/lib/team'
import { PANE, base, plan, step, submit } from '../support/engine'
import type { Json, Seen } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const GOAL = (over: Json = {}) => plan({ goal: 'Sửa luồng phí', depth: 'substantial', volume: 'medium', kind: 'edit', main: { model: 'sonnet', effort: 'medium' }, ...over })
const LIGHT = (over: Json = {}) => GOAL({ depth: 'light', volume: 'small', ...over })
const OPTS = (over: Json = {}) => ({ options: { planApproval: 'off', checkCommands: 'bun test', ...over } })
const BLOCK = 'duyệt độc lập'
const NOTE = '[focus-conductor] Trước khi kết thúc, theo thứ tự:'
type Out = { context?: string[]; result?: unknown }

function setup(on: On, reply: Json = GOAL()): Seen {
  const seen = base(on, { router: () => reply })
  on('tool.call', { tool: /^(?:Edit|Write|Read)$/ }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: JS.bun_pass }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: 'ok' }))
  on('agent.spawn', (_$, e) => ({ model: 'claude-opus-5-5', agentId: `a-${String((e as { tool_use_id?: unknown }).tool_use_id)}` }) as never)
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  on('agent.offer', () => ({ isOffered: true }))
  return seen
}
const contexts = (seen: Seen, outs: Out[]) => [...seen.contexts.flat(), ...outs.flatMap(o => o.context ?? [])]
const stop = async ($: Engine) => String(((await $.classic.Stop({ stop_hook_active: false } as never)) as { block?: string }).block ?? '')
const edit = async ($: Engine, path = 'src/phi.ts') => (await $.tool.call({ tool: 'Edit', file_path: path, old_string: 'a', new_string: 'b' } as never)) as Out
const check = ($: Engine) => $.tool.call({ tool: 'Bash', command: 'bun test' } as never) as Promise<Out>
let n = 0
async function answer($: Engine, description: string, text: string, writes: readonly string[] = []) {
  const id = `m${(n += 1)}`
  await $.tool.call({ tool: 'Agent', tool_use_id: id, description, prompt: 'Rà.' } as never)
  await $.agent.spawn({ prompt: 'Rà.', description, tool_use_id: id } as never)
  for (const path of writes) await $.tool.call({ tool: 'Edit', file_path: path, old_string: 'a', new_string: 'b', agentId: `a-${id}` } as never)
  // Subagent đã ghi rồi chạy lệnh kiểm: kết luận đứng sau lần ghi của chính nó, chỉ việc theo dõi lần ghi (D1) loại được.
  if (writes.length > 0) await $.tool.call({ tool: 'Bash', command: 'bun test', agentId: `a-${id}` } as never)
  await $.turn.complete({ turnId: `x-${id}`, agentId: `a-${id}`, answer: text, durationMs: 5, isAborted: false, reason: 'answer' } as never)
}
const offer = ($: Engine) => $.agent.offer({ agent: 'general-purpose', description: 'việc chung', source: 'built-in', provider: { plugin: 'engine', tier: 'core' } } as never)
async function start($: Engine, seen: Seen) {
  await offer($)
  await submit($, 'Sửa luồng phí')
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa phí' }] })
  await $.turn.start({ text: 'Sửa luồng phí', turnId: 't1' })
  await step($, seen, { turnId: 't1' })
}
const close = ($: Engine) => $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
const notes = (texts: readonly string[]) => texts.filter(t => t.startsWith(NOTE))

describe('0.9.0 C: điều kiện bật đội hình', () => {
  test('light sửa 1 file: không có đoạn dặn, không có Core.team, không bị chặn', OPTS(), async ($, on) => {
    const seen = setup(on, LIGHT())
    await start($, seen)
    const outs = [await edit($), await check($)]
    await close($)
    expect(notes(contexts(seen, outs))).toEqual([])
    expect(await stop($)).not.toContain(BLOCK)
  })
  test(`light sửa ${TEAM_FILES} file không nhẹ: bật ở file thứ ba (đoạn dặn một lần), thiếu duyệt bị chặn một lần`, OPTS(), async ($, on) => {
    const seen = setup(on, LIGHT())
    await start($, seen)
    const outs = [await edit($, 'src/a.ts'), await edit($, 'src/b.ts')]
    expect(notes(contexts(seen, outs))).toEqual([])
    outs.push(await edit($, 'src/c.ts'), await edit($, 'src/d.ts'), await check($))
    const shown = notes(contexts(seen, outs))
    expect(shown.length).toBe(1)
    expect(shown[0]).toContain('lệnh kiểm')
    expect(shown[0]).toContain('"Duyệt: ')
    await close($)
    expect(await stop($)).toContain(BLOCK)
    expect(await stop($)).not.toContain(BLOCK)
  })
  test(`light sửa ${TEAM_FILES} tệp tài liệu: không bật`, OPTS(), async ($, on) => {
    const seen = setup(on, LIGHT())
    await start($, seen)
    const outs = [await edit($, 'docs/a.md'), await edit($, 'docs/b.md'), await edit($, 'README.md')]
    await close($)
    expect(notes(contexts(seen, outs))).toEqual([])
    expect(await stop($)).not.toContain(BLOCK)
  })
  test('substantial có lệnh kiểm: đoạn dặn ở context của mục tiêu, có lệnh kiểm rồi "Duyệt: ", không quá 300 ký tự; pane hiện bước đóng', OPTS(), async ($, on) => {
    const seen = setup(on)
    await start($, seen)
    const shown = notes(contexts(seen, []))
    expect(shown.length).toBe(1)
    expect(shown[0]!.indexOf('lệnh kiểm')).toBeLessThan(shown[0]!.indexOf('"Duyệt: '))
    expect(shown[0]).toContain('ĐẠT hay CHƯA ĐẠT')
    expect(shown[0]!.length).toBeLessThanOrEqual(CLOSING_NOTE_CHARS)
    expect(shown[0]).not.toContain('Sẵn sàng')
    const pane = (await (await $.ui.mount(PANE)).findAll({ type: 'Text' })).map(e => e.text ?? '').join('\n')
    expect(pane).toContain('Bước đóng (mod)')
    expect(pane).toContain('Kiểm: ')
    expect(pane).toContain('Duyệt: chờ')
  })
  test('substantial không có lệnh kiểm: đoạn dặn không có bước kiểm; cổng không đòi lần kiểm', OPTS({ checkCommands: '' }), async ($, on) => {
    const seen = setup(on)
    await start($, seen)
    expect(notes(contexts(seen, []))[0]).not.toContain('lệnh kiểm')
    await edit($)
    await answer($, 'Kiểm độc lập: thay đổi phí', 'ĐẠT')
    await close($)
    expect(await stop($)).toBe('')
  })
  test('mục tiêu chỉ sửa tài liệu: lời giao duyệt gồm đối chiếu số liệu, mẫu, chính tả', OPTS(), async ($, on) => {
    const seen = setup(on, GOAL({ scope: ['docs/bao-cao.md'] }))
    await start($, seen)
    expect(notes(contexts(seen, []))[0]).toContain('đối chiếu số liệu, mẫu, chính tả')
  })
  test('hard: đoạn dặn có "Sẵn sàng: " và từ kết luận SẴN SÀNG; duyệt đạt mà chưa sẵn sàng thì cổng chặn', OPTS(), async ($, on) => {
    const seen = setup(on, GOAL({ depth: 'hard', main: { model: 'opus', effort: 'high' } }))
    await start($, seen)
    const note = notes(contexts(seen, []))[0] ?? ''
    expect(note).toContain('"Sẵn sàng: ')
    expect(note).toContain('SẴN SÀNG hay CHƯA SẴN SÀNG')
    await edit($)
    await check($)
    await answer($, 'Duyệt: phí', 'ĐẠT')
    await close($)
    expect(await stop($)).toContain('SẴN SÀNG')
  })
  test('closingReview off: không đoạn dặn, không chặn', OPTS({ closingReview: 'off' }), async ($, on) => {
    const seen = setup(on)
    await start($, seen)
    const outs = [await edit($), await check($)]
    await close($)
    expect(notes(contexts(seen, outs))).toEqual([])
    expect(await stop($)).not.toContain(BLOCK)
  })
})

describe('0.9.0 D: nhận lượt duyệt theo kết quả', () => {
  test('subagent không tiền tố, không ghi file, trả "đạt kèm lỗi nhẹ": cổng cho qua; pane ghi Duyệt: đạt', OPTS(), async ($, on) => {
    const seen = setup(on)
    await start($, seen)
    await edit($)
    await check($)
    // Đổi đặc tả (vòng sửa 1 sau kiểm độc lập của dấu file, 18/11): general-purpose không tiền tố trên mục tiêu sửa mã là vai build, không
    // được chụp dấu lúc sinh nên kết luận không được tính; lượt duyệt mang tiền tố "Kiểm độc lập: " thì được tính.
    await answer($, 'Rà lại thay đổi phí', 'đạt kèm lỗi nhẹ\n- Nhỏ: tên biến')
    await close($)
    expect(await stop($)).toContain(BLOCK)
    await answer($, 'Kiểm độc lập: thay đổi phí', 'đạt kèm lỗi nhẹ\n- Nhỏ: tên biến')
    expect(await stop($)).not.toContain(BLOCK)
    const pane = (await (await $.ui.mount(PANE)).findAll({ type: 'Text' })).map(e => e.text ?? '').join('\n')
    expect(pane).toContain('Duyệt: đạt')
  })
  test('subagent có ghi file trả "ĐẠT": không tính, cổng vẫn chặn vì thiếu duyệt', OPTS(), async ($, on) => {
    const seen = setup(on)
    await start($, seen)
    await edit($)
    await check($)
    await answer($, 'Rà và sửa phí', 'ĐẠT', ['src/phu.ts'])
    await check($)
    await close($)
    expect(await stop($)).toContain(BLOCK)
  })
  test('"không đạt" đi vào vòng sửa: câu dặn vòng 1', OPTS(), async ($, on) => {
    const seen = setup(on)
    await start($, seen)
    await edit($)
    await answer($, 'Kiểm độc lập: phí', 'Không đạt\n- Lớn: thiếu test phí âm')
    const out = (await $.tool.call({ tool: 'Read', file_path: 'src/phi.ts' } as never)) as Out
    expect((out.context ?? []).join('\n')).toContain('vòng 1/3')
  })
  test('conductor off vẫn nhận kết luận', OPTS({ conductor: 'off' }), async ($, on) => {
    const seen = setup(on)
    await start($, seen)
    await edit($)
    await check($)
    await answer($, 'Kiểm độc lập: phí', 'PASS')
    await close($)
    expect(await stop($)).not.toContain(BLOCK)
  })
  test('subagent chạy script kiểm trong thư mục tạm (bash -c, vòng lặp) và ghi nháp vào /tmp, trả ĐẠT: kết luận được tính, cổng cho qua', OPTS(), async ($, on) => {
    const seen = setup(on)
    await start($, seen)
    await edit($)
    await check($)
    const id = `m${(n += 1)}`
    await $.tool.call({ tool: 'Agent', tool_use_id: id, description: 'Kiểm độc lập: phí', prompt: 'Rà.' } as never)
    await $.agent.spawn({ prompt: 'Rà.', description: 'Kiểm độc lập: phí', tool_use_id: id } as never)
    await $.tool.call({ tool: 'Bash', command: "mkdir -p /tmp/ra-soat && cp -r src /tmp/ra-soat/", agentId: `a-${id}` } as never)
    await $.tool.call({ tool: 'Bash', command: "cd /tmp/ra-soat && bash -c 'source src/phi.sh; tinh_phi 3'", agentId: `a-${id}` } as never)
    await $.tool.call({ tool: 'Bash', command: 'cd /tmp/ra-soat && for c in a b; do out=$($c 2>&1); echo $out; done', agentId: `a-${id}` } as never)
    await $.tool.call({ tool: 'Write', file_path: '/tmp/thu-phi.sh', content: 'x', agentId: `a-${id}` } as never)
    await $.turn.complete({ turnId: `x-${id}`, agentId: `a-${id}`, answer: 'ĐẠT\nKhông lỗi.', durationMs: 5, isAborted: false, reason: 'answer' } as never)
    await close($)
    expect(await stop($)).toBe('')
  })
})
