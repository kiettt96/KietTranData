// 0.9.0 C2 đổi đặc tả (chỉ dẫn của chủ mod): vai review, design, search dùng danh sách cho phép trên bộ phân loại lệnh sẵn có. Một lời gọi
// Bash được phép khi mọi đoạn thuộc một trong năm loại: (a) không có tác động ghi nào, kể cả possible; (b) lệnh kiểm mod nhận ra, không tự
// sửa file; (c) trùng danh tính lệnh ở check của một bước; (d) chỉ ghi vào thư mục tạm; (e) chạy khi thư mục làm việc của đoạn nằm trong thư
// mục tạm. Mã nội tuyến của trình thông dịch không chứng minh được. Kết luận của review, design chỉ tính khi subagent không có lời gọi nào
// ngoài tập đó, xét độc lập với việc từ chối. Dòng kết luận phải chỉ có đúng một từ kết luận.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { isReadOnlyAllowed } from '../../hooks/lib/team'
import { classifyBash } from '../../hooks/lib/drift/classify'
import { isSelfFixing } from '../../hooks/lib/drift/verify'
import { verdictOf } from '../../hooks/lib/verdict'
import { JS } from '../fixtures/runner-output'
import { base, plan, step, submit } from '../support/engine'
import type { Json, Seen } from '../support/engine'

const allowed = (command: string, cwd: string | null = '/repo', stepChecks: readonly string[] = []) => isReadOnlyAllowed(command, { cwd, stepChecks })

describe('0.9.0 C2: tập cho phép của vai chỉ đọc', () => {
  test('hai lỗi nặng của vòng kiểm 3 bị từ chối: vòng for có sed -i; heredoc vào python ghi src', () => {
    expect(allowed('for f in src/*.ts; do sed -i s/a/b/ "$f"; done')).toBe(false)
    expect(allowed("python3 - <<'EOF'\nopen('src/a.ts','w').write('x')\nEOF")).toBe(false)
  })
  test('mã nội tuyến của trình thông dịch không chứng minh được, kể cả khi chỉ đọc', () => {
    for (const command of ['python3 -c "print(1)"', "node -e 'console.log(1)'", "python3 - <<'EOF'\nprint(1)\nEOF", 'cat a.py | python3']) expect(allowed(command), command).toBe(false)
  })
  test('lệnh ở check là script riêng: chạy được; cùng script không có ở check thì bị từ chối', () => {
    expect(allowed('bash tests/kiem.sh', '/repo', ['bash tests/kiem.sh'])).toBe(true)
    expect(allowed('bash tests/kiem.sh', '/repo', [])).toBe(false)
  })
  test('probe chạy trong thư mục tạm được phép; cùng lệnh ở thư mục dự án bị từ chối', () => {
    expect(allowed('bash probe.sh', '/tmp/ra-soat')).toBe(true)
    expect(allowed('cd /tmp/ra-soat && bash probe.sh', '/repo')).toBe(true)
    expect(allowed('bash probe.sh', '/repo')).toBe(false)
    expect(allowed('bash probe.sh; cd /tmp/ra-soat', '/repo')).toBe(false)
    expect(allowed('bash probe.sh', null)).toBe(false)
  })
  test('chỉ ghi thư mục tạm, lệnh kiểm nhận ra, lệnh chỉ đọc: được phép; lệnh kiểm tự sửa thì không', () => {
    for (const command of ['cp -r src /tmp/ra-soat', 'bun test', 'rg patch src', 'git log --oneline', 'grep -rn x src > /tmp/kq.txt']) expect(allowed(command), command).toBe(true)
    for (const command of ['eslint --fix src', 'bun test && rm src/a.ts', 'git commit -am x']) expect(allowed(command), command).toBe(false)
  })
  test('mục 5: git grep với mọi chuỗi, git stash list, find -exec lệnh chỉ đọc: chạy được; find -exec rm thì không', () => {
    for (const command of ['git grep -n "git commit"', 'git stash list', 'find src -name "*.ts" -exec grep -l foo {} +']) expect(allowed(command), command).toBe(true)
    expect(allowed('find src -exec rm {} \\;')).toBe(false)
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
  test('"ĐẠT, nhưng còn 2 lỗi lớn" không là dòng kết luận', () => {
    expect(verdictOf('ĐẠT, nhưng còn 2 lỗi lớn')).toBeNull()
  })
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
    const [out] = await answer($, 'Duyệt: phí', 'ĐẠT', ['for f in src/*.ts; do sed -i s/a/b/ "$f"; done'])
    expect(out?.deny ?? '').toContain('chỉ đọc')
    expect(out?.deny ?? '').toContain('Grep')
    expect(out?.deny ?? '').toContain('thư mục tạm')
    expect((out?.deny ?? '').length).toBeLessThanOrEqual(200)
  })
  test('subagent không vai có một lời gọi ngoài tập (không bị từ chối) rồi trả ĐẠT: kết luận không tính, cổng chặn', OPTS, async ($, on) => {
    const seen = setup(on)
    await start($, seen)
    const outs = await answer($, 'Rà phí', 'ĐẠT', ['bash scripts/thu.sh'])
    expect(outs[0]?.deny).toBeUndefined()
    await close($)
    expect(await stop($)).toContain('duyệt độc lập')
  })
  test('subagent không vai chỉ đọc và chạy probe trong thư mục tạm rồi trả "Kết luận: **ĐẠT**": tính, cổng cho qua', OPTS, async ($, on) => {
    const seen = setup(on)
    await start($, seen)
    await answer($, 'Rà phí', 'Đã rà.\nKết luận: **ĐẠT**', ['git diff', 'cp -r src /tmp/ra-soat', 'cd /tmp/ra-soat && bash probe.sh'])
    await close($)
    expect(await stop($)).toBe('')
  })
})
