// 0.8.3: vá cổng duyệt kế hoạch của 0.8.2 N2. R1: diện duyệt gồm mục tiêu loại mixed (ghim điều kiện của needsApproval). R2: đường dẫn
// được miễn so sau khi gộp . và .., nên đích có .. đi ra khỏi thư mục được miễn bị từ chối. R4: khi chưa duyệt, lệnh tra cứu gh chỉ đọc
// và lệnh chỉ ghi dưới thư mục tạm được qua. R3: cờ chờ câu trả lời câu hỏi làm rõ nằm trong Core (approval.awaitingAnswer), sống qua
// hot reload. Bộ kit test không nạp lại module được, nên hai ca tích hợp chỉ ghim hành vi; ca Core kiểm trạng thái bền.
// Test kiểm cổng duyệt nên để planApproval mặc định (auto).

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Core } from '../../types'
import * as S from '../../hooks/lib/state'
import { base, plan, submit } from '../support/engine'
import { approvalDenial } from '../../hooks/lib/approval'
import type { Json } from '../support/engine'

const OPTIONS = { options: { enforceChecklist: true } }
const PLANNING = 'Lập checklist bằng tool plan'

function setup(on: On, reply: Json | Json[]) {
  const replies = Array.isArray(reply) ? reply : [reply]
  let count = 0
  const seen = base(on, { router: () => replies[Math.min(count++, replies.length - 1)] ?? null })
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Write' }, () => ({ result: 'ok' }))
  // Tầng dưới của session.start (như engine nạp lại mod): mod đăng ký tool plan và lệnh /conductor ở đó.
  on('tool.register', () => ({ value: { tool: 'mcp__focus-conductor__plan' } }) as never)
  on('command.register', () => ({ value: { command: 'conductor' } }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('classic.Stop', () => ({}))
  on('turn.complete', () => ({ text: '' }))
  const writes: string[] = []
  on('fs.write', (_$, e) => {
    writes.push(e.text)
    return { value: undefined }
  })
  const lines = () => (writes[writes.length - 1] ?? '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
  return { ...seen, lines }
}

const goal = (depth: string, kind: string) => plan({ goal: 'Sửa luồng thanh toán', depth, volume: 'medium', kind, requirements: ['Sửa hàm tính phí', 'Thêm test cho phí'] })
const edit = ($: Engine) => $.tool.call({ tool: 'Edit', file_path: 'src/phi.ts', old_string: 'a', new_string: 'b' } as never)

describe('0.8.3 R1: diện duyệt kế hoạch với mục tiêu mixed', () => {
  test('substantial, mixed: Edit ở luồng chính bị từ chối khi đang lập kế hoạch', OPTIONS, async ($, on) => {
    setup(on, goal('substantial', 'mixed'))
    await submit($, 'Sửa luồng thanh toán')
    expect((await edit($)).deny).toContain('chưa được duyệt')
  })

  test('hard, mixed: có đoạn dặn lập kế hoạch ở context', OPTIONS, async ($, on) => {
    const seen = setup(on, goal('hard', 'mixed'))
    await submit($, 'Sửa luồng thanh toán')
    expect((seen.contexts.at(-1) ?? []).join('\n')).toContain(PLANNING)
  })

  test('substantial, investigate: không chặn, không dặn lập kế hoạch', OPTIONS, async ($, on) => {
    const seen = setup(on, goal('substantial', 'investigate'))
    await submit($, 'Sửa luồng thanh toán')
    expect((await edit($)).deny).toBeUndefined()
    expect((seen.contexts.at(-1) ?? []).join('\n')).not.toContain(PLANNING)
  })
})

describe('0.8.3 R2: đường dẫn được miễn so sau khi chuẩn hóa', () => {
  const cases: Array<[string, Record<string, unknown>, boolean]> = [
    ['Write', { file_path: '.claude/plans/../../hooks/a.ts', content: 'x' }, false],
    ['Edit', { file_path: '/r/.focus-conductor/../hooks/a.ts', old_string: 'a', new_string: 'b' }, false],
    ['Write', { file_path: '.claude/plans/./a.md', content: 'x' }, true],
    ['Write', { file_path: '/srv/du-an/.claude/plans/a.md', content: 'x' }, true],
    ['Write', { file_path: '.claude/plans/sub/../a.md', content: 'x' }, true],
  ]
  for (const [tool, input, allowed] of cases) {
    test(`${tool} ${String(input['file_path'])}: ${allowed ? 'qua' : 'từ chối'}`, () => {
      expect(approvalDenial(tool, input) === null).toBe(allowed)
    })
  }
})

describe('0.8.3 R4: lệnh tra cứu và lệnh chỉ ghi thư mục tạm khi chưa duyệt', () => {
  const bash = (command: string) => approvalDenial('Bash', { command }) === null
  for (const command of ['gh pr view 35', 'gh pr diff 35 -R a/b', 'gh run list --json status', 'gh api repos/a/b/pulls/1', 'mkdir -p /tmp/x', 'echo x > /tmp/a.txt']) {
    test(`qua: ${command}`, () => expect(bash(command)).toBe(true))
  }
  for (const command of [
    'gh pr merge 35',
    'gh pr create',
    'gh api -X POST repos/a/b/issues',
    'gh api repos/a/b/issues -f title=x',
    'gh pr view 35; rm a',
    'mkdir -p /tmp/../srv/x',
    'echo x > /tmp/a && echo y > b',
    'cp /tmp/a hooks/a.ts',
    'echo $(rm -rf hooks) > /tmp/x',
    'bash -c "rm a" > /tmp/x',
    'echo x > /tmpx/a',
  ]) {
    test(`từ chối: ${command}`, () => expect(bash(command)).toBe(false))
  }
})

describe('0.8.3 R3: cờ chờ câu trả lời nằm trong Core', () => {
  const LOGGED = { options: { enforceChecklist: true, decisionLog: '/tmp/fc-approval-r-083.jsonl' } }
  const QUESTIONS = ['Giữ API cũ hay đổi chữ ký hàm (giữ, đổi)?', 'Phí làm tròn lên hay xuống (lên, xuống)?']
  const asking = plan({ goal: 'Sửa luồng thanh toán', depth: 'substantial', volume: 'medium', kind: 'edit', requirements: ['Sửa hàm tính phí'], questions: QUESTIONS })
  const answer = plan({ goal: 'Giữ API cũ, làm tròn lên', confidence: 0.5, depth: 'substantial', kind: 'edit' })
  const stop = async ($: Engine) => String(((await $.classic.Stop({ stop_hook_active: false } as never)) as { block?: string }).block ?? '')

  test('router trả questions, hot reload (session.start), rồi Stop: không chặn, kể cả G1', LOGGED, async ($, on) => {
    setup(on, [asking, answer])
    await submit($, 'Sửa luồng thanh toán')
    await $.turn.start({ text: 'việc', turnId: 't1' })
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: true } as never)
    await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'set', steps: [] } as never)
    expect(await stop($)).toBe('')
  })

  test('như trên, rồi câu trả lời bị router xếp new tin cậy 0,5: giữ mục tiêu, có answer-held', LOGGED, async ($, on) => {
    const { lines } = setup(on, [asking, answer])
    await submit($, 'Sửa luồng thanh toán')
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: true } as never)
    await submit($, 'giữ, lên')
    expect(lines().some(l => l['kind'] === 'answer-held')).toBe(true)
    expect((await edit($)).deny).toContain('chưa được duyệt')
  })

  test('Core từ 0.8.2 không có awaitingAnswer: nạp được, mặc định false', () => {
    const old = { ...S.EMPTY_CORE, approval: { goalId: 4, status: 'planning', rounds: 0, asked: true } }
    const loaded = S.normalizeCore(JSON.parse(JSON.stringify(old)) as Partial<Core>)
    expect(loaded.approval.awaitingAnswer).toBe(false)
    expect(loaded.approval.status).toBe('planning')
  })

  test('awaitingAnswer còn sau vòng JSON của Core (như sau hot reload)', () => {
    const core = S.withApproval({ goalId: 4, status: 'planning', rounds: 0, asked: true, awaitingAnswer: true })(S.EMPTY_CORE)
    expect(S.normalizeCore(JSON.parse(JSON.stringify(core)) as Partial<Core>).approval.awaitingAnswer).toBe(true)
  })
})
