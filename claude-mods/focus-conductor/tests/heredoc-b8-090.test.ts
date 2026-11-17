// 0.9.0 B8: khối bash, sh, zsh nhận thân từ heredoc được phân loại theo từng dòng của thân như một chuỗi lệnh: dòng set, gán biến (kể cả gán
// bằng thay thế lệnh chỉ đọc) và cd không là tác động ghi; lệnh kiểm trong thân là lần kiểm với danh tính của chính lệnh đó; dòng ghi file
// cho tác động ghi của dòng đó. Thân có heredoc lồng, eval hay cấu trúc không tách được thì giữ mức possible như 0.8.9.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { approvalDenial } from '../hooks/lib/approval'
import { classifyBash } from '../hooks/lib/drift'
import type { CheckEffect, WriteEffect } from '../hooks/lib/drift/classify'
import { JS } from './fixtures/runner-output'
import { base, plan, step, submit, task } from './support/engine'

/** Khối khởi động và đo nền kiểu mục 7 của một prompt giao việc, với lệnh mẫu. */
export const BLOCK = `bash <<'SH'
set -euo pipefail
ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"
git rev-parse --short HEAD
cd "$ROOT_DIR/mod"
bunx tsc --noEmit -p .
bun test
SH`
const checks = (command: string) => classifyBash(command).effects.filter((e): e is CheckEffect => e.kind === 'check')
const writes = (command: string) => classifyBash(command).effects.filter((e): e is WriteEffect => e.kind === 'write')

describe('0.9.0 B8: thân heredoc đưa vào shell', () => {
  test('khối khởi động: không có tác động ghi; hai lệnh kiểm tsc và bun test, được tin', () => {
    expect(writes(BLOCK)).toEqual([])
    const found = checks(BLOCK)
    expect(found.map(c => c.segment)).toEqual(['bunx tsc --noEmit -p .', 'bun test'])
    expect(found.map(c => c.check)).toEqual(['static', 'test'])
    expect(found.every(c => c.trusted)).toBe(true)
  })
  test('các dạng mở heredoc: không nháy, nháy kép, cờ -e, <<-', () => {
    for (const command of ['bash <<SH\nbun test\nSH', 'sh <<"X"\nbun test\nX', 'bash -e <<\'EOF\'\ncd /a\nbun test\nEOF', 'zsh <<-T\n\tbun test\n\tT']) {
      expect(checks(command).map(c => c.segment), command).toEqual(['bun test'])
      expect(writes(command), command).toEqual([])
    }
  })
  test('dòng ghi file cho tác động ghi của dòng đó', () => {
    const rm = writes("bash <<'SH'\nset -e\nrm -rf /work/x\nbun test\nSH")
    expect(rm.length).toBe(1)
    expect(rm[0]).toMatchObject({ level: 'definite', paths: ['/work/x'] })
    const echo = writes("bash <<'SH'\necho a > /work/out.txt\nSH")
    expect(echo[0]).toMatchObject({ level: 'definite', paths: ['/work/out.txt'] })
  })
  test('heredoc lồng, eval, if hay vòng lặp, thay thế lệnh không chỉ đọc: giữ mức possible', () => {
    for (const command of [
      "bash <<'SH'\ncat > /work/a <<EOF\nx\nEOF\nSH",
      "bash <<'SH'\neval \"$X\"\nSH",
      "bash <<'SH'\nif true; then bun test; fi\nSH",
      "bash <<'SH'\nfor f in a b; do echo $f; done\nSH",
      "bash <<'SH'\nX=\"$(rm -rf y)\"\nSH",
    ]) {
      expect(writes(command).some(w => w.level === 'possible'), command).toBe(true)
    }
  })
  test('đối chứng: bash script.sh vẫn là possible như 0.8.9', () => {
    expect(writes('bash scripts/x.sh').some(w => w.level === 'possible')).toBe(true)
  })
  test('cổng duyệt kế hoạch cho khối khởi động qua; khối có rm -rf thì từ chối', () => {
    expect(approvalDenial('Bash', { command: BLOCK })).toBeNull()
    expect(approvalDenial('Bash', { command: "bash <<'SH'\nset -e\nrm -rf /work/x\nSH" })).not.toBeNull()
  })
})

const PLAN = 'mcp__focus-conductor__plan'
const MAIN = { model: 'sonnet', effort: 'medium', why: '' }

describe('0.9.0 B8: toàn luồng', () => {
  test('vai điều phối từ chối khối khởi động bằng câu dành cho lệnh kiểm', { options: { planApproval: 'off', conductor: 'fable' } }, async ($: Engine, on) => {
    const seen = base(on, { router: () => plan({ goal: 'Sửa', depth: 'substantial', volume: 'medium', kind: 'edit', main: MAIN, tasks: [task('Sửa', 'agent', 'sonnet', 'medium'), task('Kiểm', 'agent', 'sonnet', 'medium')] }) })
    on('tool.call', { tool: 'Bash' }, () => ({ result: JS.bun_pass }))
    await submit($, 'Sửa')
    await step($, seen, { turnId: 't1' })
    const out = (await $.tool.call({ tool: 'Bash', command: BLOCK } as never)) as { deny?: string }
    expect(out.deny ?? '').toContain('vai điều phối không tự chạy lệnh kiểm')
  })
  test('bun test trong khối chạy đạt sau thay đổi cuối: bước done lên verified', { options: { planApproval: 'off' } }, async ($: Engine, on) => {
    base(on, { router: () => plan({ goal: 'Sửa', depth: 'substantial', volume: 'medium', kind: 'edit', main: MAIN }) })
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: `abc1234\n${JS.bun_pass}` }))
    await submit($, 'Sửa')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] })
    await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' } as never)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await $.tool.call({ tool: 'Bash', command: BLOCK } as never)
    expect(String((await $.tool.call({ tool: PLAN, action: 'show' })).result)).toContain('[v] 1. Sửa')
  })
})
