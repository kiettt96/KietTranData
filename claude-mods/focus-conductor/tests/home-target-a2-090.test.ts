// 0.9.0 A2: đích mở đầu `~/` hay `$HOME/` (cả `${HOME}/`) của cp, mv và chuyển hướng ghi được đọc thành đường dẫn dưới thư mục nhà. Đích
// có đuôi tài liệu nhẹ không là thay đổi chắc chắn vào file không nhẹ; đích `.ts` dưới `~/` vẫn là. `~user/x` và `$OTHER/x` giữ là không
// đọc được. Engine cho biết thư mục nhà (biến HOME) thì đích được giải thành đường dẫn tuyệt đối; không cho thì giữ dạng `~/...`.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import * as C from '../hooks/lib/drift/classify'
import type { WriteEffect } from '../hooks/lib/drift/classify'
import { isHardEffect } from '../hooks/lib/drift/soft'
import { scopeStatus } from '../hooks/lib/drift/scope'
import { base, plan, step, submit } from './support/engine'
import type { Seen } from './support/engine'

const writes = (command: string) => C.classifyBash(command).effects.filter((e): e is WriteEffect => e.kind === 'write')
function withHome<T>(home: string | null, body: () => T): T {
  ;(C as { applyHome?: (home: string | null) => void }).applyHome?.(home)
  try {
    return body()
  } finally {
    ;(C as { applyHome?: (home: string | null) => void }).applyHome?.(null)
  }
}

describe('0.9.0 A2: đích dưới thư mục nhà', () => {
  test('cp ~/.claude/a.md ~/.claude/sao-luu/a.md: đích đọc được, không là thay đổi chắc chắn', () => {
    const [effect] = writes('cp ~/.claude/a.md ~/.claude/sao-luu/a.md')
    expect(effect?.isUnknown).toBe(false)
    expect(effect?.paths).toContain('~/.claude/sao-luu/a.md')
    expect(effect !== undefined && isHardEffect(effect)).toBe(false)
  })
  test('mv và chuyển hướng ghi với $HOME/ và ${HOME}/: đích đọc được, đuôi .md là nhẹ', () => {
    for (const command of ['mv /tmp/x.md $HOME/notes/x.md', 'echo a > ${HOME}/notes/log.txt', 'echo a >> "$HOME/notes/b.md"']) {
      const [effect] = writes(command)
      expect(effect?.isUnknown, command).toBe(false)
      expect(effect !== undefined && isHardEffect(effect), command).toBe(false)
    }
  })
  test('đích .ts dưới ~/ vẫn là thay đổi chắc chắn, đích đọc được', () => {
    const [effect] = writes('cp /tmp/a.ts ~/proj/src/a.ts')
    expect(effect?.isUnknown).toBe(false)
    expect(effect?.paths).toContain('~/proj/src/a.ts')
    expect(effect !== undefined && isHardEffect(effect)).toBe(true)
  })
  test('~user/x và $OTHER/x giữ là không đọc được', () => {
    for (const command of ['cp a.md ~alice/x.md', 'cp a.md $OTHER/x.md', 'cp a.md ~', 'cp a.md $HOME', 'cp a.md ~/$X/a.md', 'cp a.md ~/../etc/a.md']) {
      const [effect] = writes(command)
      expect(effect?.isUnknown, command).toBe(true)
    }
  })
  test('biết thư mục nhà: ~/ và $HOME/ giải thành đường dẫn tuyệt đối', () => {
    withHome('/home/me', () => {
      expect(writes('cp a.md ~/b/c.md')[0]?.paths).toEqual(['/home/me/b/c.md'])
      expect(writes('cp a.md $HOME/b/c.md')[0]?.paths).toEqual(['/home/me/b/c.md'])
    })
  })
})

const PLAN = 'mcp__focus-conductor__plan'
const GOAL = plan({ goal: 'Sao lưu ghi chú', depth: 'substantial', volume: 'medium', main: { model: 'sonnet', effort: 'medium' } })
const OPTIONS = { options: { checkCommands: 'bun test', planApproval: 'off' } }
const stop = async ($: Engine) => String(((await $.classic.Stop({ stop_hook_active: false } as never)) as { block?: string }).block ?? '')

function setup(on: On): Seen {
  const seen = base(on, { router: () => GOAL })
  on('tool.call', { tool: 'Bash' }, () => ({ result: '' }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  return seen
}

describe('0.9.0 A2: phạm vi của đích chưa giải', () => {
  test('~/x.md với phạm vi src và gốc /repo: không khẳng định (unknown)', () => {
    expect(scopeStatus('~/x.md', ['src'], '/repo')).toBe('unknown')
  })
})

describe('0.9.0 A2: toàn luồng từ prompt.submit tới classic.Stop', () => {
  test('cp tài liệu vào ~/: cổng Stop không đòi chạy kiểm', OPTIONS, async ($, on) => {
    const seen = setup(on)
    await submit($, 'Sao lưu ghi chú')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sao lưu ghi chú' }] })
    await $.turn.start({ text: 'Sao lưu ghi chú', turnId: 't1' })
    await step($, seen, { turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'cp ~/.claude/a.md ~/.claude/sao-luu/a.md' } as never)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    expect(await stop($)).not.toContain('chưa chạy lần kiểm nào')
  })
  test('đối chứng: cp tệp .ts vào ~/ thì cổng Stop đòi chạy kiểm', OPTIONS, async ($, on) => {
    const seen = setup(on)
    await submit($, 'Sao lưu ghi chú')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sao lưu ghi chú' }] })
    await $.turn.start({ text: 'Sao lưu ghi chú', turnId: 't1' })
    await step($, seen, { turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'cp /tmp/a.ts ~/proj/src/a.ts' } as never)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    expect(await stop($)).toContain('chưa chạy lần kiểm nào')
  })
})
