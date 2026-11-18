// 0.9.0 C2 đổi cách làm (chỉ dẫn của chủ mod 18/11): mod không chứng minh lệnh shell của vai chỉ đọc là không ghi, mà đo thay đổi thật của
// các file đang được duyệt. Tập file: file không nhẹ đã đổi của mục tiêu, ngoài tệp trạng thái, nơi ghi phụ, thư mục tạm, thư mục phụ thuộc
// và sản phẩm build. Dấu: kích thước, thời điểm sửa, mã băm nội dung khi file không quá 256 KB. Chụp khi subagent không phải vai build được
// sinh và khi nó hoàn tất. Kết luận duyệt, sẵn sàng chỉ tính khi dấu không đổi trong lượt đó và sổ không ghi lần ghi definite nào của subagent
// vào file không nhẹ ngoài thư mục tạm; hết hiệu lực khi lúc cổng xét dấu khác lúc hoàn tất, hay sổ có lần sửa definite mới. Dòng kết luận
// theo mục 6. Engine không có fs: chạy theo sổ thay đổi.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { verdictOf } from '../../hooks/lib/verdict'
import { classifyBash } from '../../hooks/lib/drift/classify'
import { JS } from '../fixtures/runner-output'
import { PANE, base, plan, step, submit } from '../support/engine'
import type { Json, Seen } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const W = '/w/viec'
const GOAL = (over: Json = {}) => plan({ goal: 'Sửa luồng phí', scope: ['/repo/src'], sideWrites: [`${W}/backup/`], depth: 'substantial', volume: 'medium', kind: 'edit', main: { model: 'sonnet', effort: 'medium' }, ...over })
const OPTS = (over: Json = {}) => ({ options: { planApproval: 'off', checkCommands: 'bun test', ...over } })
const BLOCK = 'duyệt độc lập'
type Out = { deny?: string; context?: string[] }
type FakeFile = { text: string; mtimeMs: number }

/** Hệ tệp giả: đọc, stat theo bảng; thiếu thì ENOENT như engine thật. */
/** Số lần gọi fs.stat, fs.read vào các file dưới /repo/src (tập dấu của ca). */
const calls = { stat: 0, read: 0 }
function fakeFs(on: On, files: Map<string, FakeFile>): void {
  on('fs.stat', (_$, e) => {
    if (e.path.startsWith('/repo/src/')) calls.stat += 1
    const file = files.get(e.path)
    return (file !== undefined ? { value: { kind: 'file', size: file.text.length, mtimeMs: file.mtimeMs, isLink: false, ...(e.resolve ? { realPath: e.path } : {}) } } : { deny: `ENOENT: no such file or directory, stat '${e.path}'` }) as never
  })
  on('fs.read', (_$, e) => {
    if (String(e.path).startsWith('/repo/src/')) calls.read += 1
    const file = files.get(e.path)
    return (file !== undefined ? { value: file.text } : { deny: `ENOENT: no such file or directory, open '${e.path}'` }) as never
  })
}
let spawnModel = 'claude-opus-5-5'
function setup(on: On, files: Map<string, FakeFile> | null, reply: Json = GOAL()): Seen {
  const seen = base(on, { router: () => reply, root: '/repo' })
  if (files !== null) fakeFs(on, files)
  spawnModel = 'claude-opus-5-5'
  on('tool.call', { tool: /^(?:Edit|Write|Read|Agent|Skill)$/ }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: JS.bun_pass }))
  on('agent.spawn', (_$, e) => ({ model: spawnModel, agentId: `a-${String((e as { tool_use_id?: unknown }).tool_use_id)}` }) as never)
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  on('agent.offer', () => ({ isOffered: true }))
  return seen
}
const call = async ($: Engine, input: Record<string, unknown>) => (await $.tool.call(input as never)) as Out
const stop = async ($: Engine) => String(((await $.classic.Stop({ stop_hook_active: false } as never)) as { block?: string }).block ?? '')
let n = 0
/** Một subagent: sinh, các lời gọi, rồi `during` (đổi hệ tệp giả giữa lúc sinh và lúc hoàn tất), rồi hoàn tất. */
async function agent($: Engine, description: string, text: string, calls: ReadonlyArray<Record<string, unknown>> = [], during: () => void = () => {}, subagentType?: string, hasUsage = true) {
  const id = `pr${(n += 1)}`
  await $.tool.call({ tool: 'Agent', tool_use_id: id, description, prompt: 'Rà.', ...(subagentType !== undefined ? { subagent_type: subagentType } : {}) } as never)
  await $.agent.spawn({ prompt: 'Rà.', description, tool_use_id: id } as never)
  const outs: Out[] = []
  for (const input of calls) outs.push(await call($, { ...input, agentId: `a-${id}` }))
  during()
  await $.turn.complete({ turnId: `x-${id}`, agentId: `a-${id}`, answer: text, durationMs: 5, isAborted: false, reason: 'answer', ...(hasUsage ? { usage: { model: spawnModel, input_tokens: 10, output_tokens: 10 } } : {}) } as never)
  return outs
}
const SRC = '/repo/src/phi.ts'
async function start($: Engine, seen: Seen, files: Map<string, FakeFile> | null) {
  await $.agent.offer({ agent: 'general-purpose', description: 'việc chung', source: 'built-in', provider: { plugin: 'engine', tier: 'core' } } as never)
  await submit($, 'Sửa luồng phí')
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa phí' }] } as never)
  await $.turn.start({ text: 'Sửa luồng phí', turnId: 't1' })
  await step($, seen, { turnId: 't1' })
  await call($, { tool: 'Edit', file_path: SRC, old_string: 'a', new_string: 'b' })
  files?.set(SRC, { text: 'export const phi = 2\n', mtimeMs: 100 })
  await call($, { tool: 'Bash', command: 'bun test' })
}
const close = ($: Engine) => $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
const fresh = () => new Map<string, FakeFile>([[SRC, { text: 'export const phi = 1\n', mtimeMs: 50 }]])

describe('0.9.0 C2 dấu file: hiệu lực của kết luận', () => {
  test('người duyệt chạy lệnh bất kỳ (script, python -c, vòng lặp), dấu không đổi, trả ĐẠT: không bị từ chối, kết luận tính, cổng cho qua', OPTS(), async ($, on) => {
    const files = fresh()
    const seen = setup(on, files)
    await start($, seen, files)
    const outs = await agent($, 'Kiểm độc lập: phí', 'ĐẠT', [{ tool: 'Bash', command: 'bash scripts/thu.sh' }, { tool: 'Bash', command: 'python3 -c "print(1)"' }, { tool: 'Bash', command: 'for f in src/*.ts; do wc -l "$f"; done' }])
    expect(outs.map(o => o.deny)).toEqual([undefined, undefined, undefined])
    await close($)
    expect(await stop($)).toBe('')
  })
  test('dấu của một file trong tập đổi giữa lúc sinh và lúc hoàn tất (không qua lời gọi nào): không tính, cổng chặn, lý do có tên file', OPTS(), async ($, on) => {
    const files = fresh()
    const seen = setup(on, files)
    await start($, seen, files)
    await agent($, 'Kiểm độc lập: phí', 'ĐẠT', [], () => files.set(SRC, { text: 'export const phi = 3\n', mtimeMs: 200 }))
    await close($)
    const block = await stop($)
    expect(block).toContain(BLOCK)
    expect(block).toContain('phi.ts')
    expect(block.length).toBeLessThanOrEqual(600)
  })
  test('thời điểm sửa đổi mà nội dung không đổi: vẫn tính', OPTS(), async ($, on) => {
    const files = fresh()
    const seen = setup(on, files)
    await start($, seen, files)
    await agent($, 'Kiểm độc lập: phí', 'ĐẠT', [], () => files.set(SRC, { text: files.get(SRC)!.text, mtimeMs: 999 }))
    await close($)
    expect(await stop($)).toBe('')
  })
  test('sau lượt duyệt: ghi tiến độ, sao lưu, git commit, chạy lại khối khởi động thì còn hiệu lực; dấu của file trong tập đổi thì hết hiệu lực', OPTS(), async ($, on) => {
    const files = fresh()
    const seen = setup(on, files)
    await start($, seen, files)
    await agent($, 'Kiểm độc lập: phí', 'ĐẠT')
    await call($, { tool: 'Write', file_path: `${W}/TIEN-DO.md`, content: 'x' })
    await call($, { tool: 'Bash', command: `cp ${SRC} ${W}/backup/phi.ts && shasum -a 256 ${W}/backup/phi.ts > ${W}/backup/phi.sha256` })
    await call($, { tool: 'Bash', command: 'git add -A && git commit -m "M1"' })
    await call($, { tool: 'Bash', command: "bash <<'SH'\nnpm install\nbun test\nSH" })
    await close($)
    expect(await stop($)).toBe('')
    files.set(SRC, { text: 'export const phi = 9\n', mtimeMs: 300 })
    const block = await stop($)
    expect(block).toContain(BLOCK)
    expect(block).toContain('phi.ts')
  })
  test('file trong tập bị xóa sau lượt duyệt: hết hiệu lực', OPTS(), async ($, on) => {
    const files = fresh()
    const seen = setup(on, files)
    await start($, seen, files)
    await agent($, 'Kiểm độc lập: phí', 'ĐẠT')
    await close($)
    expect(await stop($)).toBe('')
    files.delete(SRC)
    expect(await stop($)).toContain(BLOCK)
  })
  test('engine giả không có fs: mod chạy theo sổ thay đổi, không văng lỗi; sửa src sau lượt duyệt thì hết hiệu lực', OPTS(), async ($, on) => {
    const seen = setup(on, null)
    await start($, seen, null)
    await agent($, 'Kiểm độc lập: phí', 'ĐẠT', [{ tool: 'Bash', command: 'bash scripts/thu.sh' }])
    await close($)
    expect(await stop($)).toBe('')
    await call($, { tool: 'Edit', file_path: SRC, old_string: 'b', new_string: 'c' })
    await call($, { tool: 'Bash', command: 'bun test' })
    expect(await stop($)).toContain(BLOCK)
  })
  test('subagent ghi definite vào src (lệnh không bị chặn vì engine giả cho qua sau khi mod để chạy): kết luận không tính', OPTS(), async ($, on) => {
    const files = fresh()
    const seen = setup(on, files)
    await start($, seen, files)
    // Vai không tiền tố (không bị từ chối): lần ghi definite vào src của chính subagent đó vào sổ.
    await agent($, 'Rà phí', 'ĐẠT', [{ tool: 'Bash', command: "sed -i 's/a/b/' /repo/src/phi.ts" }])
    // Lệnh kiểm chạy lại sau lần ghi để bước kiểm đạt: cổng chỉ còn thiếu duyệt.
    await call($, { tool: 'Bash', command: 'bun test' })
    await close($)
    const block = await stop($)
    expect(block).toContain(BLOCK)
    expect(block).not.toContain('chưa có lần kiểm đạt')
  })
})

describe('0.9.0 C2 dấu file: rào của vai chỉ đọc', () => {
  test('vai duyệt: Write vào dự án bị từ chối, vào thư mục tạm được phép; Bash ghi definite vào src bị từ chối; lệnh possible chạy được', OPTS(), async ($, on) => {
    const files = fresh()
    const seen = setup(on, files)
    await start($, seen, files)
    const outs = await agent($, 'Kiểm độc lập: phí', 'ĐẠT', [
      { tool: 'Write', file_path: '/repo/src/x.ts', content: 'x' },
      { tool: 'Write', file_path: '/tmp/ra-soat/probe.ts', content: 'x' },
      { tool: 'Bash', command: "sed -i 's/a/b/' src/phi.ts" },
      { tool: 'Bash', command: 'npx tsx scripts/probe.ts' },
    ])
    expect(outs[0]?.deny).toBeDefined()
    expect(outs[1]?.deny).toBeUndefined()
    expect(outs[2]?.deny).toBeDefined()
    expect(outs[3]?.deny).toBeUndefined()
  })
})

describe('0.9.0 C2 dấu file: dòng kết luận (mục 6)', () => {
  test('mở đầu bằng từ kết luận, phần còn lại rỗng hay chỉ nói lỗi nhẹ: giữ kết luận', () => {
    for (const text of ['ĐẠT', 'Kết luận: **ĐẠT**', 'Verdict: PASS.', 'đạt kèm lỗi nhẹ', 'Đạt, kèm lỗi nhẹ', 'ĐẠT (kèm lỗi nhẹ)', 'ĐẠT KÈM 2 LỖI NHẸ', 'PASS with minor issues', '- **ĐẠT** kèm 1 lỗi nhẹ']) expect(verdictOf(text)?.verdict, text).toBe('pass')
    expect(verdictOf('SẴN SÀNG kèm lỗi nhẹ')?.verdict).toBe('ready')
  })
  test('phần còn lại có "nhưng", "but" hay nhắc lỗi nặng, lớn, vừa, nghiêm trọng, major, critical: chưa đạt', () => {
    for (const text of ['ĐẠT, nhưng còn 2 lỗi', 'ĐẠT, còn 2 lỗi lớn', 'ĐẠT kèm 1 lỗi nặng', 'ĐẠT kèm lỗi vừa', 'PASS but tests flaky', 'PASS with 1 major issue', 'PASS, 1 critical', 'ĐẠT, lỗi nghiêm trọng ở phí']) expect(verdictOf(text)?.verdict, text).toBe('fail')
    expect(verdictOf('SẴN SÀNG nhưng thiếu rủi ro')?.verdict).toBe('not-ready')
  })
  test('cụm chưa đạt xét trước; dòng đầu tiên mở đầu bằng từ kết luận quyết; không có dòng nào thì chưa có kết luận', () => {
    expect(verdictOf('CHƯA ĐẠT kèm lỗi nhẹ')?.verdict).toBe('fail')
    // Bổ sung 18/11 (1): dòng kết luận mâu thuẫn cùng loại thì chưa đạt, bất kể dòng nào đứng trước.
    expect(verdictOf('Đã rà xong phần phí.\nĐẠT\nCHƯA ĐẠT')?.verdict).toBe('fail')
    expect(verdictOf('Đã rà xong, nhìn chung ổn.')).toBeNull()
    expect(verdictOf('ĐẠT HẾT 12/12')?.isCheckOnly).toBe(true)
  })
})

describe('0.9.0 C2 dấu file: hai lỗi bộ phân loại của vòng kiểm 2', () => {
  test('sort với cờ ngắn gộp có chữ o, hay --output: có tác động ghi', () => {
    for (const command of ['sort -uo src/a.ts src/a.ts', 'sort -nro out.txt a.txt', 'sort --output=out.txt a.txt']) expect(classifyBash(command, '/repo').effects.some(e => e.kind === 'write'), command).toBe(true)
    expect(classifyBash('sort -u a.txt', '/repo').effects.some(e => e.kind === 'write')).toBe(false)
  })
  test('sed với dấu phân cách khác / và cờ w: có tác động ghi', () => {
    for (const command of ["sed -n 's#a#b#w out.txt' a.ts", "sed 's|a|b|gw out.txt' a.ts"]) expect(classifyBash(command, '/repo').effects.some(e => e.kind === 'write'), command).toBe(true)
    expect(classifyBash("sed -n 's#a#b#p' a.ts", '/repo').effects.some(e => e.kind === 'write')).toBe(false)
  })
})

describe('0.9.0 C2 dấu file: kịch bản mục 7, biến thể probe trong thư mục tạm', () => {
  for (const conductor of ['off', 'opus'] as const) {
    test(`conductor ${conductor}: subagent kiểm độc lập cd vào thư mục tạm, cp -r mã nguồn, chạy probe bằng bun, node, bash, python; không lời gọi nào bị từ chối; "đạt kèm lỗi nhẹ" được tính; Stop không chặn`, OPTS({ conductor }), async ($, on) => {
      const files = fresh()
      const seen = setup(on, files, GOAL({ main: conductor === 'off' ? { model: 'sonnet', effort: 'medium' } : { model: 'opus', effort: 'high' } }))
      await $.agent.offer({ agent: 'general-purpose', description: 'việc chung', source: 'built-in', provider: { plugin: 'engine', tier: 'core' } } as never)
      await submit($, 'Sửa luồng phí')
      await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'M1: sửa phí', check: '`bun test`' }] } as never)
      await $.turn.start({ text: 'Sửa luồng phí', turnId: 't1' })
      await step($, seen, { turnId: 't1' })
      if (conductor === 'off') {
        await call($, { tool: 'Edit', file_path: SRC, old_string: 'a', new_string: 'b' })
        await call($, { tool: 'Bash', command: 'bun test' })
      } else {
        await agent($, 'Việc 1: sửa phí', 'Đã sửa src/phi.ts, bun test đạt.', [{ tool: 'Edit', file_path: SRC, old_string: 'a', new_string: 'b' }, { tool: 'Bash', command: 'bun test' }])
      }
      files.set(SRC, { text: 'export const phi = 2\n', mtimeMs: 100 })
      await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
      const outs = await agent($, 'Kiểm độc lập: phí', 'đạt kèm lỗi nhẹ\n- Nhỏ: tên biến', [
        { tool: 'Bash', command: 'mkdir -p /tmp/ra-soat && cd /tmp/ra-soat && cp -r /repo/src .' },
        { tool: 'Write', file_path: '/tmp/ra-soat/probe.ts', content: 'console.log(1)' },
        { tool: 'Bash', command: 'cd /tmp/ra-soat && bun probe.ts' },
        { tool: 'Bash', command: 'cd /tmp/ra-soat && node probe.js' },
        { tool: 'Bash', command: 'cd /tmp/ra-soat && bash probe.sh' },
        { tool: 'Bash', command: 'cd /tmp/ra-soat && python3 probe.py' },
      ])
      expect(outs.map(o => o.deny)).toEqual(outs.map(() => undefined))
      expect(await stop($)).toBe('')
    })
  }
})

describe('0.9.0 C2 dấu file, bổ sung 18/11', () => {
  test('(1) dòng kết luận mâu thuẫn cùng loại: chưa đạt, bất kể thứ tự; khác loại thì không lẫn', () => {
    expect(verdictOf('CHƯA ĐẠT\n- thiếu test\nĐẠT')?.verdict).toBe('fail')
    expect(verdictOf('ĐẠT\nCHƯA ĐẠT')?.verdict).toBe('fail')
    expect(verdictOf('SẴN SÀNG\nCHƯA SẴN SÀNG')?.verdict).toBe('not-ready')
  })
  test('(2) luật đóng của phần sau từ kết luận: READY WITH BLOCKERS chưa sẵn sàng; ĐẠT (12/12 mục) chưa có kết luận; ĐẠT KÈM 2 LỖI NHẸ đạt', () => {
    expect(verdictOf('READY WITH BLOCKERS')?.verdict).toBe('not-ready')
    expect(verdictOf('ĐẠT (12/12 mục)')).toBeNull()
    expect(verdictOf('ĐẠT KÈM 2 LỖI NHẸ')?.verdict).toBe('pass')
    for (const text of ['PASS with tests skipped', 'ĐẠT kèm ghi chú', 'ĐẠT, chặn ở bước 2', 'PASS, 1 blocker']) expect(verdictOf(text)?.verdict, text).toBe('fail')
    for (const text of ['ĐẠT phần A', 'PASS overall']) expect(verdictOf(text), text).toBeNull()
    // Theo đúng chữ của mục 2: "lớn" ở bất kỳ đâu sau từ kết luận là chưa đạt (chiều an toàn).
    expect(verdictOf('ĐẠT phần lớn')?.verdict).toBe('fail')
  })
  test('(2) câu trả lời chỉ có dòng kết luận không đứng riêng: cổng chặn, lý do nêu dòng kết luận phải đứng riêng và hỏi lại chính subagent đó', OPTS(), async ($, on) => {
    const files = fresh()
    const seen = setup(on, files)
    await start($, seen, files)
    await agent($, 'Kiểm độc lập: phí', 'ĐẠT (12/12 mục)')
    await close($)
    const block = await stop($)
    expect(block).toContain('dòng kết luận phải đứng riêng')
    expect(block).toContain('hỏi lại')
    expect(block.length).toBeLessThanOrEqual(600)
  })
  test('(3) sau lần cổng chặn vì dấu đổi, pane không còn hiện bước duyệt đã xong', OPTS(), async ($, on) => {
    const files = fresh()
    const seen = setup(on, files)
    await start($, seen, files)
    // Hoàn tất không kèm usage: pane của engine giả vỡ khi usage chỉ có số token (có từ 0.8.9, ghi ở việc tồn).
    await agent($, 'Kiểm độc lập: phí', 'ĐẠT', [], () => {}, undefined, false)
    await close($)
    expect(await stop($)).toBe('')
    const pane = await $.ui.mount(PANE)
    const before = (await pane.findAll({ type: 'Text' })).map(e => e.text ?? '').join('\n')
    expect(before).toContain('Duyệt: đạt')
    files.set(SRC, { text: 'export const phi = 9\n', mtimeMs: 300 })
    expect(await stop($)).toContain(BLOCK)
    const after = (await pane.findAll({ type: 'Text' })).map(e => e.text ?? '').join('\n')
    expect(after).not.toContain('Duyệt: đạt')
  })
  test('(4) subagent Explore chạy haiku: không gọi fs.stat, fs.read lần nào', OPTS(), async ($, on) => {
    const files = fresh()
    const seen = setup(on, files)
    await start($, seen, files)
    calls.stat = 0
    calls.read = 0
    spawnModel = 'claude-haiku-5-5'
    await agent($, 'Tìm chỗ gọi phí', 'Tìm thấy ở src/phi.ts:3', [], () => {}, 'Explore')
    expect(calls).toEqual({ stat: 0, read: 0 })
  })
  test('(4) chụp lần hai khi không file nào đổi: không gọi fs.read; mục tiêu chưa sửa file không nhẹ nào: không gọi fs', OPTS(), async ($, on) => {
    const files = fresh()
    const seen = setup(on, files)
    await start($, seen, files)
    calls.stat = 0
    calls.read = 0
    const id = 'pr-hai'
    await $.tool.call({ tool: 'Agent', tool_use_id: id, description: 'Kiểm độc lập: phí', prompt: 'Rà.' } as never)
    await $.agent.spawn({ prompt: 'Rà.', description: 'Kiểm độc lập: phí', tool_use_id: id } as never)
    const afterSpawn = calls.read
    await $.turn.complete({ turnId: 'x-hai', agentId: `a-${id}`, answer: 'ĐẠT', durationMs: 5, isAborted: false, reason: 'answer', usage: { model: spawnModel, input_tokens: 10, output_tokens: 10 } } as never)
    expect(afterSpawn).toBe(1)
    expect(calls.read).toBe(1)
  })
  test('(4) mục tiêu chưa có file không nhẹ nào được sửa: sinh subagent duyệt không gọi fs', OPTS(), async ($, on) => {
    const files = fresh()
    const seen = setup(on, files)
    await $.agent.offer({ agent: 'general-purpose', description: 'việc chung', source: 'built-in', provider: { plugin: 'engine', tier: 'core' } } as never)
    await submit($, 'Sửa luồng phí')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa phí' }] } as never)
    await $.turn.start({ text: 'Sửa luồng phí', turnId: 't1' })
    await step($, seen, { turnId: 't1' })
    calls.stat = 0
    calls.read = 0
    await agent($, 'Kiểm độc lập: phí', 'ĐẠT')
    expect(calls).toEqual({ stat: 0, read: 0 })
  })
})

describe('0.9.0 C2 dấu file: kích thước', () => {
  test('nội dung đổi kích thước mà thời điểm sửa giữ nguyên trong lượt duyệt: không tính', OPTS(), async ($, on) => {
    const files = fresh()
    const seen = setup(on, files)
    await start($, seen, files)
    await agent($, 'Kiểm độc lập: phí', 'ĐẠT', [], () => files.set(SRC, { text: 'export const phi = 2 // sửa\n', mtimeMs: 100 }))
    await close($)
    expect(await stop($)).toContain(BLOCK)
  })
})
