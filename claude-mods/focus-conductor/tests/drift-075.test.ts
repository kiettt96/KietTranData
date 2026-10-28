// 0.7.5 A4: lệnh kiểm khai trong checkCommands chạy qua `| tail -N` hay `| head -N`, sau `cd <dir> &&` hay `set -o pipefail`,
// được tính đạt theo luật an toàn: (a) có pipefail thì mã thoát 0 và đầu ra không có dấu hiệu lỗi; (b) không có pipefail thì
// phần đầu ra còn thấy phải có dấu hiệu đạt rõ (kể cả tiếng Việt) và không có dấu hiệu lỗi.
// 0.7.5 A5: tên lệnh có đường dẫn (/usr/bin/python3, /bin/ls) và tiền tố env được xét theo lệnh thật.

import { describe, expect, test } from 'claude-code/testing'
import { applyCheckCommands, isMutation, parseCheckCommands } from '../hooks/lib/drift'
import { verifiedAfter } from './support/commands'

const DECLARED = '/usr/bin/python3 -B /repo/tests/check_all.py'
const RUN = '/usr/bin/python3 -B /repo/tests/check_all.py'
const mutates = (command: string) => isMutation({ tool: 'Bash', input: { command }, isError: false, isReadOnly: false, output: '' })

/** Chạy `body` với checkCommands đã khai, rồi bỏ khai. */
function declared(commands: string, body: () => void): void {
  applyCheckCommands(parseCheckCommands(commands))
  try {
    body()
  } finally {
    applyCheckCommands([])
  }
}

describe('0.7.5 A4: lệnh kiểm khai chạy qua | tail', () => {
  test('đạt: dòng tổng kết đạt còn thấy, không có dấu hiệu lỗi', () => {
    declared(DECLARED, () => {
      expect(verifiedAfter(`${RUN} 2>&1 | tail -5`, { output: 'lô 3: KHỚP\nKẾT QUẢ: ĐẠT' })).toBe(true)
      expect(verifiedAfter(`${RUN} | tail -n 3`, { output: 'Tổng: 12 lô\n12 passed' })).toBe(true)
    })
  })

  test('lỗi còn thấy trong phần cuối: không đạt', () => {
    declared(DECLARED, () => {
      expect(verifiedAfter(`${RUN} | tail -5`, { output: 'lô 3: KHỚP\nKẾT QUẢ: KHÔNG ĐẠT' })).toBe(false)
      expect(verifiedAfter(`${RUN} | tail -5`, { output: 'Traceback (most recent call last):\n  File "x"\nKeyError: 1' })).toBe(false)
      expect(verifiedAfter(`${RUN} | tail -5`, { output: '2 failed, 10 passed' })).toBe(false)
    })
  })

  test('lỗi bị tail cắt mất, không còn dòng đạt: không đạt', () => {
    declared(DECLARED, () => {
      expect(verifiedAfter(`${RUN} | tail -2`, { output: 'đã xử lý lô 11\nđã xử lý lô 12' })).toBe(false)
    })
  })

  test('lệnh khác (không khai, không phải trình chạy) qua tail không được nhận nhầm', () => {
    declared(DECLARED, () => {
      expect(verifiedAfter('/usr/bin/python3 -B /repo/tests/ghi_du_lieu.py | tail -3', { output: 'KẾT QUẢ: ĐẠT' })).toBe(false)
      expect(verifiedAfter('npm test | tail -5', { output: 'KẾT QUẢ: ĐẠT' })).toBe(false)
    })
  })

  test('dấu hiệu đạt tiếng Việt: ĐẠT, KHỚP, OK, 0 lỗi', () => {
    declared(DECLARED, () => {
      for (const output of ['ĐẠT', 'Kết quả: đạt', 'Tổng hợp KHỚP', 'OK', 'Kiểm xong: 0 lỗi']) {
        expect(verifiedAfter(`${RUN} | tail -3`, { output }), output).toBe(true)
      }
    })
  })

  test('dấu hiệu lỗi tiếng Việt: LỖI, SAI, KHÔNG KHỚP, số lỗi khác 0 (đứng trước dấu hiệu đạt)', () => {
    declared(DECLARED, () => {
      for (const output of ['LỖI ở lô 2\nKẾT QUẢ: ĐẠT', 'SAI tổng lô 4\nOK', 'Tổng KHÔNG KHỚP', 'Kiểm xong: 3 lỗi', 'lô 2: sai\nĐẠT']) {
        expect(verifiedAfter(`${RUN} | tail -3`, { output }), output).toBe(false)
      }
    })
  })

  test('| head -N: đạt chỉ khi head không cắt (ít dòng hơn N); cắt thì không đạt', () => {
    declared(DECLARED, () => {
      expect(verifiedAfter(`${RUN} | head -20`, { output: 'lô 1: KHỚP\nKẾT QUẢ: ĐẠT' })).toBe(true)
      const twenty = ['KẾT QUẢ: ĐẠT', ...Array.from({ length: 19 }, (_, i) => `dòng ${i}`)].join('\n')
      expect(verifiedAfter(`${RUN} | head -20`, { output: twenty })).toBe(false)
    })
  })
})

describe('0.7.5 A4: set -o pipefail', () => {
  test('có pipefail: mã thoát 0 và không có dấu hiệu lỗi là đạt, kể cả khi không có dòng đạt', () => {
    declared(DECLARED, () => {
      expect(verifiedAfter(`set -o pipefail; ${RUN} | tail -3`, { output: 'đã xử lý lô 12' })).toBe(true)
      expect(verifiedAfter(`set -euo pipefail && ${RUN} 2>&1 | tail -3`, { output: 'xong' })).toBe(true)
    })
  })

  test('có pipefail: mã thoát khác 0 hay có dấu hiệu lỗi thì không đạt', () => {
    declared(DECLARED, () => {
      expect(verifiedAfter(`set -o pipefail; ${RUN} | tail -3`, { isError: true, output: 'xong' })).toBe(false)
      expect(verifiedAfter(`set -o pipefail; ${RUN} | tail -3`, { output: 'KẾT QUẢ: KHÔNG KHỚP' })).toBe(false)
    })
  })

  test('set -o pipefail không phải thay đổi', () => {
    expect(mutates('set -o pipefail')).toBe(false)
    expect(mutates('set -euo pipefail')).toBe(false)
  })
})

describe('0.7.5 A4: cd <dir> && lệnh kiểm có đường dẫn tương đối', () => {
  test('nối đường dẫn tương đối với thư mục của cd trước khi so với lệnh khai', () => {
    declared('python3 /repo/tests/check_all.py', () => {
      expect(verifiedAfter('cd /repo && python3 tests/check_all.py', { output: 'xong' })).toBe(true)
      expect(verifiedAfter('cd /repo && python3 tests/check_all.py | tail -3', { output: 'ĐẠT' })).toBe(true)
      expect(verifiedAfter('cd /other && python3 tests/check_all.py', { output: 'xong' })).toBe(false)
    })
  })
})

describe('0.7.5 A5: tên lệnh có đường dẫn và tiền tố env', () => {
  test('python và sqlite3 có đường dẫn với mã nội dòng chỉ đọc: không là thay đổi', () => {
    expect(mutates('/usr/bin/python3 -c "print(1)"')).toBe(false)
    expect(mutates('/usr/bin/sqlite3 data.db "SELECT count(*) FROM lo"')).toBe(false)
  })

  test('python có đường dẫn chạy script, sqlite3 có đường dẫn ghi: vẫn là thay đổi', () => {
    expect(mutates('/usr/bin/python3 -B /repo/scripts/ghi_du_lieu.py')).toBe(true)
    expect(mutates('/usr/bin/sqlite3 data.db "DELETE FROM lo"')).toBe(true)
  })

  test('mọi tên lệnh lấy tên cuối: /bin/ls không là thay đổi; /bin/rm vẫn ghi', () => {
    expect(mutates('/bin/ls -la /repo')).toBe(false)
    expect(mutates('/bin/rm /repo/build/x.o')).toBe(true)
  })

  test('tiền tố env (kể cả /usr/bin/env, có hay không có biến): xét lệnh thật', () => {
    expect(mutates('/usr/bin/env python3 -c "print(1)"')).toBe(false)
    expect(mutates('env FOO=1 /usr/bin/python3 -c "print(1)"')).toBe(false)
    expect(mutates('env FOO=1 rm -rf /repo/build')).toBe(true)
    expect(mutates('/usr/bin/env touch /repo/a.txt')).toBe(true)
  })
})
