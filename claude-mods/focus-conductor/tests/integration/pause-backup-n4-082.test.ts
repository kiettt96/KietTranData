// 0.8.2 N4: pauseBackup. Khi dừng cứng vì hạn mức và sao lưu bật (on, hay auto trên phiên cloud), luồng chính được thêm tối đa
// 6 lời gọi Bash git add, git commit -m, git push origin HEAD:<tên>-wip trong một lần dừng; mọi dạng khác bị từ chối như cũ.
// Kết quả push được ghi vào điểm dừng và hiện ở /conductor status và pane.

import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { QuotaCheckpoint } from '../../types'
import { storeKey } from '../../hooks/lib/checkpoint'
import { COMPLEX_PROMPT, PANE, base, conductor, submit } from '../support/engine'
import { memoryStore, quotaMeter, week } from '../support/quota'

type Out = { deny?: string; result?: unknown }
const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never) as Promise<Out>

type BashReply = { stdout?: string; stderr?: string; isError?: boolean }

/** "Engine" trả lời Bash: mặc định thành công, rỗng; `reply` đổi được giữa chừng. */
function engineBash(on: Parameters<typeof base>[0]) {
  const box: { reply: BashReply; ran: string[] } = { reply: {}, ran: [] }
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    box.ran.push(String((e as unknown as { command?: unknown }).command ?? ''))
    const r = box.reply
    return { result: { stdout: r.stdout ?? '', stderr: r.stderr ?? '', interrupted: false }, ...(r.isError ? { isError: true } : {}) } as never
  })
  return box
}

/** Dừng cứng vì hạn mức tuần, mục tiêu lớn, không cổng duyệt kế hoạch. */
async function paused($: Engine, on: Parameters<typeof base>[0], env?: Record<string, string>) {
  base(on)
  if (env !== undefined) mock.env(on, env)
  const box = memoryStore(on)
  quotaMeter(on, [week(99)])
  const ran = engineBash(on)
  await submit($, COMPLEX_PROMPT)
  return { box, ran }
}

const ON = { options: { planApproval: 'off', pauseBackup: 'on' } }

describe('0.8.2 N4: lệnh sao lưu được qua', () => {
  test('pauseBackup on: git add -u, git add đường dẫn, git commit -m, git push lên nhánh -wip đều qua', ON, async ($, on) => {
    const { ran } = await paused($, on)
    expect((await bash($, 'git add -u')).deny).toBeUndefined()
    expect((await bash($, 'git add hooks/a.ts')).deny).toBeUndefined()
    expect((await bash($, 'git commit -m "wip"')).deny).toBeUndefined()
    expect((await bash($, 'git push origin HEAD:feat-x-wip')).deny).toBeUndefined()
    expect(ran.ran).toEqual(['git add -u', 'git add hooks/a.ts', 'git commit -m "wip"', 'git push origin HEAD:feat-x-wip'])
  })

  test('câu từ chối nêu cách sao lưu khi bật, không nêu khi tắt', ON, async ($, on) => {
    await paused($, on)
    const deny = (await bash($, 'npm test')).deny ?? ''
    expect(deny).toContain('Tạm dừng')
    expect(deny).toContain('git push origin HEAD:<nhánh hiện tại>-wip')
  })
})

describe('0.8.2 N4: dạng khác vẫn bị từ chối', () => {
  const REFUSED = [
    'git push --force origin HEAD:feat-x-wip',
    'git push -u origin HEAD:feat-x-wip',
    'git push origin +HEAD:feat-x-wip',
    'git push origin HEAD:main',
    'git push origin HEAD:main-wip',
    'git push origin HEAD:feat-x',
    'git commit --amend -m x',
    'git commit -a -m x',
    'git add .',
    'git add .focus-conductor/decisions.jsonl',
    'git add /tmp/x',
    'git push origin HEAD:feat-x-wip && rm -rf hooks',
    'git commit -m "$(cat /etc/passwd)"',
    'eval git push origin HEAD:feat-x-wip',
    'sh -c "git push origin HEAD:feat-x-wip"',
  ]
  test('cờ, +, nhánh không -wip, main-wip, --amend, -a, ., .focus-conductor/, ngoài gốc, lệnh ghép bị từ chối', ON, async ($, on) => {
    const { ran } = await paused($, on)
    for (const command of REFUSED) expect([command, (await bash($, command)).deny ?? '']).toEqual([command, expect.stringContaining('Tạm dừng')])
    expect(ran.ran).toEqual([])
  })

  test('lời gọi thứ 7 trong một lần dừng bị từ chối', ON, async ($, on) => {
    const { ran } = await paused($, on)
    for (let i = 0; i < 6; i++) expect((await bash($, i % 2 === 0 ? 'git add -u' : 'git commit -m "wip"')).deny).toBeUndefined()
    expect((await bash($, 'git push origin HEAD:feat-x-wip')).deny).toContain('Tạm dừng')
    expect(ran.ran.length).toBe(6)
  })

  test('subagent: không được sao lưu', ON, async ($, on) => {
    const { ran } = await paused($, on)
    const out = (await $.tool.call({ tool: 'Bash', command: 'git add -u', agentId: 'agent-1' } as never)) as Out
    expect(out.deny).toContain('Tạm dừng')
    expect(ran.ran).toEqual([])
  })
})

describe('0.8.2 N4: off và auto', () => {
  test('pauseBackup off: như trước, git bị từ chối và câu từ chối không nêu sao lưu', { options: { planApproval: 'off', pauseBackup: 'off' } }, async ($, on) => {
    const { ran } = await paused($, on, { CLAUDE_CODE_REMOTE: 'true' })
    const out = await bash($, 'git add -u')
    expect(out.deny).toContain('Không gọi tool nào khác.')
    expect(out.deny).not.toContain('pauseBackup')
    expect((await bash($, 'git push origin HEAD:feat-x-wip')).deny).toContain('Tạm dừng')
    expect(ran.ran).toEqual([])
  })

  test('auto, engine không báo phiên cloud: như off', { options: { planApproval: 'off' } }, async ($, on) => {
    const { ran } = await paused($, on, {})
    const out = await bash($, 'git push origin HEAD:feat-x-wip')
    expect(out.deny).toContain('Tạm dừng')
    expect(out.deny).not.toContain('pauseBackup')
    expect(ran.ran).toEqual([])
  })

  test('auto, CLAUDE_CODE_REMOTE rỗng: như off', { options: { planApproval: 'off' } }, async ($, on) => {
    const { ran } = await paused($, on, { CLAUDE_CODE_REMOTE: '' })
    expect((await bash($, 'git add -u')).deny).toContain('Tạm dừng')
    expect(ran.ran).toEqual([])
  })

  test('auto, engine báo phiên cloud: như on', { options: { planApproval: 'off' } }, async ($, on) => {
    const { ran } = await paused($, on, { CLAUDE_CODE_REMOTE: 'true' })
    expect((await bash($, 'git add -u')).deny).toBeUndefined()
    expect((await bash($, 'git push origin HEAD:feat-x-wip')).deny).toBeUndefined()
    expect((await bash($, 'git push --force origin HEAD:feat-x-wip')).deny).toContain('pauseBackup')
    expect(ran.ran.length).toBe(2)
  })
})

describe('0.8.2 N4: điểm dừng ghi kết quả sao lưu', () => {
  const stored = (box: { data: Map<string, unknown> }) => box.data.get(storeKey('/repo')) as QuotaCheckpoint | undefined

  test('đã push: nhánh và hash, hiện ở /conductor status và pane', ON, async ($, on) => {
    const { box, ran } = await paused($, on)
    ran.reply = { stderr: 'To example.invalid:team/app.git\n   1a2b3c4..5d6e7f8  HEAD -> feat-x-wip\n' }
    expect((await bash($, 'git push origin HEAD:feat-x-wip')).deny).toBeUndefined()
    expect(stored(box)?.backup).toMatchObject({ status: 'pushed', branch: 'feat-x-wip', hash: '5d6e7f8' })
    expect(String((await conductor($, 'status')).text)).toContain('sao lưu: đã push lên feat-x-wip (5d6e7f8)')
    const pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: /Sao lưu: đã push lên feat-x-wip/ })).toBeDefined()
    await pane.unmount()
  })

  test('đã push lên nhánh mới: không có hash', ON, async ($, on) => {
    const { box, ran } = await paused($, on)
    ran.reply = { stderr: 'To example.invalid:team/app.git\n * [new branch]      HEAD -> feat-x-wip\n' }
    await bash($, 'git push origin HEAD:feat-x-wip')
    const backup = stored(box)?.backup
    expect(backup).toMatchObject({ status: 'pushed', branch: 'feat-x-wip' })
    expect(backup && 'hash' in backup).toBe(false)
  })

  test('bỏ qua: không có remote, không phải git repo', ON, async ($, on) => {
    const { box, ran } = await paused($, on)
    ran.reply = { stderr: "fatal: 'origin' does not appear to be a git repository\nfatal: Could not read from remote repository.", isError: true }
    await bash($, 'git push origin HEAD:feat-x-wip')
    expect(stored(box)?.backup).toMatchObject({ status: 'skipped', reason: 'no-remote' })
    expect(String((await conductor($, 'status')).text)).toContain('sao lưu: bỏ qua (không có remote)')
    ran.reply = { stderr: 'fatal: not a git repository (or any of the parent directories): .git', isError: true }
    await bash($, 'git push origin HEAD:feat-x-wip')
    expect(stored(box)?.backup).toMatchObject({ status: 'skipped', reason: 'no-repo' })
  })

  test('lỗi: thông điệp đã che bí mật và cắt ngắn', ON, async ($, on) => {
    const { box, ran } = await paused($, on)
    const long = 'x'.repeat(400)
    ran.reply = { stderr: `To https://bot:mat-khau-7731@example.invalid/app.git\n ! [rejected]        HEAD -> feat-x-wip (fetch first)\nerror: failed to push some refs ${long}`, isError: true }
    await bash($, 'git push origin HEAD:feat-x-wip')
    const backup = stored(box)?.backup
    expect(backup?.status).toBe('error')
    const message = backup?.status === 'error' ? backup.message : ''
    expect(message).toContain('[rejected]')
    expect(message.length).toBeLessThanOrEqual(160)
    expect(JSON.stringify(stored(box))).not.toContain('mat-khau-7731')
    expect(String((await conductor($, 'status')).text)).toContain('sao lưu: lỗi: ! [rejected]')
  })

  test('chưa push: điểm dừng không có backup', ON, async ($, on) => {
    const { box } = await paused($, on)
    await bash($, 'git add -u')
    expect(stored(box)?.backup).toBeUndefined()
    expect(String((await conductor($, 'status')).text)).not.toContain('sao lưu')
  })
})
