// 0.9.0 vòng 2, kiểm độc lập vòng 2 lỗi 2: đoạn chỉ có phép gán (`X=1`, `x=$(pwd)`) bị bỏ khi tách lệnh nên mất dấu `(` mở subshell, và
// `set -o pipefail`, `set -e` trong subshell vẫn bật cho lệnh sau; lần chạy pytest có test lỗi qua `| grep PASSED` được tính là kiểm đạt.
// Sửa theo quyết định của chủ mod 19/11/2026: pipefail và errexit chỉ nhận khi `set` ở cùng tầng shell với lệnh và bộ phân loại đọc trọn
// được cấu trúc đứng trước nó; còn lại thì không tính, và ống lệnh có dòng nhắc.

import { describe, expect, test } from 'claude-code/testing'
import { classifyBash } from '../hooks/lib/drift/classify'
import { checkEffectPassed } from '../hooks/lib/drift/output'
import { pipedCheck } from '../hooks/lib/drift/pipecheck'

const checkOf = (command: string) => classifyBash(command, '/p').effects.find(e => e.kind === 'check') as { exit?: string; pipefail?: true } | undefined
const passed = (command: string, output: string) =>
  checkEffectPassed(checkOf(command) as never, { tool: 'Bash', input: { command }, isError: false, isReadOnly: false, output } as never)

const PIPE_FORMS = [
  '( X=1; set -o pipefail ); pytest -v | grep PASSED',
  '( x=$(pwd); set -o pipefail ); npm test | tail -1',
  '(\n  set -o pipefail\n)\npytest -v | grep PASSED',
  '( set -o pipefail\n)\npytest -v | grep PASSED',
  'f() { set -o pipefail; }; npm test | tail -1',
  'echo $(true; set -o pipefail); npm test | tail -1',
]

describe('0.9.0 vòng 2 J2: set trong subshell có phép gán', () => {
  for (const command of PIPE_FORMS) {
    test(`pipefail không bật, ống có dòng nhắc: ${JSON.stringify(command)}`, () => {
      expect(checkOf(command)?.pipefail).toBeUndefined()
      expect(pipedCheck(command, '/p', [])).not.toBeNull()
    })
  }
  test('pytest có test lỗi qua grep PASSED sau pipefail trong subshell: không tính là đạt', () => {
    expect(passed('( X=1; set -o pipefail ); pytest -v | grep PASSED', 'tests/test_a.py::test_one PASSED [ 50%]')).toBe(false)
  })
  for (const command of ['( x=$(pwd); set -e ); npm test; echo ok', '(\n  set -e\n)\nnpm test\necho ok']) {
    test(`errexit không bật: ${JSON.stringify(command)}`, () => {
      expect(checkOf(command)?.exit).toBe('hidden')
    })
  }
  test('đối chứng: set ở tầng ngoài vẫn bật', () => {
    expect(checkOf('set -o pipefail; npm test | tail -1')?.pipefail).toBe(true)
    expect(checkOf('set -e; npm test; echo ok')?.exit).toBe('visible')
    expect(checkOf('X=1; set -o pipefail; npm test | tail -1')?.pipefail).toBe(true)
  })
})
