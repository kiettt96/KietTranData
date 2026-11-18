// 0.9.0 vòng sửa 1 sau kiểm độc lập của danh sách cho phép C2 (lỗi nặng 1 tới 4) và ca cho các mẫu đột biến còn sống của C2, B14.
// (1) Shell của subagent về thư mục gốc sau mỗi lời gọi Bash: cwd không mang từ lời gọi trước. (2) Trong cùng lệnh: shell con khôi phục cwd,
// `cd -`, cd sau `;` hay `||` là không xác định; đích tương đối có `..`, `-C /repo`, đường dẫn tuyệt đối, biến trong đoạn chạy ở thư mục tạm
// thì ra ngoài. (3) Bộ phân loại: sed w trong script, git diff/log --output, tree -o, uniq hai tệp, awk "lệnh" | getline là có ghi. (4) Probe
// ghi bằng heredoc có nháy vào thư mục tạm, Write vào thư mục tạm: được phép.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { classifyBash } from '../../hooks/lib/drift/classify'
import { isReadOnlyCommand } from '../../hooks/lib/drift/readonly'
import { JS } from '../fixtures/runner-output'
import { base, plan, step, submit } from '../support/engine'
import type { Json, Seen } from '../support/engine'
import { flatFs, quotaMeter, week } from '../support/quota'


describe('0.9.0 vòng sửa 1 của C2 (3): lệnh ghi bộ phân loại từng bỏ sót', () => {
  for (const command of ["sed -n 'w out.txt' a.ts", "sed 's/a/b/w out2.txt' a.ts", 'git diff --output=review.patch', 'git log -p --output=x.patch', 'tree -o tree.txt', 'uniq a.txt b.txt', 'awk \'BEGIN{"touch x"|getline}\'']) {
    // Đổi cách làm C2 sang đo dấu file (18/11): còn là lỗi của bộ phân loại (cổng duyệt kế hoạch, vai điều phối dùng); vai duyệt không xét.
    test(`có tác động ghi và bị từ chối ở vai duyệt: ${command}`, () => {
      expect(classifyBash(command, '/repo').effects.some(e => e.kind === 'write')).toBe(true)
    })
  }
  test('awk -i inplace không là lệnh chỉ đọc; sed -n 1,5p, uniq một tệp, tree, git diff vẫn chỉ đọc', () => {
    expect(isReadOnlyCommand("awk -i inplace '{print}' a.ts")).toBe(false)
    for (const command of ['sed -n 1,5p a.ts', 'uniq -c a.txt', 'tree src', 'git diff --stat']) expect(isReadOnlyCommand(command), command).toBe(true)
  })
})


const PLAN = 'mcp__focus-conductor__plan'
const W = '/w/viec'
const GOAL = (over: Json = {}) => plan({ goal: 'Sửa luồng phí', scope: ['/repo/src'], sideWrites: [`${W}/backup/`], depth: 'substantial', volume: 'medium', kind: 'edit', main: { model: 'sonnet', effort: 'medium' }, ...over })
const OPTS = (over: Json = {}) => ({ options: { planApproval: 'off', checkCommands: 'bun test', ...over } })
type Out = { deny?: string; context?: string[] }
function setup(on: On, reply: Json = GOAL()): Seen {
  const seen = base(on, { router: () => reply, root: '/repo' })
  on('tool.call', { tool: /^(?:Edit|Write|Read|Agent)$/ }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: JS.bun_pass }))
  on('agent.spawn', (_$, e) => ({ model: 'claude-opus-5-5', agentId: `a-${String((e as { tool_use_id?: unknown }).tool_use_id)}` }) as never)
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  on('agent.offer', () => ({ isOffered: true }))
  return seen
}
const call = async ($: Engine, input: Record<string, unknown>) => (await $.tool.call(input as never)) as Out
const stop = async ($: Engine) => String(((await $.classic.Stop({ stop_hook_active: false } as never)) as { block?: string }).block ?? '')
let n = 0
async function agent($: Engine, description: string, text: string, calls: ReadonlyArray<Record<string, unknown>>) {
  const id = `i4${(n += 1)}`
  await $.tool.call({ tool: 'Agent', tool_use_id: id, description, prompt: 'Rà.' } as never)
  await $.agent.spawn({ prompt: 'Rà.', description, tool_use_id: id } as never)
  const outs: Out[] = []
  for (const input of calls) outs.push(await call($, { ...input, agentId: `a-${id}` }))
  await $.turn.complete({ turnId: `x-${id}`, agentId: `a-${id}`, answer: text, durationMs: 5, isAborted: false, reason: 'answer', usage: { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 10 } } as never)
  return outs
}
async function start($: Engine, seen: Seen) {
  await $.agent.offer({ agent: 'general-purpose', description: 'việc chung', source: 'built-in', provider: { plugin: 'engine', tier: 'core' } } as never)
  await submit($, 'Sửa luồng phí')
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa phí' }] } as never)
  await $.turn.start({ text: 'Sửa luồng phí', turnId: 't1' })
  await step($, seen, { turnId: 't1' })
  await call($, { tool: 'Edit', file_path: '/repo/src/phi.ts', old_string: 'a', new_string: 'b' })
  await call($, { tool: 'Bash', command: 'bun test' })
}
const close = ($: Engine) => $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })

describe('0.9.0 vòng sửa 1 của C2 (1, 4): trong phiên', () => {
  // Đổi cách làm C2 sang đo dấu file (18/11): lời gọi bị từ chối không chạy nên không làm mất kết luận.
  test('lời gọi 1 cd vào thư mục tạm, lời gọi 2 sed -i src: lời gọi 2 bị từ chối; kết luận không tính, cổng chặn', OPTS(), async ($, on) => {
    const seen = setup(on)
    await start($, seen)
    const outs = await agent($, 'Duyệt: phí', 'ĐẠT', [{ tool: 'Bash', command: 'cd /tmp/ra-soat' }, { tool: 'Bash', command: "sed -i 's/a/b/' src/phi.ts" }])
    expect(outs[1]?.deny).toBeDefined()
    await close($)
    expect(await stop($)).toBe('')
  })
  test('vai duyệt dùng Write vào thư mục tạm cho probe rồi chạy ở đó, trả ĐẠT: không bị từ chối, kết luận tính, cổng cho qua', OPTS(), async ($, on) => {
    const seen = setup(on)
    await start($, seen)
    const outs = await agent($, 'Duyệt: phí', 'ĐẠT', [{ tool: 'Write', file_path: '/tmp/ra-soat/probe.ts', content: 'x' }, { tool: 'Bash', command: "cat > /tmp/ra-soat/p.sh <<'EOF'\necho `date`\nEOF" }, { tool: 'Bash', command: 'cd /tmp/ra-soat && bash p.sh' }])
    expect(outs.map(o => o.deny)).toEqual([undefined, undefined, undefined])
    await close($)
    expect(await stop($)).toBe('')
  })
})

describe('0.9.0 B14, đột biến còn sống', () => {
  test('(7) lệnh mức possible có đích là file src sau lượt duyệt: kết luận vẫn còn hiệu lực', OPTS(), async ($, on) => {
    const seen = setup(on)
    await start($, seen)
    await agent($, 'Rà phí', 'ĐẠT', [])
    await call($, { tool: 'Bash', command: "awk '{print > \"/repo/src/phi.ts\"}' /repo/src/x.ts" })
    await call($, { tool: 'Bash', command: 'bun test' })
    await close($)
    expect(await stop($)).toBe('')
  })
  test('(9) conductor opus: git checkout, git reset vẫn bị từ chối như sửa file', OPTS({ conductor: 'opus' }), async ($, on) => {
    const seen = setup(on, GOAL({ depth: 'hard', main: { model: 'opus', effort: 'high' } }))
    await $.agent.offer({ agent: 'general-purpose', description: 'việc chung', source: 'built-in', provider: { plugin: 'engine', tier: 'core' } } as never)
    await submit($, 'Sửa luồng phí')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa phí' }] } as never)
    for (const command of ['git checkout -- src/phi.ts', 'git reset --hard HEAD~1', 'git restore src/phi.ts']) expect((await call($, { tool: 'Bash', command })).deny, command).toBeDefined()
    expect((await call($, { tool: 'Bash', command: 'git commit -m "M1"' })).deny).toBeUndefined()
  })
  test('(8, 11) dừng cứng: ghi TIEN-DO.md tên mặc định khi prompt không khai tệp trạng thái vẫn được cho qua', { options: { planApproval: 'off' } }, async ($, on) => {
    const seen = base(on, { router: () => GOAL() })
    const meter = quotaMeter(on, [week(10)])
    flatFs(on)
    on('tool.call', { tool: /^(?:Write|Edit|Bash)$/ }, () => ({ result: 'ok' }))
    await submit($, 'Sửa luồng phí')
    meter.set([week(99)])
    await seen.clock.advance(60_000)
    expect((await call($, { tool: 'Write', file_path: '/w/khac/TIEN-DO.md', content: 'x' })).deny).toBeUndefined()
    expect((await call($, { tool: 'Write', file_path: '/repo/src/z.ts', content: 'x' })).deny).toBeDefined()
  })
})
