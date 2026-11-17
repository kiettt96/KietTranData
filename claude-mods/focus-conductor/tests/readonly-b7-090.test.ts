// 0.9.0 B7: lệnh đo chỉ đọc. shasum, sha256sum, sha1sum, md5, md5sum, cksum, cmp, comm, `command -v`, `bash -n`, `sh -n` là lệnh chỉ đọc
// khi không có chuyển hướng ghi; `shasum -c` vẫn chỉ đọc. Kèm `> tệp` là ghi. Cổng duyệt kế hoạch và vai điều phối cho các lệnh này qua.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { approvalDenial } from '../hooks/lib/approval'
import { classifyBash, isReadOnlyCommand } from '../hooks/lib/drift'
import { base, plan, step, submit, task } from './support/engine'

const READS = [
  'shasum -a 256 /work/a.md',
  'sha256sum /work/a.md /work/b.md',
  'sha1sum a.txt',
  'md5 a.txt',
  'md5sum a.txt',
  'cksum a.txt',
  'cmp a.bin b.bin',
  'comm -12 a.txt b.txt',
  'command -v bun',
  'bash -n scripts/x.sh',
  'sh -n scripts/x.sh',
  'shasum -c /work/SHA256SUMS',
]
const writes = (command: string) => classifyBash(command).effects.filter(e => e.kind === 'write')

describe('0.9.0 B7: lệnh đo chỉ đọc', () => {
  for (const command of READS) {
    test(`chỉ đọc: ${command}`, () => {
      expect(isReadOnlyCommand(command)).toBe(true)
      expect(writes(command)).toEqual([])
      expect(approvalDenial('Bash', { command })).toBeNull()
    })
    test(`kèm > tệp là ghi: ${command} > /work/out.txt`, () => {
      const out = `${command} > /work/out.txt`
      expect(isReadOnlyCommand(out)).toBe(false)
      expect(writes(out).length).toBeGreaterThan(0)
      expect(approvalDenial('Bash', { command: out })).not.toBeNull()
    })
  }
  test('đối chứng: bash script.sh và sh -c vẫn không phải chỉ đọc', () => {
    expect(isReadOnlyCommand('bash scripts/x.sh')).toBe(false)
    expect(isReadOnlyCommand('sh -c "rm -rf x"')).toBe(false)
    expect(isReadOnlyCommand('bash -n -c "x"')).toBe(false)
    expect(isReadOnlyCommand('command rm -rf x')).toBe(false)
  })
})

describe('0.9.0 B7: vai điều phối cho lệnh đo qua', () => {
  test('shasum, cmp, command -v, bash -n không bị từ chối khi luồng chính điều phối', { options: { planApproval: 'off', conductor: 'fable' } }, async ($: Engine, on) => {
    const MAIN = { model: 'sonnet', effort: 'medium', why: '' }
    const seen = base(on, { router: () => plan({ goal: 'Sửa', depth: 'substantial', volume: 'medium', kind: 'edit', main: MAIN, tasks: [task('Sửa', 'agent', 'sonnet', 'medium'), task('Kiểm', 'agent', 'sonnet', 'medium')] }) })
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }))
    await submit($, 'Sửa')
    await step($, seen, { turnId: 't1' })
    for (const command of ['shasum -a 256 /work/a.md', 'cmp a b', 'command -v bun', 'bash -n x.sh']) {
      const out = (await $.tool.call({ tool: 'Bash', command } as never)) as { deny?: string }
      expect(out.deny, command).toBeUndefined()
    }
  })
})
