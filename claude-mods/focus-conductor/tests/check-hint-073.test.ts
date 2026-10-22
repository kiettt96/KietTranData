// 0.7.3 điểm 2: gợi ý option checkCommands tới người dùng (toast một lần mỗi mục tiêu, một dòng trong pane, một dòng trong
// /conductor status), không chỉ tới Claude. Chuỗi gợi ý ở dạng sẽ khớp sau điểm 1 (`python3 tests/`), không chép nguyên
// `/usr/bin/python3 -B ...`. Chỉ gợi ý, không tự khai.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { checkKindOf, newEvidenceLog, noteEvidence, suggestCheckCommands } from '../hooks/lib/drift'
import * as drift from '../hooks/lib/drift'
import { bash, edit } from './support/commands'
import { COMPLEX_PROMPT, PANE, base, conductor, submit } from './support/engine'

function logOf(...runs: string[]) {
  const log = newEvidenceLog(1)
  noteEvidence(log, edit())
  for (const run of runs) noteEvidence(log, bash(run))
  return log
}

describe('0.7.3 điểm 2: chuỗi gợi ý ở dạng sẽ khớp', () => {
  test('đường dẫn đầy đủ của python và cờ không giá trị được bỏ: gợi ý tên ngắn', () => {
    expect(suggestCheckCommands(logOf('/usr/bin/python3 -B tests/a-check.py --final'))).toEqual(['python3 tests/a-check.py'])
    expect(suggestCheckCommands(logOf('/usr/local/bin/python3 -u -B tests/a-check.py'))).toEqual(['python3 tests/a-check.py'])
  })

  test('từ hai script cùng một thư mục (cùng trình thông dịch): gợi ý tiền tố thư mục', () => {
    expect(suggestCheckCommands(logOf('/usr/bin/python3 -B tests/a-check.py', '/usr/bin/python3 -B tests/b-check.py'))).toEqual(['python3 tests/'])
  })

  test('cùng một script chạy hai lần không phải hai script: gợi ý nguyên script', () => {
    expect(suggestCheckCommands(logOf('python3 tests/a-check.py', 'python3 tests/a-check.py --final'))).toEqual(['python3 tests/a-check.py'])
  })

  test('thư mục khác nhau hay trình thông dịch khác nhau thì không gom', () => {
    expect(suggestCheckCommands(logOf('python3 tests/a-check.py', 'python3 other/b-check.py'))).toEqual(['python3 other/b-check.py', 'python3 tests/a-check.py'])
    expect(suggestCheckCommands(logOf('python3 tests/a-check.py', 'node tests/b-check.mjs'))).toEqual(['node tests/b-check.mjs', 'python3 tests/a-check.py'])
  })

  test('script không có thư mục không gom (hành vi 0.5.6 giữ nguyên)', () => {
    expect(suggestCheckCommands(logOf('python3 a.py', 'python3 b.py'))).toEqual(['python3 b.py', 'python3 a.py'])
  })

  test('nhóm thư mục xếp cùng các ứng viên khác, tối đa hai gợi ý', () => {
    // Cùng mức ưu tiên thì gần nhất trước: nhóm tính theo lần chạy gần nhất của các script trong nhóm.
    expect(suggestCheckCommands(logOf('python3 third/c-check.py', 'python3 other/run-check.py', 'python3 tests/a-check.py', 'python3 tests/b-check.py'))).toEqual(['python3 tests/', 'python3 other/run-check.py'])
    expect(suggestCheckCommands(logOf('python3 tests/a-check.py', 'python3 tests/b-check.py', 'python3 other/run-check.py', 'python3 third/c-check.py'))).toEqual(['python3 third/c-check.py', 'python3 other/run-check.py'])
  })

  test('nhóm thư mục: mức ưu tiên lấy script tốt nhất, độ mới lấy lần chạy gần nhất của các script trong nhóm', () => {
    // Nhóm có một script tên kiểm và một script tên thường: nhóm mang mức của script tên kiểm (mức 0), xếp trước đối thủ cũ hơn cùng mức 0.
    expect(suggestCheckCommands(logOf('python3 other/run-check.py', 'python3 tests/a-check.py', 'python3 tests/build.py'))).toEqual(['python3 tests/', 'python3 other/run-check.py'])
    // Nhóm mang lần chạy gần nhất của các script trong nhóm: script cũ của nhóm không kéo nhóm xuống dưới đối thủ ở giữa.
    expect(suggestCheckCommands(logOf('python3 tests/a-check.py', 'python3 other/run-check.py', 'python3 tests/b-check.py'))).toEqual(['python3 tests/', 'python3 other/run-check.py'])
  })

  test('khai đúng chuỗi gợi ý thì lệnh đã chạy được nhận là lệnh kiểm (vòng khép kín với điểm 1)', () => {
    for (const run of [['/usr/bin/python3 -B tests/a-check.py'], ['/usr/bin/python3 -B tests/a-check.py', '/usr/bin/python3 -B tests/b-check.py']]) {
      const suggestion = suggestCheckCommands(logOf(...run))[0] ?? ''
      drift.applyCheckCommands(drift.parseCheckCommands(suggestion))
      try {
        expect(checkKindOf(run[0] ?? ''), suggestion).toBe('test')
      } finally {
        drift.applyCheckCommands([])
      }
    }
  })
})

describe('0.7.3 điểm 2: gợi ý tới người dùng trong phiên', () => {
  const PLAN = 'mcp__focus-conductor__plan'
  const SCRIPT = 'cd /repo && /usr/bin/python3 -B tests/a-check.py'
  const editFile = ($: Engine, path = 'src/a.ts') => $.tool.call({ tool: 'Edit', file_path: path, old_string: 'a', new_string: 'b' } as never)
  const runScript = ($: Engine, command = SCRIPT) => $.tool.call({ tool: 'Bash', command } as never)
  const hints = (toasts: string[]) => toasts.filter(t => t.includes('checkCommands'))

  /** Mục tiêu có script kiểm đã chạy thành công (chưa khai) rồi các lần sửa cho tới checkpoint thay đổi liên tiếp chưa kiểm. */
  async function untilCheckpoint($: Engine, on: Parameters<typeof base>[0], options: { many?: boolean } = {}) {
    const seen = base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'RESULT: 47 passed, 0 failed' }))
    on('turn.complete', () => ({ text: '' }))
    await submit($, COMPLEX_PROMPT)
    await runScript($)
    for (let i = 0; i < (options.many === true ? 12 : 4); i++) await editFile($, `src/f${i}.ts`)
    return seen
  }

  test('đến checkpoint: toast nêu option checkCommands và chuỗi gợi ý dạng chuẩn, không chép nguyên đường dẫn đầy đủ', {}, async ($, on) => {
    const seen = await untilCheckpoint($, on)
    const found = hints(seen.toasts)
    expect(found.length).toBe(1)
    expect(found[0]).toContain('python3 tests/a-check.py')
    expect(found[0]).not.toContain('/usr/bin/python3')
    expect(found[0]).not.toContain('-B')
  })

  test('toast đúng một lần mỗi mục tiêu: các checkpoint sau không báo lại', {}, async ($, on) => {
    const seen = await untilCheckpoint($, on, { many: true })
    expect(hints(seen.toasts).length).toBe(1)
  })

  test('mục tiêu mới báo lại', {}, async ($, on) => {
    const seen = await untilCheckpoint($, on)
    expect(hints(seen.toasts).length).toBe(1)
    await conductor($, 'goal Làm việc khác hẳn')
    await runScript($, 'cd /repo && /usr/bin/python3 -B tests/c-check.py')
    for (let i = 0; i < 4; i++) await editFile($, `src/g${i}.ts`)
    expect(hints(seen.toasts).length).toBe(2)
  })

  test('cuối turn không có lệnh kiểm nào được nhận: cũng gợi ý (cảnh báo "không chạy bước kiểm tra nào" đi kèm gợi ý)', {}, async ($, on) => {
    const seen = base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'RESULT: 47 passed, 0 failed' }))
    on('turn.complete', () => ({ text: '' }))
    await submit($, COMPLEX_PROMPT)
    await runScript($)
    await editFile($)
    await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as never)
    expect(seen.toasts.some(t => t.includes('không chạy bước kiểm tra nào'))).toBe(true)
    expect(hints(seen.toasts).length).toBe(1)
  })

  test('đã khai checkCommands và script được nhận: không có gợi ý', { options: { checkCommands: 'python3 tests/' } }, async ($, on) => {
    const seen = await untilCheckpoint($, on, { many: true })
    expect(hints(seen.toasts)).toEqual([])
  })

  test('không có script kiểm nào đã chạy: không có gợi ý', {}, async ($, on) => {
    const seen = base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    for (let i = 0; i < 6; i++) await editFile($, `src/f${i}.ts`)
    expect(hints(seen.toasts)).toEqual([])
  })

  test('mode off: không gợi ý', {}, async ($, on) => {
    const seen = base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'RESULT: 47 passed, 0 failed' }))
    await conductor($, 'mode off')
    await submit($, COMPLEX_PROMPT)
    await runScript($)
    for (let i = 0; i < 6; i++) await editFile($, `src/f${i}.ts`)
    expect(hints(seen.toasts)).toEqual([])
  })

  test('/conductor status có một dòng gợi ý; chưa có gợi ý thì không có dòng đó', {}, async ($, on) => {
    const seen = base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'RESULT: 47 passed, 0 failed' }))
    await submit($, COMPLEX_PROMPT)
    expect(String((await conductor($, 'status')).text)).not.toContain('checkCommands')
    await runScript($)
    for (let i = 0; i < 4; i++) await editFile($, `src/f${i}.ts`)
    const text = String((await conductor($, 'status')).text)
    expect(text).toContain('checkCommands')
    expect(text).toContain('python3 tests/a-check.py')
    expect(hints(seen.toasts).length).toBe(1)
  })

  test('pane có một dòng gợi ý khi có gợi ý', {}, async ($, on) => {
    await untilCheckpoint($, on)
    const pane = await $.ui.mount(PANE)
    const texts = (await pane.findAll({ type: 'Text' })).map(e => e.text)
    await pane.unmount()
    expect(texts.some(t => typeof t === 'string' && t.includes('checkCommands') && t.includes('python3 tests/a-check.py'))).toBe(true)
  })

  test('hai script cùng thư mục: gợi ý tiền tố thư mục kèm lời nhắc chỉ khai nếu thư mục chỉ chứa script kiểm', {}, async ($, on) => {
    const seen = base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'RESULT: 47 passed, 0 failed' }))
    await submit($, COMPLEX_PROMPT)
    await runScript($, 'cd /repo && /usr/bin/python3 -B tests/a-check.py')
    await runScript($, 'cd /repo && /usr/bin/python3 -B tests/b-check.py')
    for (let i = 0; i < 4; i++) await editFile($, `src/f${i}.ts`)
    const found = hints(seen.toasts)
    expect(found.length).toBe(1)
    expect(found[0]).toContain('python3 tests/')
    expect(found[0]).toContain('chỉ chứa script kiểm')
  })

  test('mục tiêu mới: dòng gợi ý của mục tiêu cũ không còn ở /conductor status và pane', {}, async ($, on) => {
    await untilCheckpoint($, on)
    expect(String((await conductor($, 'status')).text)).toContain('checkCommands')
    await conductor($, 'goal Làm việc khác hẳn')
    expect(String((await conductor($, 'status')).text)).not.toContain('checkCommands')
    const pane = await $.ui.mount(PANE)
    const texts = (await pane.findAll({ type: 'Text' })).map(e => e.text)
    await pane.unmount()
    expect(texts.some(t => typeof t === 'string' && t.includes('checkCommands'))).toBe(false)
  })

  test('gợi ý đổi giữa hai checkpoint (có thêm script cùng thư mục): cập nhật dòng ở status, không báo toast lần hai', {}, async ($, on) => {
    const seen = await untilCheckpoint($, on)
    expect(hints(seen.toasts).length).toBe(1)
    expect(String((await conductor($, 'status')).text)).toContain('python3 tests/a-check.py')
    await runScript($, 'cd /repo && /usr/bin/python3 -B tests/b-check.py')
    for (let i = 0; i < 4; i++) await editFile($, `src/h${i}.ts`)
    expect(hints(seen.toasts).length).toBe(1)
    const status = String((await conductor($, 'status')).text)
    expect(status).toContain('python3 tests/')
    expect(status).not.toContain('python3 tests/a-check.py')
  })

  test('đã có lệnh kiểm nhận được chạy đạt rồi sửa tiếp: cảnh báo "chưa được kiểm tra lại" không kèm gợi ý', {}, async ($, on) => {
    const seen = base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: '12 pass' }))
    on('turn.complete', () => ({ text: '' }))
    await submit($, COMPLEX_PROMPT)
    await runScript($)
    await editFile($)
    await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
    await editFile($, 'src/b.ts')
    await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as never)
    expect(seen.toasts.some(t => t.includes('chưa được kiểm tra lại'))).toBe(true)
    expect(hints(seen.toasts)).toEqual([])
  })

  test('chỉ gợi ý, không tự khai: sau gợi ý, script vẫn chưa là lệnh kiểm tra', {}, async ($, on) => {
    await untilCheckpoint($, on)
    expect(checkKindOf('/usr/bin/python3 -B tests/a-check.py')).toBeNull()
  })

  test('plan tool: bước done sau khi chạy script chưa khai vẫn nêu checkCommands cho Claude với chuỗi dạng chuẩn', {}, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'RESULT: 47 passed, 0 failed' }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] })
    await editFile($)
    await runScript($)
    const out = String((await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: 'đã chạy bộ kiểm' })).result)
    expect(out).toContain('`python3 tests/a-check.py`')
  })
})
