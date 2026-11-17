// 0.9.0, vòng sửa 2 sau kiểm độc lập lần hai: lệnh ghi được xét theo từng đoạn và theo tên lệnh đầu đoạn (sau lệnh bọc), không theo từ khóa
// ở bất kỳ đâu. Đích ghi trong thư mục tạm không tính cho vai audit. "SẴN SÀNG", "READY" phải đứng riêng như "ĐẠT"; ký tự rộng 0 bị bỏ.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { roleDenial } from '../../hooks/parts/agents'
import { verdictOf } from '../../hooks/lib/verdict'
import { JS } from '../fixtures/runner-output'
import { base, plan, step, submit } from '../support/engine'
import type { Json, Seen } from '../support/engine'

const deny = (role: 'review' | 'audit', command: string) => roleDenial(role, 'Bash', { command }, role)

describe('0.9.0 vòng sửa 2: lệnh ghi lẩn', () => {
  for (const command of [
    'black --check src && black src',
    "bash -o pipefail -c 'rm src/a.ts'",
    "echo 'rm src/a.ts' | bash",
    'eval "rm src/a.ts"',
    'bash -c "echo \\"x\\" > src/a.ts"',
    'echo $(rm src/a.ts)',
    'xargs -I{} sed -i s/a/b/ {} < list.txt',
    "fish -c 'rm src/a.ts'",
    'cargo fmt',
    'go fmt ./...',
  ]) {
    test(`vai duyệt bị từ chối: ${command}`, () => {
      expect(deny('review', command)).not.toBeNull()
    })
  }
  for (const command of ['rg patch src', 'grep -rn black src', 'git log --grep isort', 'autopep8 src/a.py', 'cargo fmt --check', 'black --check src']) {
    test(`vai duyệt chạy được: ${command}`, () => {
      expect(deny('review', command)).toBeNull()
    })
  }
  for (const command of ['curl -o /tmp/x https://a', 'find /tmp/work -delete', "python3 -c \"open('/tmp/x','w').write('1')\"", 'perl -pi -e s/a/b/ /tmp/x.txt']) {
    test(`vai kiểm ghi thư mục tạm được: ${command}`, () => {
      expect(deny('audit', command)).toBeNull()
    })
  }
  for (const command of ['curl -o src/x https://a', 'find src -delete', "python3 -c \"open('src/x','w').write('1')\"", 'perl -pi -e s/a/b/ src/x.txt']) {
    test(`vai kiểm ghi ngoài thư mục tạm bị từ chối: ${command}`, () => {
      expect(deny('audit', command)).not.toBeNull()
    })
  }
})

describe('0.9.0 vòng sửa 2: từ kết luận', () => {
  test('SẴN SÀNG, READY theo sau là chữ: không là sẵn sàng', () => {
    for (const text of ['SẴN SÀNG nhưng còn rủi ro lớn', 'READY WITH BLOCKERS']) expect(verdictOf(text)?.verdict, text).not.toBe('ready')
    for (const text of ['SẴN SÀNG', 'READY.', '## Sẵn sàng\nPhương án A']) expect(verdictOf(text)?.verdict, text).toBe('ready')
  })
  test('ký tự rộng 0 giữa ĐẠT và HẾT: vẫn chỉ là kết luận kiểm', () => {
    expect(verdictOf('ĐẠT​ HẾT')?.isCheckOnly).toBe(true)
  })
})

const PLAN = 'mcp__focus-conductor__plan'
const GOAL = (over: Json = {}) => plan({ goal: 'Sửa luồng phí', depth: 'substantial', volume: 'medium', kind: 'edit', main: { model: 'sonnet', effort: 'medium' }, ...over })
const OPTS = { options: { planApproval: 'off', checkCommands: 'bun test' } }
function setup(on: On, reply: Json = GOAL()): Seen {
  const seen = base(on, { router: () => reply })
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
  const id = `h${(n += 1)}`
  await $.tool.call({ tool: 'Agent', tool_use_id: id, description, prompt: 'Rà.' } as never)
  await $.agent.spawn({ prompt: 'Rà.', description, tool_use_id: id } as never)
  for (const command of commands) await $.tool.call({ tool: 'Bash', command, agentId: `a-${id}` } as never)
  await $.turn.complete({ turnId: `x-${id}`, agentId: `a-${id}`, answer: text, durationMs: 5, isAborted: false, reason: 'answer', usage: { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 10 } } as never)
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

describe('0.9.0 vòng sửa 2: cổng đóng', () => {
  test('subagent không tiền tố chạy black --check src && black src rồi trả ĐẠT: không tính, cổng chặn', OPTS, async ($, on) => {
    const seen = setup(on)
    await start($, seen)
    await answer($, 'Rà phí', 'ĐẠT', ['black --check src && black src', 'bun test'])
    await close($)
    expect(await stop($)).toContain('duyệt độc lập')
  })
  test('hard: READY WITH BLOCKERS không là sẵn sàng, cổng chặn', OPTS, async ($, on) => {
    const seen = setup(on, GOAL({ depth: 'hard', main: { model: 'opus', effort: 'high' } }))
    await start($, seen)
    await answer($, 'Duyệt: phí', 'ĐẠT')
    await answer($, 'Đánh giá phát hành', 'READY WITH BLOCKERS')
    await close($)
    expect(await stop($)).toContain('SẴN SÀNG')
  })
})
