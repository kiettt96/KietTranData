// 0.9.0 B6, vòng sửa (tích hợp): ghi tệp trạng thái hay nơi ghi phụ (B1) sau lần kiểm đạt không làm cũ bằng chứng của lần kiểm đó. Luồng
// của phiên theo kỷ luật giao việc: sửa file, chạy lệnh kiểm, ghi kết quả vào tệp tiến độ, rồi đóng bước verified. Đường dẫn khác giữ
// như 0.8.9: sửa file ngoài hai danh sách sau lần kiểm thì bước verified lưu là done.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { base, plan, submit } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const W = '/w/viec'
const CHECK = 'bash tests/kiem.sh'
const GOAL = plan({
  goal: 'Sửa hàm tinhPhi',
  scope: ['src/tinh.ts'],
  stateFiles: [`${W}/TIEN-DO.md`],
  sideWrites: [`${W}/backup/`],
  depth: 'substantial',
  volume: 'small',
  kind: 'edit',
  main: { model: 'sonnet', effort: 'medium' },
})
const OPTS = { options: { planApproval: 'off', checkCommands: CHECK, closingReview: 'off' } }
const DOWN = 'lưu là done'
type Out = { result?: string }

function setup(on: On): void {
  base(on, { router: () => GOAL, root: '/repo' })
  on('tool.call', { tool: /^(?:Write|Edit)$/ }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, (_$, e) => ({ result: String((e as { command?: unknown }).command ?? '').includes('kiem.sh') ? '4 pass, 0 fail' : '' }))
  on('turn.complete', () => ({ text: '' }))
}
async function verifyAfter($: Engine, after: () => Promise<unknown>): Promise<string> {
  await submit($, 'Sửa hàm tinhPhi')
  await $.turn.start({ text: 'Sửa hàm tinhPhi', turnId: 't1' })
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'M1: phí âm trả 0' }] })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/tinh.ts', old_string: 'a', new_string: 'b' } as never)
  await $.tool.call({ tool: 'Bash', command: CHECK } as never)
  await after()
  return ((await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: `${CHECK}: 4 pass, 0 fail` })) as Out).result ?? ''
}

describe('0.9.0 B6 vòng sửa: ghi tệp trạng thái sau lần kiểm không làm cũ bằng chứng', () => {
  test('Edit tệp tiến độ sau lần kiểm: bước giữ verified', OPTS, async ($, on) => {
    setup(on)
    expect(await verifyAfter($, () => $.tool.call({ tool: 'Edit', file_path: `${W}/TIEN-DO.md`, old_string: 'a', new_string: 'b' } as never))).not.toContain(DOWN)
  })
  test('cp vào nơi sao lưu sau lần kiểm: bước giữ verified', OPTS, async ($, on) => {
    setup(on)
    expect(await verifyAfter($, () => $.tool.call({ tool: 'Bash', command: `mkdir -p ${W}/backup && cp /repo/src/tinh.ts ${W}/backup/tinh.ts` } as never))).not.toContain(DOWN)
  })
  test('sửa file ngoài hai danh sách sau lần kiểm: như 0.8.9, lưu là done', OPTS, async ($, on) => {
    setup(on)
    expect(await verifyAfter($, () => $.tool.call({ tool: 'Edit', file_path: '/repo/src/tinh.ts', old_string: 'b', new_string: 'c' } as never))).toContain(DOWN)
  })
})
