// 0.9.0 A1: từ báo lỗi nằm trong nhãn của một dòng mà kết quả của chính dòng đó là dấu hiệu đạt đứng riêng thì không là dấu hiệu lỗi.
// Cùng nhãn kèm số lỗi khác 0 hay kết quả "chưa đạt" vẫn là lỗi. Lệnh khai trong checkCommands chạy qua `| tail`, có và không có pipefail.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { applyCheckCommands, parseCheckCommands } from '../hooks/lib/drift'
import { verifiedAfter } from './support/commands'
import { base, plan, step, submit } from './support/engine'
import type { Seen } from './support/engine'

const RUN = '/usr/bin/python3 -B /repo/tests/check_all.py'
const PIPED = `${RUN} 2>&1 | tail -n 20`
function declared(body: () => void): void {
  applyCheckCommands(parseCheckCommands(RUN))
  try {
    body()
  } finally {
    applyCheckCommands([])
  }
}
const piped = (output: string) => verifiedAfter(PIPED, { output })
const withPipefail = (output: string) => verifiedAfter(`set -o pipefail; ${PIPED}`, { output })

/** Ba dạng dòng tự soạn: nhãn chứa "lệch", "thiếu", "sai" kèm kết quả đạt đứng riêng. */
const PASSES = [
  'K1 đối chiếu số dư: ĐẠT\nK2 kiểm lệch tồn kho: ĐẠT\nK3 kiểm chứng từ: ĐẠT\n13/13 đạt',
  'Kiểm dòng thiếu mã hàng ........ OK\nKiểm ngày hạch toán ........ OK\nTổng: 13/13 ĐẠT',
  'Phép sai số làm tròn | PASS\nPhép tổng tiền | PASS\nKết quả: 13/13 PASS',
]
/** Cùng nhãn kèm số lỗi khác 0 hay kết quả chưa đạt. */
const FAILS = [
  'K1 đối chiếu số dư: ĐẠT\nK2 kiểm lệch tồn kho: 2 lỗi\n13/13 đạt',
  'Kiểm dòng thiếu mã hàng ........ CHƯA ĐẠT\nTổng: 13/13 ĐẠT',
  'Phép sai số làm tròn | 3 dòng sai\nKết quả: 13/13 PASS',
  'K2 kiểm lệch tồn kho: lệch 4 dòng\n13/13 đạt',
  // Nhãn có kết luận lỗi, số đếm lỗi, vế "lệch: N", tỷ lệ chưa đủ, hay chỉ gồm từ chỉ lỗi: giữ là lỗi.
  'K2 kiểm lệch chưa đạt | OK\n13/13 đạt',
  '3 dòng lệch | PASS\nKết quả: 13/13 PASS',
  'K2 lệch: 2, đã xem | OK\n13/13 đạt',
  'K2 kiểm lệch: ĐẠT (12/13)\n13/13 đạt',
  'Lỗi: OK\n13/13 đạt',
]

describe('0.9.0 A1: nhãn chứa từ báo lỗi kèm kết quả đạt', () => {
  for (const output of PASSES) {
    test(`đạt: ${JSON.stringify(output)}`, () => {
      declared(() => {
        expect(piped(output)).toBe(true)
        expect(withPipefail(output)).toBe(true)
      })
    })
  }
  for (const output of FAILS) {
    test(`vẫn lỗi: ${JSON.stringify(output)}`, () => {
      declared(() => {
        expect(piped(output)).toBe(false)
        expect(withPipefail(output)).toBe(false)
      })
    })
  }
})

const PLAN = 'mcp__focus-conductor__plan'
const GOAL = plan({ goal: 'Sửa hàm đối chiếu', depth: 'substantial', volume: 'medium', main: { model: 'sonnet', effort: 'medium' } })
const OPTIONS = { options: { checkCommands: RUN, planApproval: 'off' } }

function setup(on: On, output: string): Seen {
  const seen = base(on, { router: () => GOAL })
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: output }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  return seen
}
const stop = async ($: Engine) => String(((await $.classic.Stop({ stop_hook_active: false } as never)) as { block?: string }).block ?? '')

async function run($: Engine, seen: Seen): Promise<string> {
  await submit($, 'Sửa hàm đối chiếu')
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa hàm đối chiếu' }] })
  await $.turn.start({ text: 'Sửa hàm đối chiếu', turnId: 't1' })
  await step($, seen, { turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' } as never)
  await $.tool.call({ tool: 'Bash', command: PIPED } as never)
  await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
  return String((await $.tool.call({ tool: PLAN, action: 'show' })).result)
}

describe('0.9.0 A1: toàn luồng từ prompt.submit tới classic.Stop', () => {
  test('lệnh khai qua tail in nhãn chứa "lệch" kèm ĐẠT: bước lên verified, cổng Stop không chặn', OPTIONS, async ($, on) => {
    const seen = setup(on, PASSES[0] ?? '')
    const state = await run($, seen)
    expect(state).toContain('[v] 1.')
    expect(await stop($)).toBe('')
  })
  test('đối chứng: cùng nhãn kèm 2 lỗi thì bước không lên verified', OPTIONS, async ($, on) => {
    const seen = setup(on, FAILS[0] ?? '')
    const state = await run($, seen)
    expect(state).toContain('[x] 1.')
  })
})
