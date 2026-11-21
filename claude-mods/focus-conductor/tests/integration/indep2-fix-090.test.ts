// 0.9.0, vòng sửa 1 sau kiểm độc lập lần hai: (1) cổng chặn lại khi bước duyệt đổi từ chờ sang chưa đạt; (2) "ĐẠT HẾT" với khoảng trắng khác
// vẫn chỉ là kết luận kiểm; (3) chỉ "ĐẠT", "PASS", "đạt kèm lỗi nhẹ" là đạt, "ĐẠT KÈM LỖI LỚN" hay "ĐẠT nhưng ..." không phải; (4) git commit
// của subagent làm kết luận mất sạch; (5) lệnh ghi lẩn trong bash -c, sh -c, nice, và các biến thể của trình thông dịch, formatter tính là ghi;
// (6) đoạn lệnh của bước qua pipe không pipefail không là bằng chứng; (7) model chạy không đọc được không tính là từ sonnet.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { roleDenial } from '../../hooks/parts/agents'
import { stepEvidence, stepRunOf } from '../../hooks/lib/drift/stepcheck'
import { verdictOf } from '../../hooks/lib/verdict'
import { JS } from '../fixtures/runner-output'
import { base, plan, step, submit } from '../support/engine'
import type { Json, Seen } from '../support/engine'

describe('0.9.0 vòng sửa 1 (2, 3): từ kết luận', () => {
  test('ĐẠT HẾT với hai dấu cách, tab, dấu cách không ngắt: chỉ là kết luận kiểm', () => {
    for (const text of ['ĐẠT  HẾT', 'ĐẠT\tHẾT', 'ĐẠT HẾT 3/3', 'ALL  PASS']) expect(verdictOf(text)?.isCheckOnly, text).toBe(true)
  })
  test('ĐẠT KÈM LỖI LỚN, PASS WITH MAJOR ISSUES, ĐẠT nhưng ...: không là kết luận đạt', () => {
    // Luật đọc kết luận sau phiên thật D4: "ĐẠT nhưng ..." chỉ là chưa đạt khi đi với mức lỗi cao.
    for (const text of ['ĐẠT KÈM LỖI LỚN', 'PASS WITH MAJOR ISSUES', 'ĐẠT nhưng còn thiếu test chặn phát hành']) expect(verdictOf(text)?.verdict, text).not.toBe('pass')
  })
  test('ĐẠT, ĐẠT., **Đạt**, PASS 3/3, đạt kèm lỗi nhẹ: vẫn là đạt', () => {
    for (const text of ['ĐẠT', 'ĐẠT.', '**Đạt**', 'PASS 3/3', 'đạt kèm lỗi nhẹ', 'ĐẠT\nKhông lỗi']) expect(verdictOf(text)?.verdict, text).toBe('pass')
  })
})

describe('0.9.0 vòng sửa 1 (5): lệnh ghi lẩn', () => {
  for (const command of ["bash -c 'echo x > src/a.ts'", 'sh -c "sed -i s/a/b/ src/a.ts"', 'nice rm src/a.ts', "python3 -I -c \"open('a','w')\"", "node --no-warnings -e \"require('fs').writeFileSync('a','1')\"", 'awk -i inplace \'{print}\' src/a.ts', 'gofmt -w .', 'black src', 'clang-format -i src/a.c']) {
    // Đổi cách làm C2 sang đo dấu file (18/11): lệnh ghi lẩn mức possible chỉ còn bị từ chối ở vai audit.
    test(`vai duyệt bị từ chối: ${command}`, () => {
      expect(roleDenial('audit', 'Bash', { command }, 'kiểm')).not.toBeNull()
    })
  }
  for (const command of ["bash -c 'source src/a.sh; f 1'", 'black --check src', 'nice bun test', "sh -c 'bun test'"]) {
    test(`vẫn chạy được (vai kiểm; đổi đặc tả C2: vai duyệt chỉ chạy lệnh trong danh sách cho phép): ${command}`, () => {
      expect(roleDenial('audit', 'Bash', { command }, 'kiểm')).toBeNull()
    })
  }
})

describe('0.9.0 vòng sửa 1 (6): bằng chứng qua pipe', () => {
  test('bun test | tail -5 không pipefail: không là bằng chứng; có set -o pipefail thì là', () => {
    expect(stepEvidence({ check: '`bun test`' }, [stepRunOf('bun test | tail -5', false, '12 pass', 5)], 1, 0)).toBeNull()
    expect(stepEvidence({ check: '`bun test`' }, [stepRunOf('set -o pipefail; bun test | tail -5', false, '12 pass', 5)], 1, 0)).not.toBeNull()
  })
})

const PLAN = 'mcp__focus-conductor__plan'
const GOAL = plan({ goal: 'Sửa luồng phí', depth: 'substantial', volume: 'medium', kind: 'edit', main: { model: 'sonnet', effort: 'medium' } })
const OPTS = { options: { planApproval: 'off', checkCommands: 'bun test' } }
const BLOCK = 'duyệt độc lập'
function setup(on: On): Seen {
  const seen = base(on, { router: () => GOAL })
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
async function answer($: Engine, description: string, text: string, commands: readonly string[] = [], model = 'claude-opus-5-5') {
  const id = `g${(n += 1)}`
  await $.tool.call({ tool: 'Agent', tool_use_id: id, description, prompt: 'Rà.' } as never)
  await $.agent.spawn({ prompt: 'Rà.', description, tool_use_id: id } as never)
  for (const command of commands) await $.tool.call({ tool: 'Bash', command, agentId: `a-${id}` } as never)
  await $.turn.complete({ turnId: `x-${id}`, agentId: `a-${id}`, answer: text, durationMs: 5, isAborted: false, reason: 'answer', usage: { model, input_tokens: 10, output_tokens: 10 } } as never)
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

describe('0.9.0 vòng sửa 1 (1, 4, 7): cổng đóng', () => {
  test('chặn vì chưa duyệt, rồi duyệt CHƯA ĐẠT: lần dừng kế tiếp chặn lại', OPTS, async ($, on) => {
    const seen = setup(on)
    await start($, seen)
    await close($)
    expect(await stop($)).toContain(BLOCK)
    await answer($, 'Kiểm độc lập: phí', 'CHƯA ĐẠT\n- Lớn: thiếu test')
    expect(await stop($)).toContain(BLOCK)
  })
  test('model chạy không đọc được (usage.model lạ): không tính là từ sonnet, cổng chặn', OPTS, async ($, on) => {
    const seen = setup(on)
    await start($, seen)
    await answer($, 'Rà phí', 'ĐẠT', [], 'gpt-mini')
    await close($)
    expect(await stop($)).toContain(BLOCK)
  })
})
