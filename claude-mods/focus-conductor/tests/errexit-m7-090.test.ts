// 0.9.0 vòng 2 M7: trong khối heredoc và trong một dòng lệnh, errexit và pipefail tính theo thứ tự câu lệnh: `set -e` (và dạng gộp cờ) bật,
// `set +e` tắt; lệnh kiểm chỉ chạy dưới errexit khi trạng thái đang bật ở chỗ nó đứng. `set - <đối số>` xử lý như `set -- <đối số>`.

import { describe, expect, test } from 'claude-code/testing'
import { classifyBash } from '../hooks/lib/drift/classify'

const exitOf = (command: string) => (classifyBash(command).effects.find(e => e.kind === 'check') as { exit?: string } | undefined)?.exit

describe('0.9.0 vòng 2 M7: errexit theo thứ tự câu lệnh', () => {
  test('heredoc có set -e đứng sau lệnh kiểm: lệnh kiểm trước đó không có errexit', () => {
    expect(exitOf("bash <<'SH'\npytest -q\nset -e\necho xong\nSH")).toBe('hidden')
  })
  test('heredoc set -e rồi set +e rồi lệnh kiểm: không có errexit', () => {
    expect(exitOf("bash <<'SH'\nset -e\nset +e\npytest -q\necho xong\nSH")).toBe('hidden')
  })
  test('heredoc set -e rồi lệnh kiểm: có errexit, như trước', () => {
    expect(exitOf("bash <<'SH'\nset -e\npytest -q\necho xong\nSH")).toBe('visible')
  })
  test('set -e; lệnh kiểm; echo xong trên một dòng: có errexit', () => {
    expect(exitOf('set -e; pytest -q; echo xong')).toBe('visible')
  })
  test('set -eu; lệnh kiểm; echo xong (gộp cờ): có errexit', () => {
    expect(exitOf('set -eu; pytest -q; echo xong')).toBe('visible')
  })
  test('lệnh kiểm; echo xong không có set -e: giữ hidden', () => {
    expect(exitOf('pytest -q; echo xong')).toBe('hidden')
  })
  test('set - -o pipefail; lệnh kiểm | tee: không bật pipefail, giữ như K19', () => {
    const effect = classifyBash('set - -o pipefail; pytest -q | tee /tmp/k.log').effects.find(e => e.kind === 'check') as { exit?: string; pipefail?: true } | undefined
    expect(effect?.exit).toBe('hidden')
    expect(effect?.pipefail).toBeUndefined()
  })
})
