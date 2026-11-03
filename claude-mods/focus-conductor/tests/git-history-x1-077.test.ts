// 0.7.7 X1: lệnh git chỉ đổi lịch sử hay cấu hình (add, commit, push, tag, branch, fetch, config, remote, notes, gc) không đổi
// file làm việc, nên không phải "thay đổi" cần kiểm. Lệnh đổi cây làm việc (checkout, restore, reset, pull, merge, rebase,
// switch, stash), lệnh có thay thế lệnh và lệnh ghi file kèm theo vẫn là thay đổi.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { isMutation, newEvidenceLog, newTracker, noteEvidence, observe, summarize } from '../hooks/lib/drift'
import { freshTestRun } from '../hooks/lib/drift/evidence'
import { classifyBash } from '../hooks/lib/drift/classify'
import { bash, edit, makeBrief } from './support/commands'
import { COMPLEX_PROMPT, FOUR, base, submit } from './support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const HISTORY = [
  'git add -A', 'git commit -m x', 'git commit -am x', 'git push', 'git push -u origin main', 'git tag v1', 'git branch -D x',
  'git config user.name x', 'git remote add o u', 'git notes add -m x', 'git gc',
]
const WORKTREE = [
  'git checkout -- a.ts', 'git restore a.ts', 'git reset -- a.ts', 'git pull', 'git merge x', 'git rebase main', 'git switch x', 'git stash',
  'git commit -m "$(date)"', 'echo x > a && git add a', 'git -C dir commit -m x',
]

describe('0.7.7 X1: git không đổi file không còn là thay đổi', () => {
  for (const command of HISTORY) {
    test(`${command} không phải thay đổi`, () => {
      expect(isMutation(bash(command))).toBe(false)
    })
  }

  for (const command of WORKTREE) {
    test(`${command} vẫn là thay đổi`, () => {
      expect(isMutation(bash(command))).toBe(true)
    })
  }

  test('chuỗi git add, commit, push sau lần chạy npm test đạt: vẫn đã kiểm, không cảnh báo chưa kiểm', () => {
    const tracker = newTracker('t')
    const brief = makeBrief()
    observe(tracker, edit('/p/a.ts'), brief, [])
    observe(tracker, bash('npm test', '12 passing (3ms)'), brief, [])
    observe(tracker, bash('git add -A && git commit -m x && git push'), brief, [])
    expect(tracker.isVerified).toBe(true)
    expect(summarize(tracker, brief, []).some(f => f.kind === 'unverified')).toBe(false)
  })

  test('evidence: lần npm test vẫn là lần chạy kiểm mới nhất sau chuỗi git', () => {
    const log = newEvidenceLog(1)
    noteEvidence(log, edit('/p/a.ts'))
    noteEvidence(log, bash('npm test', '12 passing (3ms)'))
    noteEvidence(log, bash('git add -A && git commit -m x'))
    expect(freshTestRun(log)?.command).toContain('npm test')
  })

  test('phân loại vẫn giữ tác động ghi của git để hạn mức tạm dừng còn chặn commit và push', () => {
    for (const command of ['git commit -m x', 'git push']) {
      const effects = classifyBash(command).effects.filter(e => e.kind === 'write')
      expect(effects.length).toBeGreaterThan(0)
    }
  })

  test('tích hợp: bước verified giữ nguyên sau git commit, cuối turn không toast', {}, async ($: Engine, on) => {
    const seen = base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: '12 pass' }))
    on('turn.complete', () => ({ text: '' }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] })
    await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' } as never)
    await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
    await $.tool.call({ tool: 'Bash', command: 'git add -A && git commit -m x' } as never)
    const shown = String((await $.tool.call({ tool: PLAN, action: 'show' })).result)
    expect(shown).toContain('[v] 1. Sửa')
    await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as never)
    expect(seen.toasts.some(t => t.includes('không chạy bước kiểm tra nào') || t.includes('chưa được kiểm tra lại'))).toBe(false)
  })

  test('strictDelegation block: git commit của luồng chính không bị chặn khi còn việc chờ giao', { options: { strictDelegation: 'block' } }, async ($: Engine, on) => {
    base(on)
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }))
    await submit($, FOUR)
    const out = (await $.tool.call({ tool: 'Bash', command: 'git commit -m x' } as never)) as { deny?: string }
    expect(out.deny).toBeUndefined()
  })
})
