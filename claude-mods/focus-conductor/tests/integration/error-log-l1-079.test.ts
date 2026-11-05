// 0.7.9 L1: nhật ký lỗi của chính mod. Mỗi loại lỗi một mục (khóa: nhóm, nơi, thông điệp đã chuẩn hóa), trần 200 loại, tự xóa loại đã
// sửa theo sổ fixed-errors lúc mở phiên, lệnh /conductor errors và errors clear. Nhật ký không bao giờ vào context của model.
// So MOD_VERSION với plugin.json chạy bằng scripts/version-check.mjs (kit không nạp được tệp JSON).

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { EMPTY_ERRORS, capEntries, caught, errorFileText, mergeEntry, mistypedFields, normalizeMessage, noteHookError, parseErrorFile, pruneFixed, setErrorSink } from '../../hooks/lib/errlog'
import type { ErrorEntry, ErrorEvent, ErrorFile } from '../../hooks/lib/errlog'
import { FIXED_ERRORS } from '../../hooks/lib/fixed-errors'
import { MOD_VERSION } from '../../hooks/lib/version'
import * as S from '../../hooks/lib/state'
import { ROUTER_TIMEOUT, base, conductor, submit } from '../support/engine'

const FILE = '/repo/.focus-conductor/errors.json'
const T0 = '2026-11-05T10:00:00+07:00'
const hookError = (message: string, where = 'turn.complete') => ({ group: 'hook' as const, where, message })

/** File giả: đọc và ghi đi qua một Map; `failWrite` làm mọi lần ghi nhật ký lỗi thất bại. */
function disk(on: Parameters<typeof base>[0], seed: Record<string, string> = {}, failWrite = false) {
  const files = new Map(Object.entries(seed))
  const reads: string[] = []
  const writes: string[] = []
  on('fs.read', (_$, e) => {
    reads.push(e.path)
    const text = files.get(e.path)
    if (text === undefined) return { deny: `ENOENT: no such file or directory, open '${e.path}'` } as never
    return { value: text } as never
  })
  on('fs.write', (_$, e) => {
    writes.push(e.path)
    if (failWrite && e.path.endsWith('errors.json')) return { deny: 'EACCES: permission denied' } as never
    files.set(e.path, e.text)
    return { value: undefined }
  })
  return { files, reads, writes, log: (path = FILE) => parseErrorFile(files.get(path) ?? '') }
}

/** Engine giả cho session.start: đăng ký tool plan và lệnh /conductor. */
function startHooks(on: Parameters<typeof base>[0]) {
  on('tool.register', () => ({ value: { tool: 'mcp__focus-conductor__plan' } }) as never)
  on('command.register', () => ({ value: { command: 'conductor' } }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
}

const entry = (key: string, lastVersion: string, lastSeen = T0): ErrorEntry => ({
  key,
  group: 'hook',
  where: 'turn.complete',
  message: 'lỗi',
  firstSeen: lastSeen,
  lastSeen,
  firstVersion: lastVersion,
  lastVersion,
  count: 1,
})

async function complete($: Engine, turnId: string) {
  return $.turn.complete({ turnId, answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as never)
}

describe('0.7.9 L1: khóa và gộp (hàm thuần)', () => {
  test('1. một hook ném lỗi hai lần, thông điệp chỉ khác số: một mục, count 2', () => {
    let file: ErrorFile = EMPTY_ERRORS
    file = mergeEntry(file, hookError('hết chỗ ở dòng 12'), T0, '0.7.9')
    file = mergeEntry(file, hookError('hết chỗ ở dòng 13'), '2026-11-05T10:05:00+07:00', '0.7.9')
    expect(file.entries.length).toBe(1)
    expect(file.entries[0]).toMatchObject({ count: 2, message: 'hết chỗ ở dòng <n>', lastSeen: '2026-11-05T10:05:00+07:00' })
  })

  test('2. hai lỗi khác nơi xảy ra: hai mục', () => {
    let file: ErrorFile = EMPTY_ERRORS
    file = mergeEntry(file, hookError('lỗi', 'turn.complete'), T0, '0.7.9')
    file = mergeEntry(file, hookError('lỗi', 'tool.call'), T0, '0.7.9')
    expect(file.entries.length).toBe(2)
  })

  test('4. đường dẫn tuyệt đối thành <path>, uuid bị bỏ', () => {
    const message = normalizeMessage('không đọc được /Users/x/a.ts của phiên 3f2b8c1e-9d4a-4e7b-8c2d-1a2b3c4d5e6f')
    expect(message).toContain('<path>')
    expect(message).not.toContain('/Users/x/a.ts')
    expect(message).not.toContain('3f2b8c1e')
    expect(message.length).toBeLessThanOrEqual(200)
  })

  test('khóa cắt thông điệp còn 160 ký tự; thông điệp giữ tối đa 200', () => {
    const file = mergeEntry(EMPTY_ERRORS, hookError('a'.repeat(400)), T0, '0.7.9')
    expect(file.entries[0]!.message.length).toBe(200)
    expect(file.entries[0]!.key).toBe(`hook|turn.complete|${'a'.repeat(160)}`)
  })

  test('11. 201 loại khác nhau: 200 mục, dropped 1, loại bỏ là loại cũ nhất', () => {
    let file: ErrorFile = EMPTY_ERRORS
    for (let i = 0; i < 201; i++) {
      const at = `2026-11-05T10:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}+07:00`
      file = mergeEntry(file, hookError(`lỗi`, `nơi ${String.fromCharCode(97 + (i % 26))}${'z'.repeat(Math.floor(i / 26))}`), at, '0.7.9')
    }
    expect(file.entries.length).toBe(200)
    expect(file.dropped).toBe(1)
    expect(file.entries.some(e => e.where === 'nơi a')).toBe(false)
    expect(capEntries(file).entries.length).toBe(200)
    expect(parseErrorFile(errorFileText(file)).dropped).toBe(1)
  })

  test('state: trường có mặt mà sai kiểu so với bản mặc định được liệt kê, trường thiếu hay null thì không', () => {
    expect(mistypedFields({ plan: 'hỏng', warnings: [], brief: null }, S.EMPTY_CORE as unknown as Record<string, unknown>)).toEqual(['plan'])
    expect(mistypedFields({}, S.EMPTY_CORE as unknown as Record<string, unknown>)).toEqual([])
  })
})

describe('0.7.9 L1: handler .catch của hook nhận đối tượng lỗi', () => {
  // Handler `.catch` của engine 2.1.296 nhận `next.error` kiểu HookFailure (kind, message: điều đã ném), index.d.ts:5277-5289. Kit test
  // biến lỗi do handler của test ném thành "no implementation for <sự kiện>", nên phần này gọi đúng hàm mà mọi handler .catch của mod gọi.
  test('hook ném Error("x 12"): mục có message "x <n>", không rỗng', () => {
    const got: ErrorEvent[] = []
    setErrorSink(event => got.push(event))
    noteHookError('turn.complete', { kind: 'throw', message: new Error('x 12').message })
    noteHookError('tool.call', { kind: 'timeout' })
    noteHookError('turn.start', { kind: 'throw', message: 'no implementation for turn.start' })
    setErrorSink(null)
    expect(got.map(e => e.where)).toEqual(['turn.complete', 'tool.call'])
    const file = mergeEntry(EMPTY_ERRORS, got[0]!, T0, '0.7.9')
    expect(file.entries[0]).toMatchObject({ group: 'hook', where: 'turn.complete', message: 'x <n>' })
    expect(got[1]!.message).toBe('timeout')
  })

  test('caught: lời gọi bị từ chối ghi nhóm engine kèm thông điệp, trả giá trị thay thế; đọc file chưa có thì không ghi', () => {
    const got: ErrorEvent[] = []
    setErrorSink(event => got.push(event))
    expect(caught('session.root', null)(new Error('refused 3'))).toBeNull()
    expect(caught('fs.read', '')(new Error('ENOENT: no such file or directory'))).toBe('')
    expect(caught('savePauseOnEnd', undefined, 'hook')('lỗi')).toBeUndefined()
    setErrorSink(null)
    expect(got).toEqual([
      { group: 'engine', where: 'session.root', message: 'refused 3' },
      { group: 'hook', where: 'savePauseOnEnd', message: 'lỗi' },
    ])
  })

  test('bộ nhận ném lỗi: noteModError nuốt, không ném ra hook', () => {
    setErrorSink(() => {
      throw new Error('hỏng')
    })
    expect(() => noteHookError('turn.complete', { kind: 'throw', message: 'x' })).not.toThrow()
    setErrorSink(null)
  })
})

describe('0.7.9 L1: tự xóa lỗi đã sửa (hàm thuần)', () => {
  const fixed = [{ key: 'K', fixedIn: '0.7.9', note: 'đã sửa' }]

  test('6. sổ có K fixedIn 0.7.9, mục K lastVersion 0.7.8, mở phiên ở 0.7.9: K bị xóa', () => {
    const file = { dropped: 0, entries: [entry('K', '0.7.8'), entry('L', '0.7.8')] }
    expect(pruneFixed(file, '0.7.9', fixed).entries.map(e => e.key)).toEqual(['L'])
  })

  test('7. mục K gặp lại ở 0.7.9: giữ, regressed true', () => {
    const kept = pruneFixed({ dropped: 0, entries: [entry('K', '0.7.9')] }, '0.7.9', fixed).entries
    expect(kept).toEqual([{ ...entry('K', '0.7.9'), regressed: true }])
  })

  test('8. mục không có trong sổ, mở phiên ở bản mới hơn: giữ', () => {
    expect(pruneFixed({ dropped: 0, entries: [entry('M', '0.7.1')] }, '0.8.0', fixed).entries.map(e => e.key)).toEqual(['M'])
  })

  test('bản đang chạy còn trước fixedIn: chưa xóa', () => {
    expect(pruneFixed({ dropped: 0, entries: [entry('K', '0.7.7')] }, '0.7.8', fixed).entries.map(e => e.key)).toEqual(['K'])
  })

  test('sổ 0.7.9 bắt đầu rỗng; MOD_VERSION là 0.7.9', () => {
    expect(FIXED_ERRORS).toEqual([])
    expect(MOD_VERSION).toBe('0.7.9')
  })
})

describe('0.7.9 L1: nối vào mod', () => {
  test('3. router hết giờ ba lần: một mục nhóm router, count 3', {}, async ($, on) => {
    base(on, { router: () => ROUTER_TIMEOUT })
    const fs = disk(on)
    for (const text of ['Sửa module thanh toán', 'Thêm báo cáo doanh thu', 'Viết test đăng ký']) await submit($, text)
    await conductor($, 'errors')
    const routers = fs.log().entries.filter(e => e.group === 'router')
    expect(routers.length).toBe(1)
    expect(routers[0]!.count).toBeGreaterThanOrEqual(2)
    expect(routers[0]!.count).toBeLessThanOrEqual(3)
  })

  test('5. file cũ có một mục, mở phiên mới: mục cũ còn, lỗi mới gộp vào, không trùng', {}, async ($, on) => {
    const old = { dropped: 0, entries: [entry('hook|tool.call|cũ', '0.7.8')] }
    base(on, { router: () => ROUTER_TIMEOUT })
    const fs = disk(on, { [FILE]: errorFileText(old) })
    startHooks(on)
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
    await submit($, 'Sửa module thanh toán')
    await submit($, 'Sửa module thanh toán')
    await conductor($, 'errors')
    const keys = fs.log().entries.map(e => e.key)
    expect(keys).toContain('hook|tool.call|cũ')
    expect(keys.filter(k => k.startsWith('router|')).length).toBe(1)
    expect(new Set(keys).size).toBe(keys.length)
  })

  test('mở phiên: mục có trong sổ thì xóa theo pruneFixed (sổ rỗng thì giữ nguyên, không ghi lại)', {}, async ($, on) => {
    base(on)
    const fs = disk(on, { [FILE]: errorFileText({ dropped: 0, entries: [entry('K', '0.7.8')] }) })
    startHooks(on)
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
    expect(fs.log().entries.map(e => e.key)).toEqual(['K'])
    expect(fs.writes.filter(p => p === FILE).length).toBe(0)
  })

  test('9. ghi file thất bại: hook vẫn trả kết quả đúng, không ném lỗi', {}, async ($, on) => {
    base(on, { router: () => ROUTER_TIMEOUT })
    disk(on, {}, true)
    on('turn.complete', () => ({ text: 'xong' }))
    await submit($, 'Sửa module thanh toán')
    await $.turn.start({ text: 'Sửa module thanh toán', turnId: 't1' })
    const result = (await complete($, 't1')) as { text?: string }
    expect(result.text).toBe('xong')
    const shown = await conductor($, 'errors')
    expect(typeof shown.text).toBe('string')
  })

  test('10. errorLog off: không đọc, không ghi file nhật ký nào', { options: { errorLog: 'off' } }, async ($, on) => {
    base(on, { router: () => ROUTER_TIMEOUT })
    const fs = disk(on)
    startHooks(on)
    on('turn.complete', () => ({ text: '' }))
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
    await submit($, 'Sửa module thanh toán')
    await $.turn.start({ text: 'Sửa module thanh toán', turnId: 't1' })
    await complete($, 't1')
    expect((await conductor($, 'errors')).text).toContain('off')
    expect([...fs.reads, ...fs.writes].some(p => p.includes('errors.json') || p.includes('.focus-conductor'))).toBe(false)
  })

  test('root của phiên là /tmp/x: file nằm ở /tmp/x/.focus-conductor/errors.json', {}, async ($, on) => {
    base(on, { root: '/tmp/x', router: () => ROUTER_TIMEOUT })
    const fs = disk(on)
    await submit($, 'Sửa module thanh toán')
    await conductor($, 'errors')
    expect(fs.writes).toContain('/tmp/x/.focus-conductor/errors.json')
    expect(fs.log('/tmp/x/.focus-conductor/errors.json').entries.length).toBeGreaterThan(0)
  })

  test('12. /conductor errors in nhóm, nơi, thông điệp, count, lastSeen; errors clear xóa sau xác nhận', {}, async ($, on) => {
    base(on, { router: () => ROUTER_TIMEOUT })
    const fs = disk(on)
    await submit($, 'Sửa module thanh toán')
    const shown = String((await conductor($, 'errors')).text)
    expect(shown).toContain('Nhật ký lỗi của mod: 1 loại')
    expect(shown).toMatch(/- router · prompt · [a-z-]+ · 1 lần · \d{4}-\d{2}-\d{2}T/)
    const first = String((await conductor($, 'errors clear')).text)
    expect(first).toContain('gõ lại /conductor errors clear trong 10 giây')
    expect(fs.log().entries.length).toBe(1)
    expect(String((await conductor($, 'errors clear')).text)).toContain('Đã xóa')
    expect(fs.log().entries.length).toBe(0)
    expect(String((await conductor($, 'errors')).text)).toContain('trống')
  })

  test('13. context của các turn không có chữ nào từ nhật ký lỗi', {}, async ($, on) => {
    base(on, { router: () => ROUTER_TIMEOUT })
    disk(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    const contexts: string[] = []
    for (const text of ['Sửa module thanh toán', 'Thêm báo cáo doanh thu']) {
      const out = (await submit($, text)) as { context?: readonly string[] }
      contexts.push(...(out.context ?? []))
      await $.turn.start({ text, turnId: `t-${text.length}` })
      const step = (await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' } as never)) as { context?: readonly string[] }
      contexts.push(...(step.context ?? []))
    }
    await conductor($, 'errors')
    const all = contexts.join('\n')
    expect(all).not.toContain('errors.json')
    expect(all).not.toContain('Nhật ký lỗi')
    expect(all).not.toMatch(/router · prompt/)
  })
})
