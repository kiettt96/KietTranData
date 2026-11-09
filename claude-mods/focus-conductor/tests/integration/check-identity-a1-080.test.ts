// 0.8.0 A1: danh tính lệnh kiểm khai (checkCommands) theo đường dẫn đã giải. Dạng tương đối sau cd (cùng lệnh hay lần Bash trước), dạng
// tên trần khớp đuôi với đúng một lệnh khai, dạng có biến gán trong cùng lệnh, dạng có tiền tố timeout đều là cùng một lệnh khai: so chữ ký
// W4, coversFailure và danh tính theo dạng đã giải. Thư mục làm việc lưu giữa các lần Bash theo luồng hay agentId (engine không cho trường
// thư mục làm việc của Bash, và $.session.cwd() không theo cd của subagent: đo trên engine 2.1.296 và 2.1.319, xem DESIGN).

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { applyCheckCommands, isMutation, isVerification, newEvidenceLog, noteEvidence, parseCheckCommands } from '../../hooks/lib/drift'
import { checkCommand, coversFailure } from '../../hooks/lib/drift/evidence'
import { base, plan, spawnTool, step, submit } from '../support/engine'
import type { Seen } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const RUN = '/usr/bin/python3 -B /a/tools/check_a.py'
const OTHER = '/usr/bin/python3 -B /b/tools/check_a.py'
const LOG = '/tmp/fc-identity-a1-080.jsonl'
const FAIL = 'K1: CHƯA ĐẠT (3 dòng đỏ)\nTỔNG: CHƯA ĐẠT'
const PASS = 'K1: ĐẠT\nTỔNG: ĐẠT | 4 phép, 0 phép đỏ'

function declared<T>(commands: string, body: () => T): T {
  applyCheckCommands(parseCheckCommands(commands))
  try {
    return body()
  } finally {
    applyCheckCommands([])
  }
}
const observation = (command: string, cwd?: string, isError = false) =>
  ({ tool: 'Bash', input: { command }, isError, isReadOnly: false, output: isError ? FAIL : PASS, ...(cwd !== undefined ? { cwd } : {}) }) as never

/** Dạng lệnh mod lưu cho một lần chạy (checkCommand của entry kiểm đầu tiên). */
function stored(command: string, cwd?: string): string {
  const log = newEvidenceLog(1)
  noteEvidence(log, observation(command, cwd))
  const entry = log.commands.find(c => c.check !== null)
  return entry === undefined ? '' : checkCommand(entry)
}
const covers = (pass: string, fail: string, cwd?: string) =>
  declared(RUN, () => coversFailure({ check: 'test', command: stored(pass, cwd) }, { check: 'test', command: stored(fail) }))

describe('0.8.0 A1: dạng tương đối và dạng tuyệt đối là một lệnh khai', () => {
  test('cd /a/tools && python3 -B check_a.py đạt phủ lệnh khai tuyệt đối lỗi', () => expect(covers('cd /a/tools && python3 -B check_a.py', RUN)).toBe(true))
  test('lệnh khai tuyệt đối đạt phủ dạng cd rồi tương đối lỗi', () => {
    const result = declared(RUN, () => coversFailure({ check: 'test', command: stored(RUN) }, { check: 'test', command: stored('cd /a/tools && python3 -B check_a.py') }))
    expect(result).toBe(true)
  })
})

describe('0.8.0 A1: thư mục làm việc từ lần Bash trước', () => {
  test('python3 -B check_a.py với thư mục /a/tools: là lệnh kiểm, không tính là thay đổi', () => {
    declared(RUN, () => {
      expect(isVerification(observation('python3 -B check_a.py', '/a/tools'))).toBe(true)
      expect(isMutation(observation('python3 -B check_a.py', '/a/tools'))).toBe(false)
    })
  })
  test('dạng đó đạt phủ lệnh khai tuyệt đối lỗi', () => expect(covers('python3 -B check_a.py', RUN, '/a/tools')).toBe(true))
})

describe('0.8.0 A1: tên trần khớp đuôi', () => {
  test('một lệnh khai: python3 -B check_a.py không có thư mục nhận là lệnh khai đó', () => {
    declared(RUN, () => expect(isVerification(observation('python3 -B check_a.py'))).toBe(true))
  })
  test('hai lệnh khai cùng tên file khác thư mục: không nhận', () => {
    declared(`${RUN},${OTHER}`, () => expect(isVerification(observation('python3 -B check_a.py'))).toBe(false))
  })
  test('khớp đuôi theo ranh giới /: xcheck_a.py không khớp check_a.py', () => {
    declared(RUN, () => expect(isVerification(observation('python3 -B xcheck_a.py'))).toBe(false))
  })
})

describe('0.8.0 A1: biến gán trong cùng lệnh', () => {
  for (const command of ['T=/a/tools && /usr/bin/python3 -B "$T/check_a.py"', 'T=/a/tools; python3 -B $T/check_a.py', 'T=/a/tools && python3 -B ${T}/check_a.py']) {
    test(`${command}: là lệnh khai, không tính là thay đổi`, () => {
      declared(RUN, () => {
        expect(isVerification(observation(command))).toBe(true)
        expect(isMutation(observation(command))).toBe(false)
      })
    })
  }
  test('biến không gán trong lệnh: giữ cách xử lý cũ (không nhận)', () => {
    declared(RUN, () => expect(isVerification(observation('python3 -B $T/check_a.py'))).toBe(false))
  })
})

describe('0.8.0 A1: tiền tố timeout mọi dạng', () => {
  for (const prefix of ['timeout 600', 'timeout 10m', 'timeout 1.5h', 'timeout -k 5 600', 'timeout --signal=KILL 600', 'timeout -s TERM 10m']) {
    test(`${prefix} rồi lệnh khai: là lệnh kiểm`, () => {
      declared(RUN, () => {
        expect(isVerification(observation(`${prefix} ${RUN}`))).toBe(true)
        expect(isMutation(observation(`${prefix} ${RUN}`))).toBe(false)
      })
    })
  }
})

const GOAL = plan({ goal: 'Sửa hàm tính phí', depth: 'substantial', volume: 'medium', main: { model: 'sonnet', effort: 'medium' } })

function setup(on: On, failing: Set<string>) {
  const writes: string[] = []
  const seen = base(on, { router: () => GOAL })
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
  on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: `a-${e.tool_use_id}` }))
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    const command = String((e as { command?: unknown }).command ?? '')
    return failing.has(command) ? { result: FAIL, isError: true as const } : { result: command.startsWith('cd ') && !command.includes('&&') ? '' : PASS }
  })
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  on('fs.write', (_$, e) => {
    writes.push(e.text)
    return { value: undefined }
  })
  const lines = () => (writes[writes.length - 1] ?? '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
  return { seen, lines }
}

const bash = ($: Engine, command: string, agentId?: string) => $.tool.call({ tool: 'Bash', command, ...(agentId !== undefined ? { agentId } : {}) } as never)
const stop = async ($: Engine) => String(((await $.classic.Stop({ stop_hook_active: false } as never)) as { block?: string }).block ?? '')

async function start($: Engine, seen: Seen) {
  await submit($, 'Sửa hàm tính phí')
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa hàm tính phí' }] })
  await $.turn.start({ text: 'Sửa hàm tính phí', turnId: 't1' })
  await step($, seen, { turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: 'src/phi.py', old_string: 'a', new_string: 'b' } as never)
}

const OPTIONS = { options: { checkCommands: RUN, decisionLog: LOG } }

describe('0.8.0 A1: đầu cuối', () => {
  test('lệnh khai lỗi, rồi chạy lại dạng tương đối sau cd và đạt: Stop không chặn, không có dòng retry', { ...OPTIONS, options: { ...(OPTIONS as { options?: Record<string, unknown> }).options, planApproval: 'off' } }, async ($, on) => {
    const { seen, lines } = setup(on, new Set([RUN]))
    await start($, seen)
    await bash($, RUN)
    await bash($, 'cd /a/tools && python3 -B check_a.py')
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    expect(await stop($)).toBe('')
    expect(lines().some(l => l['kind'] === 'retry')).toBe(false)
  })

  test('hai lần Bash tách nhau: cd /a/tools rồi python3 -B check_a.py đạt phủ lần lỗi', { ...OPTIONS, options: { ...(OPTIONS as { options?: Record<string, unknown> }).options, planApproval: 'off' } }, async ($, on) => {
    const { seen } = setup(on, new Set([RUN]))
    await start($, seen)
    await bash($, RUN)
    await bash($, 'cd /a/tools')
    await bash($, 'python3 -B check_a.py')
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    expect(await stop($)).toBe('')
  })

  test('hai lệnh khai cùng tên file: cd /a/tools ở lần Bash trước rồi python3 -B check_a.py vẫn nhận đúng lệnh khai /a/tools', { options: { planApproval: 'off', checkCommands: `${RUN},${OTHER}`, decisionLog: LOG } }, async ($, on) => {
    const { seen } = setup(on, new Set([RUN]))
    await start($, seen)
    await bash($, RUN)
    await bash($, 'cd /a/tools')
    await bash($, 'python3 -B check_a.py')
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    expect(await stop($)).toBe('')
  })

  test('đối chứng cố ý đỏ do subagent chạy, rồi luồng chính chạy lại dạng khác đường dẫn và đạt: mục W4 được xóa, không chặn', { ...OPTIONS, options: { ...(OPTIONS as { options?: Record<string, unknown> }).options, planApproval: 'off' } }, async ($, on) => {
    const { seen } = setup(on, new Set([RUN]))
    await start($, seen)
    await spawnTool($, 'u1', 'Chạy đối chứng đỏ', `Chạy ${RUN}`)
    await bash($, RUN, 'a-u1')
    await bash($, 'cd /a/tools && python3 -B check_a.py')
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    expect(await stop($)).toBe('')
  })
})
