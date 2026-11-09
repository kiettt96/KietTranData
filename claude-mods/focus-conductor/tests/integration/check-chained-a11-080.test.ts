// 0.8.0 A11: lệnh kiểm có đoạn nối && đứng sau (khác đoạn chỉ in hay đổi thư mục) có mức thoát `chained`. Mã thoát 0: đạt như visible.
// Mã thoát khác 0: kết quả chưa rõ, không tạo, không cập nhật, không xóa mục W4, không tính là đạt; mod chèn một câu đề nghị chạy riêng lệnh
// kiểm (một lần mỗi danh tính lệnh mỗi turn) và ghi nhật ký check-chained. Lệnh kiểm đứng cuối, hay chỉ có đoạn trung tính đứng sau, giữ visible.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { applyCheckCommands, classifyBash, parseCheckCommands } from '../../hooks/lib/drift'
import { base, plan, step, submit } from '../support/engine'
import type { Seen } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const RUN = '/usr/bin/python3 -B /a/tools/check_a.py'
const LOG = '/tmp/fc-chained-a11-080.jsonl'
const FAIL = 'K1: CHƯA ĐẠT (3 dòng đỏ)\nTỔNG: CHƯA ĐẠT'
const PASS = 'K1: ĐẠT\nTỔNG: ĐẠT'
const MISSING = 'ls: cannot access /a/out/missing.txt: No such file or directory'
const GOAL = plan({ goal: 'Sửa hàm tính phí', depth: 'substantial', volume: 'medium', main: { model: 'sonnet', effort: 'medium' } })

function exitOf(command: string): string | undefined {
  applyCheckCommands(parseCheckCommands(RUN))
  try {
    const effect = classifyBash(command).effects.find(e => e.kind === 'check')
    return effect?.kind === 'check' ? effect.exit : undefined
  } finally {
    applyCheckCommands([])
  }
}

describe('0.8.0 A11: mức thoát của lệnh kiểm nối &&', () => {
  test('lệnh khai rồi && ls: chained', () => expect(exitOf(`${RUN} && ls /a/out/missing.txt`)).toBe('chained'))
  test('lệnh khai rồi && echo xong: visible (đoạn chỉ in)', () => expect(exitOf(`${RUN} && echo xong`)).toBe('visible'))
  test('cd rồi lệnh khai: visible như cũ', () => expect(exitOf(`cd /a/tools && ${RUN}`)).toBe('visible'))
  test('lệnh khai rồi ; hay || giữ hidden', () => {
    expect(exitOf(`${RUN}; ls /a/out`)).toBe('hidden')
    expect(exitOf(`${RUN} || ls /a/out`)).toBe('hidden')
  })
})

/** Bash trả theo bảng lệnh: [output, lỗi]. Lệnh không có trong bảng thì đạt với output PASS. */
function setup(on: On, table: Map<string, [string, boolean]>) {
  const writes: string[] = []
  const seen = base(on, { router: () => GOAL })
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    const command = String((e as { command?: unknown }).command ?? '')
    const [result, isError] = table.get(command) ?? [PASS, false]
    return isError ? { result, isError: true as const } : { result }
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

const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never) as Promise<{ context?: string[] }>
const stop = async ($: Engine) => String(((await $.classic.Stop({ stop_hook_active: false } as never)) as { block?: string }).block ?? '')

async function start($: Engine, seen: Seen) {
  await submit($, 'Sửa hàm tính phí')
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa hàm tính phí' }] })
  await $.turn.start({ text: 'Sửa hàm tính phí', turnId: 't1' })
  await step($, seen, { turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: 'src/phi.py', old_string: 'a', new_string: 'b' } as never)
}

const OPTIONS = { options: { checkCommands: RUN, decisionLog: LOG } }
const OPTIONS_PA_OFF = { ...OPTIONS, options: { ...OPTIONS.options, planApproval: 'off' } }
const CHAINED = `${RUN} && ls /a/out/missing.txt`

describe('0.8.0 A11: đầu cuối', () => {
  test('lệnh ghép mã thoát 1: không có mục W4, có câu đề nghị chạy riêng và dòng check-chained', OPTIONS, async ($, on) => {
    const { seen, lines } = setup(on, new Map([[CHAINED, [`${PASS}\n${MISSING}`, true]]]))
    await start($, seen)
    const out = await bash($, CHAINED)
    const notes = (out.context ?? []).filter(c => c.includes('chạy riêng'))
    expect(notes.length).toBe(1)
    expect(notes[0]?.length ?? 0).toBeLessThanOrEqual(160)
    expect(notes[0]).toContain('check_a.py')
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    expect(await stop($)).not.toContain('2/3')
    expect(lines().some(l => l['kind'] === 'retry')).toBe(false)
    expect(lines().some(l => l['kind'] === 'check-chained')).toBe(true)
  })

  test('câu đề nghị chạy riêng chỉ một lần mỗi lệnh mỗi turn', OPTIONS, async ($, on) => {
    const { seen } = setup(on, new Map([[CHAINED, [`${PASS}\n${MISSING}`, true]]]))
    await start($, seen)
    await bash($, CHAINED)
    const again = await bash($, CHAINED)
    expect((again.context ?? []).some(c => c.includes('chạy riêng'))).toBe(false)
  })

  test('lệnh ghép mã thoát 1 không tính là đạt: Y6 vẫn đòi chạy lệnh kiểm', OPTIONS_PA_OFF, async ($, on) => {
    const { seen } = setup(on, new Map([[CHAINED, [`${PASS}\n${MISSING}`, true]]]))
    await start($, seen)
    await bash($, CHAINED)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    expect(await stop($)).toContain('check_a.py')
  })

  test('lệnh khai rồi && echo xong, mã thoát 0: đạt, Stop không chặn', OPTIONS, async ($, on) => {
    const { seen } = setup(on, new Map())
    await start($, seen)
    await bash($, `${RUN} && echo xong`)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    expect(await stop($)).toBe('')
  })

  test('cd rồi lệnh khai, mã thoát 1: lỗi như cũ, Stop chặn lượt 2/3', OPTIONS_PA_OFF, async ($, on) => {
    const { seen } = setup(on, new Map([[`cd /a/tools && ${RUN}`, [FAIL, true]]]))
    await start($, seen)
    await bash($, `cd /a/tools && ${RUN}`)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    expect(await stop($)).toContain('2/3')
  })

  test('mục W4 đang sống rồi lệnh ghép mã thoát khác 0: mục giữ nguyên, lỗi cuối không đổi', OPTIONS_PA_OFF, async ($, on) => {
    const { seen } = setup(on, new Map<string, [string, boolean]>([[RUN, [FAIL, true]], [CHAINED, [`${PASS}\n${MISSING}`, true]]]))
    await start($, seen)
    await bash($, RUN)
    await bash($, CHAINED)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    const reason = await stop($)
    expect(reason).toContain('2/3')
    expect(reason).toContain('CHƯA ĐẠT')
    expect(reason).not.toContain('missing.txt')
  })
})
