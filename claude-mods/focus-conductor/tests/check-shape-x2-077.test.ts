// 0.7.7 X2: pytest -q in dòng tổng kết không viền "=" nên chưa được nhận qua ống; nhận khi viền "=" ở cả hai bên hoặc không bên nào.
// Lệnh kiểm bị loại vì hình dạng (qua ống, che mã thoát, thay thế lệnh) thì nhắc Claude một lần trong phiên cách chạy lại cho mod đọc được.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { applyCheckCommands, newTracker, observe, parseCheckCommands } from '../hooks/lib/drift'
import type { Focus } from '../hooks/lib/drift'
import { bash, edit } from './support/commands'
import { base, submit } from './support/engine'

const PIPED = 'pytest -q 2>&1 | tail -5'
const passes = (output: string) => {
  const tracker = newTracker('t')
  observe(tracker, edit('/p/a.py'), null, [])
  observe(tracker, bash(PIPED, output), null, [])
  return tracker.isVerified
}

describe('0.7.7 X2: pytest -q qua ống', () => {
  for (const output of ['12 passed in 0.50s', '12 passed, 2 skipped in 0.50s', '12 passed, 1 warning in 0.50s', '....\n12 passed in 0.50s']) {
    test(`đạt: ${JSON.stringify(output)}`, () => {
      expect(passes(output)).toBe(true)
    })
  }
  for (const output of ['1 failed, 11 passed in 0.50s', '12 passed in 0.50s ====', '==== 12 passed in 0.50s', '0 passed in 0.01s', '12 passed in 0.50s\nTraceback (most recent call last)']) {
    test(`không đạt: ${JSON.stringify(output)}`, () => {
      expect(passes(output)).toBe(false)
    })
  }
  test('viền "=" cả hai bên vẫn đạt như cũ', () => {
    expect(passes('============ 12 passed in 0.50s ============')).toBe(true)
  })
})

const focus = (hints = new Set<string>()): Focus => ({ goal: 'Sửa module', scopePaths: [], tier: 'complex', hints })
const shapeOf = (command: string, output: string, hints?: Set<string>) =>
  observe(newTracker('t'), bash(command, output), focus(hints), []).find(f => f.hint === 'check-shape')
const JEST = 'Tests:       12 passed, 12 total\nTime:        1.2 s\nRan all test suites.'

describe('0.7.7 X2: lời nhắc check-shape', () => {
  test('npm test qua tail: nhắc, nêu lệnh và lý do, không quá 400 ký tự', () => {
    const found = shapeOf('npm test 2>&1 | tail -20', JEST)
    expect(found?.context).toContain('"npm test"')
    expect(found?.context).toContain('chạy qua ống, mod không đọc được kết quả')
    expect(found?.context).toContain('Không sửa script kiểm')
    expect(found?.context).toContain('một lần trong phiên')
    expect((found?.context ?? '').length).toBeLessThanOrEqual(400)
  })

  test('tsc qua head với output rỗng: nhắc', () => {
    expect(shapeOf('npx tsc --noEmit 2>&1 | head -20', '')).toBeDefined()
  })

  test('npm test; echo done: nhắc với lý do che mã thoát', () => {
    expect(shapeOf('npm test; echo done', JEST)?.context).toContain('bị lệnh đứng sau che mã thoát')
  })

  test('cd "$(git rev-parse --show-toplevel)" && npm test: nhắc với lý do thay thế lệnh', () => {
    expect(shapeOf('cd "$(git rev-parse --show-toplevel)" && npm test', JEST)?.context).toContain('$( )')
  })

  test('lệnh dài: cắt 80 ký tự và vẫn không quá 400 ký tự', () => {
    const found = shapeOf(`npm test -- --reporter=${'x'.repeat(200)} 2>&1 | tail -20`, JEST)
    expect(found?.context).toContain('…')
    expect((found?.context ?? '').length).toBeLessThanOrEqual(400)
  })

  test('output có FAIL: không nhắc', () => {
    expect(shapeOf('npm test 2>&1 | tail -20', 'FAIL src/a.test.ts')).toBeUndefined()
  })

  test('đã nhắc trong phiên: không nhắc lần hai', () => {
    expect(shapeOf('npm test 2>&1 | tail -20', JEST, new Set(['check-shape']))).toBeUndefined()
  })

  test('lời nhắc pipe-summary đã chèn ở cùng quan sát: không nhắc check-shape', () => {
    const RUN = '/usr/bin/python3 -B /repo/tests/check_all.py'
    applyCheckCommands(parseCheckCommands(RUN))
    try {
      const findings = observe(newTracker('t'), bash(`${RUN} 2>&1 | tail -n 5`, 'Đã kiểm 120 dòng\nTiếp tục'), focus(), [])
      expect(findings.some(f => f.hint === 'pipe-summary')).toBe(true)
      expect(findings.some(f => f.hint === 'check-shape')).toBe(false)
    } finally {
      applyCheckCommands([])
    }
  })
})

describe('0.7.7 X2: khóa check-shape chỉ ghi khi lời nhắc được chèn', () => {
  const call = async ($: Engine, input: Record<string, unknown>) => ((await $.tool.call(input as never)).context ?? []).join('\n')
  const isHint = (context: string) => context.includes('Chạy lại riêng lệnh kiểm')

  test('lần đầu thua cảnh báo vượt ngân sách: lần sau vẫn nhắc; đã nhắc thì không nhắc lại', {}, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Read' }, () => ({ result: 'nội dung' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: JEST }))
    await submit($, 'Kiểm dữ liệu các bảng')
    await $.turn.start({ text: 'làm', turnId: 't6' })
    for (let i = 0; i < 14; i++) await call($, { tool: 'Read', file_path: `src/f${i}.ts` })
    const first = await call($, { tool: 'Bash', command: 'npm test 2>&1 | tail -20' })
    expect(first).toContain('vượt mức dự kiến')
    expect(isHint(first)).toBe(false)
    expect(isHint(await call($, { tool: 'Bash', command: 'npm test 2>&1 | tail -20' }))).toBe(true)
    expect(isHint(await call($, { tool: 'Bash', command: 'npm test 2>&1 | tail -20' }))).toBe(false)
  })
})
