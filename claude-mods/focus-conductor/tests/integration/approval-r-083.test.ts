// 0.8.3: vá cổng duyệt kế hoạch của 0.8.2 N2. R1: diện duyệt gồm mục tiêu loại mixed (ghim điều kiện của needsApproval). R2: đường dẫn
// được miễn so sau khi gộp . và .., nên đích có .. đi ra khỏi thư mục được miễn bị từ chối.
// Test kiểm cổng duyệt nên để planApproval mặc định (auto).

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { base, plan, submit } from '../support/engine'
import { approvalDenial } from '../../hooks/lib/approval'
import type { Json } from '../support/engine'

const OPTIONS = { options: { enforceChecklist: true } }
const PLANNING = 'Lập checklist bằng tool plan'

function setup(on: On, reply: Json) {
  const seen = base(on, { router: () => reply })
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Write' }, () => ({ result: 'ok' }))
  on('classic.Stop', () => ({}))
  on('turn.complete', () => ({ text: '' }))
  return seen
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
