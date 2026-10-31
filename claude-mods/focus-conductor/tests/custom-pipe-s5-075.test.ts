// 0.7.5 S5 (vòng rà soát 4): lệnh kiểm khai qua ống không pipefail đổi cách nhận.
//  a. Có set -o pipefail (hay không qua ống): tin mã thoát, danh sách từ chỉ là phủ quyết.
//  b. Qua ống không pipefail: chỉ đạt khi dòng không rỗng cuối cùng khớp chặt một dòng tổng kết và không dòng nào có dấu hiệu lỗi.
//  c. Thêm dấu hiệu lỗi: trùng, trùng lặp, duplicate, chưa xử lý, vượt ngưỡng, không cân, chênh kèm số, expected ... got, -> False, assert,
//     không tìm thấy, NULL kèm số, differ, WARN và warning kèm số khác 0.
//  d. Phủ định trước từ lỗi không phải lỗi ("không có lỗi", "không thiếu", "no errors"); số 0 khớp cả từ ghép ("sai lệch: 0").

import { describe, expect, test } from 'claude-code/testing'
import { applyCheckCommands, newTracker, observe, parseCheckCommands } from '../hooks/lib/drift'
import { verifiedAfter } from './support/commands'
import { COMPLEX_PROMPT, base, conductor, submit } from './support/engine'

const RUN = '/usr/bin/python3 -B /repo/tests/check_all.py'
function declared(body: () => void): void {
  applyCheckCommands(parseCheckCommands(RUN))
  try {
    body()
  } finally {
    applyCheckCommands([])
  }
}
const piped = (output: string) => verifiedAfter(`${RUN} 2>&1 | tail -n 5`, { output })
const withPipefail = (output: string) => verifiedAfter(`set -o pipefail; ${RUN} 2>&1 | tail -n 5`, { output })
const direct = (output: string) => verifiedAfter(RUN, { output })

const FAILS = [
  'Bảng K4: 3 dòng trùng lặp\nOK',
  'Còn 5 dòng chưa xử lý\nOK',
  'Vượt ngưỡng 2 lần\nĐẠT',
  'Tổng tiền không cân\nOK',
  'K4: chênh 1.200.000đ\nOK',
  'Expected 120, got 115\nOK',
  'assert total == 120 -> False\nOK',
  'Không tìm thấy 4 mã hàng\nOK',
  'NULL ở 7 dòng\nOK',
  '5 rows differ\nOK',
  'WARN 3 rows\nOK',
  'Duplicated keys: 2\nOK',
]
const PASSES = ['Không có lỗi\nĐẠT', 'Không thiếu dòng nào\nOK', 'No errors found\nPASS', 'Không có dòng sai lệch\nĐẠT', 'Sai lệch: 0\nOK']

describe('0.7.5 S5 (c): mười hai đầu ra lỗi mới đều không đạt, qua ống không pipefail và có pipefail', () => {
  for (const output of FAILS) {
    test(`không đạt: ${JSON.stringify(output)}`, () => {
      declared(() => {
        expect(piped(output)).toBe(false)
        expect(withPipefail(output)).toBe(false)
      })
    })
  }
})

describe('0.7.5 S5 (d): phủ định trước từ lỗi và số 0 của từ ghép', () => {
  for (const output of PASSES) {
    test(`đạt: ${JSON.stringify(output)}`, () => {
      declared(() => {
        expect(piped(output)).toBe(true)
        expect(withPipefail(output)).toBe(true)
      })
    })
  }

  test('số 0 của từ ghép và dạng đếm: "Chênh lệch = 0", "0 trùng lặp", "Duplicates: 0", "NULL: 0", "0 warnings", "Warn 0"', () => {
    declared(() => {
      for (const output of ['Chênh lệch = 0\nOK', '0 trùng lặp\nOK', 'Duplicates: 0\nOK', 'NULL: 0\nOK', '0 warnings\nOK', 'Warn 0\nOK', 'Chưa xử lý: 0\nOK']) expect(piped(output), output).toBe(true)
    })
  })

  test('phủ định không che lỗi thật: "Không có lỗi\\nThiếu 5 dòng\\nOK" vẫn không đạt', () => {
    declared(() => {
      expect(piped('Không có lỗi\nThiếu 5 dòng\nOK')).toBe(false)
      expect(piped('No errors in A\n3 errors in B\nOK')).toBe(false)
    })
  })

  test('"trùng khớp" là dấu hiệu đạt, không phải trùng lặp', () => {
    declared(() => {
      expect(piped('Trùng khớp 100%\nOK')).toBe(true)
    })
  })
})

describe('0.7.5 S5 (b): qua ống không pipefail cần dòng cuối là dòng tổng kết chặt', () => {
  test('dòng tổng kết: OK, PASS, PASSED, ĐẠT, KẾT QUẢ: ĐẠT, ALL PASS, kèm N/N bằng nhau, tiền tố Kết quả/Done/Tổng', () => {
    declared(() => {
      for (const last of ['OK', 'ok.', 'PASS', 'PASSED', 'ĐẠT', 'KẾT QUẢ: ĐẠT', 'Kết quả: đạt', 'ALL PASS', 'All tests passed', 'OK 120/120', 'ĐẠT (120/120)', 'Done OK', 'Tổng: 120/120 khớp', 'Tổng hợp KHỚP', 'Kiểm xong: 0 lỗi', '12 passed']) {
        expect(piped(`Đã kiểm 120 dòng\n${last}`), last).toBe(true)
      }
    })
  })

  test('dòng cuối là câu thường dù có chữ OK hay ĐẠT: không đạt', () => {
    declared(() => {
      for (const last of ['Kiểm xong tại casino OK', 'know OK', 'Tiếp tục bước sau', 'Đạt được mục tiêu của lô 3 rồi nhé', 'OK, nhưng còn chờ lô 4', 'Mọi thứ đều ổn']) {
        expect(piped(`Đã kiểm 120 dòng\n${last}`), last).toBe(false)
      }
    })
  })

  test('có pipefail hay không qua ống: không cần dòng tổng kết, chỉ cần không có dấu hiệu lỗi', () => {
    declared(() => {
      expect(withPipefail('Đã xử lý lô 12')).toBe(true)
      expect(direct('Đã xử lý lô 12')).toBe(true)
    })
  })
})

describe('0.7.5 S5 (b): nhắc một lần trong phiên khi dòng cuối không phải dòng tổng kết', () => {
  const FOCUS = (hints: Set<string>) => ({ goal: 'Cập nhật dữ liệu theo các bước', scopePaths: [], tier: 'complex' as const, hints })
  const call = (command: string, output: string) => ({ tool: 'Bash', input: { command }, isError: false, isReadOnly: false, output })
  const piping = `${RUN} 2>&1 | tail -n 5`
  const hintOf = (hints: Set<string>, command: string, output: string) => observe(newTracker('t'), call(command, output), FOCUS(hints), []).find(f => f.context?.includes('pipefail'))

  test('lệnh kiểm qua ống không pipefail, không lỗi, dòng cuối không phải tổng kết: nhắc; khóa đã ghi (lời nhắc đã chèn) thì không nhắc', () => {
    declared(() => {
      const hints = new Set<string>()
      const first = hintOf(hints, piping, 'Đã kiểm 120 dòng\nTiếp tục bước sau')
      expect(first?.context).toContain('set -o pipefail')
      expect(first?.context).toContain('dòng tổng kết')
      // T6: observe không tự ghi khóa; hook ghi khi lời nhắc được chèn (tests/integration/pipe-hint-t6-075.test.ts).
      expect(first?.hint).toBe('pipe-summary')
      expect(hintOf(hints, piping, 'Đã kiểm 12 dòng\nTiếp tục bước sau')).toBeDefined()
      hints.add('pipe-summary')
      expect(hintOf(hints, piping, 'Đã kiểm 12 dòng\nTiếp tục bước sau')).toBeUndefined()
    })
  })

  test('không nhắc khi có tổng kết, khi có pipefail, khi không qua ống, hay khi output có dấu hiệu lỗi (đã là không đạt vì lý do khác)', () => {
    declared(() => {
      expect(hintOf(new Set(), piping, 'Đã kiểm 120 dòng\nOK')).toBeUndefined()
      expect(hintOf(new Set(), `set -o pipefail; ${piping}`, 'Đã kiểm 120 dòng\nTiếp tục bước sau')).toBeUndefined()
      expect(hintOf(new Set(), RUN, 'Đã kiểm 120 dòng\nTiếp tục bước sau')).toBeUndefined()
      expect(hintOf(new Set(), piping, 'Thiếu 5 dòng\nTiếp tục bước sau')).toBeUndefined()
    })
  })
})

describe('0.7.5 S5: dấu hiệu lỗi đứng riêng', () => {
  test('"-> False" một mình, "assert" một mình, "expected" và "got" ở hai dòng khác nhau không phải lỗi', () => {
    declared(() => {
      expect(piped('Kiểm tổng -> False\nOK')).toBe(false)
      expect(piped('assert total == 120\nOK')).toBe(false)
      expect(piped('Expected format documented below\nwe got 3 files\nOK')).toBe(true)
    })
  })
})

describe('0.7.5 S5: nhắc dòng tổng kết chỉ cho lệnh kiểm riêng, một lần trong phiên', () => {
  const FOCUS = { goal: 'Cập nhật dữ liệu theo các bước', scopePaths: [], tier: 'complex' as const, hints: new Set<string>() }
  test('lệnh kiểm chuẩn (node --test) không bị nhắc', () => {
    const out = observe(newTracker('t'), { tool: 'Bash', input: { command: 'node --test src/ 2>&1 | tail -n 5' }, isError: false, isReadOnly: false, output: 'Đã chạy\nTiếp tục bước sau' }, FOCUS, [])
    expect(out.find(f => f.context?.includes('pipefail'))).toBeUndefined()
  })

  test('qua engine: lần đầu có lời nhắc, lần sau không (kể cả ở prompt sau), /conductor reset thì nhắc lại', { options: { checkCommands: RUN } }, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'Đã kiểm 120 dòng\nTiếp tục bước sau' }))
    await submit($, COMPLEX_PROMPT)
    const run = async () => {
      const out = (await $.tool.call({ tool: 'Bash', command: `${RUN} 2>&1 | tail -n 5` })) as { context?: string[] }
      return (out.context ?? []).some(text => text.includes('set -o pipefail'))
    }
    expect(await run()).toBe(true)
    expect(await run()).toBe(false)
    await submit($, 'tiếp tục lô sau')
    expect(await run()).toBe(false)
    await conductor($, 'reset')
    await submit($, COMPLEX_PROMPT)
    expect(await run()).toBe(true)
  })
})

describe('0.7.5 vòng rà soát 5: "không hợp lệ" một mình là dấu hiệu lỗi (ghim 075-H1i)', () => {
  test('qua ống không pipefail: "Dòng 12 không hợp lệ⏎OK" không đạt', () => {
    declared(() => {
      expect(piped('Dòng 12 không hợp lệ\nOK')).toBe(false)
      expect(withPipefail('Dòng 12 không hợp lệ\nOK')).toBe(false)
    })
  })
})
