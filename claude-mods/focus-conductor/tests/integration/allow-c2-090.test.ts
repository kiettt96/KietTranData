// 0.9.0 C2: phần còn giữ sau khi đổi cách làm sang đo dấu file (18/11). Danh sách cho phép năm loại a tới e đã gỡ; các ca còn đây kiểm bộ
// phân loại (cổng duyệt kế hoạch và vai điều phối cũng dùng), formatter tự sửa, dòng kết luận, và rào còn lại của vai chỉ đọc.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { isReadOnlyCommand } from '../../hooks/lib/drift/readonly'
import { classifyBash } from '../../hooks/lib/drift/classify'
import { isSelfFixing } from '../../hooks/lib/drift/verify'
import { verdictOf } from '../../hooks/lib/verdict'
import { JS } from '../fixtures/runner-output'
import { base, plan, step, submit } from '../support/engine'
import type { Json, Seen } from '../support/engine'

describe('0.9.0 C2: tập cho phép của vai chỉ đọc', () => {
  test('mục 5: git grep với mọi chuỗi, git stash list, find -exec lệnh chỉ đọc: chạy được; find -exec rm thì không', () => {
    for (const command of ['git grep -n "git commit"', 'git stash list', 'find src -name "*.ts" -exec grep -l foo {} +']) expect(isReadOnlyCommand(command), command).toBe(true)
    expect(isReadOnlyCommand('find src -exec rm {} \\;')).toBe(false)
  })
  test('bộ phân loại: awk -i inplace có tác động ghi', () => {
    expect(classifyBash("awk -i inplace '{print}' src/a.ts").effects.some(e => e.kind === 'write')).toBe(true)
  })
  test('mục 6: formatter qua python -m, uv run, poetry run, deno fmt là tự sửa; kèm --check thì không', () => {
    for (const command of ['python3 -m black src', 'python -m isort .', 'uv run black src', 'poetry run isort .', 'deno fmt']) expect(isSelfFixing(command.split(/\s+/)), command).toBe(true)
    for (const command of ['python3 -m black --check src', 'uv run black --check src', 'deno fmt --check']) expect(isSelfFixing(command.split(/\s+/)), command).toBe(false)
  })
})

describe('0.9.0 C2: dòng kết luận', () => {
  test('"Kết luận: **ĐẠT**" và "Verdict: PASS." được nhận', () => {
    expect(verdictOf('Đã rà xong.\nKết luận: **ĐẠT**')?.verdict).toBe('pass')
    expect(verdictOf('Verdict: PASS.')?.verdict).toBe('pass')
  })
  // Đổi cách làm C2 (mục 6, 18/11): dòng mở đầu bằng từ kết luận là dòng kết luận; "nhưng" hay lỗi lớn sau đó là chưa đạt.
  test('"ĐẠT, nhưng còn 2 lỗi lớn" không là dòng kết luận', () => {
    expect(verdictOf('ĐẠT, nhưng còn 2 lỗi lớn')?.verdict).toBe('fail')
  })
  // Khôi phục theo bổ sung 18/11 (1): dòng đạt và dòng chưa đạt cùng loại thì chưa đạt.
  test('có cả dòng ĐẠT và dòng CHƯA ĐẠT đứng riêng: chưa đạt', () => {
    expect(verdictOf('ĐẠT\n- Phần A ổn\nCHƯA ĐẠT\n- Phần B thiếu test')?.verdict).toBe('fail')
  })
})

const PLAN = 'mcp__focus-conductor__plan'
const GOAL = (over: Json = {}) => plan({ goal: 'Sửa luồng phí', depth: 'substantial', volume: 'medium', kind: 'edit', main: { model: 'sonnet', effort: 'medium' }, ...over })
const OPTS = { options: { planApproval: 'off', checkCommands: 'bun test' } }
function setup(on: On): Seen {
  const seen = base(on, { router: () => GOAL() })
  on('tool.call', { tool: /^(?:Edit|Write|Read|Agent)$/ }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: JS.bun_pass }))
  on('agent.spawn', (_$, e) => ({ model: 'claude-opus-5-5', agentId: `a-${String((e as { tool_use_id?: unknown }).tool_use_id)}` }) as never)
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  on('agent.offer', () => ({ isOffered: true }))
  return seen
}
const stop = async ($: Engine) => String(((await $.classic.Stop({ stop_hook_active: false } as never)) as { block?: string }).block ?? '')
let n = 0
async function answer($: Engine, description: string, text: string, commands: readonly string[] = []) {
  const id = `al${(n += 1)}`
  await $.tool.call({ tool: 'Agent', tool_use_id: id, description, prompt: 'Rà.' } as never)
  await $.agent.spawn({ prompt: 'Rà.', description, tool_use_id: id } as never)
  const outs: Array<{ deny?: string }> = []
  for (const command of commands) outs.push((await $.tool.call({ tool: 'Bash', command, agentId: `a-${id}` } as never)) as { deny?: string })
  await $.turn.complete({ turnId: `x-${id}`, agentId: `a-${id}`, answer: text, durationMs: 5, isAborted: false, reason: 'answer', usage: { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 10 } } as never)
  return outs
}
async function start($: Engine, seen: Seen) {
  await $.agent.offer({ agent: 'general-purpose', description: 'việc chung', source: 'built-in', provider: { plugin: 'engine', tier: 'core' } } as never)
  await submit($, 'Sửa luồng phí')
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa phí' }] })
  await $.turn.start({ text: 'Sửa luồng phí', turnId: 't1' })
  await step($, seen, { turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: 'src/phi.ts', old_string: 'a', new_string: 'b' } as never)
  await $.tool.call({ tool: 'Bash', command: 'bun test' } as never)
}
const close = ($: Engine) => $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })

describe('0.9.0 C2: lời từ chối và kết luận', () => {
  test('vai duyệt chạy vòng for có sed -i: bị từ chối, lời từ chối không quá 200 ký tự, gợi ý Read, Grep và thư mục tạm', OPTS, async ($, on) => {
    const seen = setup(on)
    await start($, seen)
    // Đổi cách làm C2 sang đo dấu file (18/11): vòng for có sed -i "$f" là mức possible nên chạy được; sed -i vào src là definite nên bị từ chối.
    const outs = await answer($, 'Duyệt: phí', 'ĐẠT', ['for f in src/*.ts; do sed -i s/a/b/ "$f"; done', 'sed -i s/a/b/ src/phi.ts'])
    expect(outs[0]?.deny).toBeUndefined()
    const out = outs[1]
    expect(out?.deny ?? '').toContain('chỉ đọc')
    expect(out?.deny ?? '').toContain('thư mục tạm')
    expect((out?.deny ?? '').length).toBeLessThanOrEqual(200)
  })
  test('subagent không vai chỉ đọc và chạy probe trong thư mục tạm rồi trả "Kết luận: **ĐẠT**": tính, cổng cho qua', OPTS, async ($, on) => {
    const seen = setup(on)
    await start($, seen)
    await answer($, 'Rà phí', 'Đã rà.\nKết luận: **ĐẠT**', ['git diff', 'cp -r src /tmp/ra-soat', 'cd /tmp/ra-soat && bash probe.sh'])
    await close($)
    expect(await stop($)).toBe('')
  })
})
