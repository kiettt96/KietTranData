// 0.7.5 T6 (vòng rà soát 5): lời nhắc pipefail một lần trong phiên chỉ được đánh dấu đã dùng khi nó thật sự được chèn vào kết quả
// tool; lần nó thua một phát hiện ưu tiên cao hơn (vượt ngân sách tool call) thì lần sau vẫn nhắc. Câu nhắc nói rõ đặt `set -o
// pipefail;` trước lệnh kiểm, không sửa script kiểm khi người dùng không yêu cầu, và trường hợp lệnh kiểm in kết quả lỗi.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { base, submit } from '../support/engine'

const RUN = '/usr/bin/python3 -B /repo/tests/check_all.py'
const PIPED = `${RUN} 2>&1 | tail -n 5`
const OPTIONS = { options: { checkCommands: RUN } }
const call = async ($: Engine, input: Record<string, unknown>) => ((await $.tool.call(input as never)).context ?? []).join('\n')
const isHint = (context: string) => context.includes('set -o pipefail')

describe('0.7.5 T6: lời nhắc pipefail đánh dấu khi được chèn', () => {
  test('lần đầu thua cảnh báo vượt ngân sách: lần sau vẫn nhắc; đã nhắc thì không nhắc lại', OPTIONS, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Read' }, () => ({ result: 'nội dung' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'Đã kiểm 120 dòng\nTiếp tục bước sau' }))
    await submit($, 'Kiểm dữ liệu các bảng')
    await $.turn.start({ text: 'làm', turnId: 't6' })
    // Mục tiêu nhẹ (light, small: tier simple, ngân sách 15): lời gọi thứ 15 vượt ngân sách.
    for (let i = 0; i < 14; i++) await call($, { tool: 'Read', file_path: `src/f${i}.ts` })
    const first = await call($, { tool: 'Bash', command: PIPED })
    expect(first).toContain('vượt mức dự kiến')
    expect(isHint(first)).toBe(false)
    const second = await call($, { tool: 'Bash', command: PIPED })
    expect(isHint(second)).toBe(true)
    const third = await call($, { tool: 'Bash', command: PIPED })
    expect(isHint(third)).toBe(false)
  })

  test('câu nhắc: đặt set -o pipefail; trước lệnh kiểm, không sửa script kiểm, nêu trường hợp lệnh kiểm in kết quả lỗi', OPTIONS, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'Đã kiểm 120 dòng\nTiếp tục bước sau' }))
    await submit($, 'Kiểm dữ liệu các bảng')
    const context = await call($, { tool: 'Bash', command: PIPED })
    expect(context).toContain('Đặt `set -o pipefail;` trước lệnh kiểm.')
    expect(context).toContain('Không sửa script kiểm nếu người dùng không yêu cầu.')
    expect(context).toContain('in kết quả lỗi')
  })
})
