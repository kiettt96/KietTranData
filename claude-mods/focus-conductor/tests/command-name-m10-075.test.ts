// 0.7.5 M10 (vòng sửa 2): tên cuối của lệnh (bỏ thư mục) chỉ áp cho thư mục hệ thống (/bin, /usr/bin, /usr/local/bin,
// /opt/homebrew/bin, /usr/sbin, /sbin) và cho trình thông dịch python, sqlite3 ở thư mục nào cũng được; binary ở thư mục khác
// giữ nguyên tên đầy đủ nên không bị nhận nhầm là lệnh chỉ đọc cùng tên.

import { describe, expect, test } from 'claude-code/testing'
import { isMutation } from '../hooks/lib/drift'

const mutates = (command: string) => isMutation({ tool: 'Bash', input: { command }, isError: false, isReadOnly: false, output: '' })

describe('0.7.5 M10: binary ngoài thư mục hệ thống giữ tên đầy đủ', () => {
  test('/abs/tools/cat data.db là ghi có thể; /bin/cat data.db chỉ đọc', () => {
    expect(mutates('/abs/tools/cat data.db')).toBe(true)
    expect(mutates('/bin/cat data.db')).toBe(false)
  })

  test('sáu thư mục hệ thống đều bỏ phần thư mục', () => {
    for (const dir of ['/bin', '/usr/bin', '/usr/local/bin', '/opt/homebrew/bin', '/usr/sbin', '/sbin']) expect(mutates(`${dir}/ls -la /repo`), dir).toBe(false)
  })

  test('thư mục khác (kể cả thư mục lồng thư mục hệ thống, đường dẫn tương đối, thư mục của người dùng) giữ tên đầy đủ', () => {
    for (const command of ['/abs/tools/ls -la /repo', './ls -la', 'tools/ls -la', '/usr/bin/local/ls -la', '/home/u/bin/ls -la', '/opt/homebrew/bin/x/ls -la']) expect(mutates(command), command).toBe(true)
  })

  test('python và sqlite3 ở thư mục nào cũng bỏ phần thư mục (mã nội dòng chỉ đọc)', () => {
    expect(mutates('/home/u/venv/bin/python3 -c "print(1)"')).toBe(false)
    expect(mutates('/opt/py/bin/python3.11 -c "print(1)"')).toBe(false)
    expect(mutates('/opt/tools/sqlite3 data.db "SELECT count(*) FROM lo"')).toBe(false)
    expect(mutates('/opt/tools/sqlite3 data.db "DELETE FROM lo"')).toBe(true)
  })
})

describe('0.7.5 M10: env vẫn bỏ đúng như trước', () => {
  test('env và /usr/bin/env (có hay không có biến) xét lệnh thật; env ở thư mục khác là binary lạ', () => {
    expect(mutates('/usr/bin/env python3 -c "print(1)"')).toBe(false)
    expect(mutates('env FOO=1 /usr/bin/python3 -c "print(1)"')).toBe(false)
    expect(mutates('env FOO=1 rm -rf /repo/build')).toBe(true)
    expect(mutates('/usr/bin/env touch /repo/a.txt')).toBe(true)
    expect(mutates('/abs/tools/env python3 -c "print(1)"')).toBe(true)
  })
})
