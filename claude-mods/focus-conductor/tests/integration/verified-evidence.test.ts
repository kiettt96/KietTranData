// Test tích hợp: verified phải có evidence thật (dấu vết thực thi, kiểm tra sau thay đổi cuối, phạm vi Bash, mã thoát bị che, output thật).
// Gom từ tests/hooks.test.ts; tên describe và test giữ nguyên.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { CARGO, NODE } from '../fixtures/runner-output'
import { COMPLEX_PROMPT, DEFAULT_ROUTER, EDIT, FOUR, PANE, SEARCH, base, conductor, plan, spawnTool, step, submit } from '../support/engine'
import type { Responder } from '../support/engine'

describe('0.5.0: verified phải có evidence thật', () => {
  const PLAN = 'mcp__focus-conductor__plan'

  test('evidence nhắc lệnh đã chạy: tính là đã kiểm tra, không cảnh báo', {}, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: '12 pass' }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] })
    for (const f of ['a', 'b', 'c', 'd']) await $.tool.call({ tool: 'Edit', file_path: `src/${f}.ts`, old_string: 'x', new_string: 'y' })
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    const done = await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: 'npm test: 12 pass' })
    expect(String(done.result)).not.toContain('chưa tính là đã kiểm tra')
    // Đếm thay đổi chưa kiểm tra bắt đầu lại: lần sửa tiếp theo không nhắc checkpoint.
    const next = await $.tool.call({ tool: 'Edit', file_path: 'src/e.ts', old_string: 'x', new_string: 'y' })
    expect(JSON.stringify(next.context ?? [])).not.toContain('Checkpoint')
  })

  test('evidence không nhắc lệnh hay file nào đã chạy: lưu là done (0.5.1), cảnh báo và chưa tính là đã kiểm tra', {}, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] })
    for (const f of ['a', 'b', 'c', 'd']) await $.tool.call({ tool: 'Edit', file_path: `src/${f}.ts`, old_string: 'x', new_string: 'y' })
    const done = await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: 'đã kiểm tra kỹ, chạy ổn' })
    expect(String(done.result)).toContain('[x] 1. Sửa')
    expect(String(done.result)).toContain('chưa tính là đã kiểm tra')
    const next = await $.tool.call({ tool: 'Edit', file_path: 'src/e.ts', old_string: 'x', new_string: 'y' })
    expect(JSON.stringify(next.context ?? [])).toContain('Checkpoint')
    const ui = await $.ui.mount(PANE)
    expect(await ui.find({ type: 'Text', text: /evidence không nhắc lệnh hay file/ })).toBeDefined()
    await ui.unmount()
  })
})

describe('0.5.1: kiểm chứng sau thay đổi cuối, phạm vi Bash, Stop, việc giao', () => {
  const PLAN = 'mcp__focus-conductor__plan'
  const MAIN_DONE = { turnId: 't1', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as never
  const edit = ($: Engine, path: string) => $.tool.call({ tool: 'Edit', file_path: path, old_string: 'a', new_string: 'b' })

  test('01: test đạt, sửa tiếp, không test lại: cuối turn báo thay đổi sau lần kiểm tra cuối', {}, async ($, on) => {
    const seen = base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: '12 pass' }))
    on('turn.complete', () => ({ text: '' }))
    await submit($, COMPLEX_PROMPT)
    await edit($, 'src/a.ts')
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    await edit($, 'src/b.ts')
    await $.turn.complete(MAIN_DONE)
    expect(seen.toasts.some(t => t.includes('1 thay đổi sau lần kiểm tra cuối chưa được kiểm tra lại'))).toBe(true)
  })

  test('02: lệnh Bash ghi ngoài phạm vi thì cảnh báo như Edit; không xác định được đích thì báo riêng', {}, async ($, on) => {
    const seen = base(on, { router: () => plan({ goal: 'Sửa src', scope: ['src/'] }) })
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }))
    await submit($, 'Chỉ sửa trong src/: đổi tên hàm charge')
    const inside = await $.tool.call({ tool: 'Bash', command: 'sed -i s/a/b/ src/pay.ts' })
    expect((inside.context ?? []).join('\n')).not.toContain('ngoài phạm vi')
    const outside = await $.tool.call({ tool: 'Bash', command: 'sed -i s/a/b/ config/app.json' })
    expect((outside.context ?? []).join('\n')).toContain('config/app.json, nằm ngoài phạm vi')
    expect(seen.toasts.some(t => t.includes('Lệnh Bash ghi ngoài phạm vi đã nêu: config/app.json'))).toBe(true)
    const unknown = await $.tool.call({ tool: 'Bash', command: 'python scripts/gen.py' })
    expect((unknown.context ?? []).join('\n')).toContain('không xác định được file đích')
  })

  test('03: Stop chặn turn chỉ giao subagent hoặc chỉ đọc khi làm tiếp; câu hỏi ngoài lề thì không', {}, async ($, on) => {
    const router: Responder = request =>
      request.startsWith('làm tiếp') ? plan({ relation: 'continue', kind: 'mixed' }) : request.startsWith('hỏi') ? plan({ relation: 'continue', kind: 'answer' }) : DEFAULT_ROUTER(request)
    base(on, { router })
    on('tool.call', { tool: 'Read' }, () => ({ result: 'nội dung' }))
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
    on('classic.Stop', () => ({}))
    await submit($, FOUR)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Giao việc' }, { title: 'Thiết kế' }] })
    // Turn làm tiếp chỉ đọc file: vẫn là thực thi mục tiêu.
    await submit($, 'làm tiếp phần thiết kế')
    await $.turn.start({ text: 'làm tiếp phần thiết kế', turnId: 't2' })
    await $.tool.call({ tool: 'Read', file_path: 'src/pay.ts' })
    expect((await $.classic.Stop({ stop_hook_active: false })).block).toContain('Checklist còn 2 bước mở')
    // Câu hỏi ngoài lề, có đọc file: không bị checklist chặn.
    await submit($, 'hỏi: hàm charge trả về gì')
    await $.turn.start({ text: 'hỏi: hàm charge trả về gì', turnId: 't3' })
    await $.tool.call({ tool: 'Read', file_path: 'src/pay.ts' })
    expect((await $.classic.Stop({ stop_hook_active: false })).block).toBeUndefined()
    // Turn chỉ giao subagent (kể cả khi prompt là câu hỏi): là thực thi.
    await $.turn.start({ text: 'giao', turnId: 't4' })
    await $.tool.call({ tool: 'Agent', description: 'Việc 1: tìm chỗ gọi charge', prompt: SEARCH })
    expect((await $.classic.Stop({ stop_hook_active: false })).block).toContain('Checklist còn 2 bước mở')
  })

  test('05: set với steps rỗng xóa checklist', {}, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'a' }, { title: 'b' }] })
    const cleared = await $.tool.call({ tool: PLAN, action: 'set', goal: 'Mục tiêu đã đổi', steps: [] })
    expect(String(cleared.result)).toContain('Checklist trống')
  })

  test('04: verified sau thay đổi mà chưa test lại, hoặc nhắc lệnh test đã lỗi, thì lưu done kèm lý do', {}, async ($, on) => {
    base(on)
    let failing = false
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => (failing ? { result: '1 fail', isError: true } : { result: '12 pass' }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'a' }, { title: 'b' }, { title: 'c' }] })
    await edit($, 'src/a.ts')
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    await edit($, 'src/b.ts')
    const stale = await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: 'npm test: 12 pass' })
    expect(String(stale.result)).toContain('[x] 1. a')
    expect(String(stale.result)).toContain('chạy trước thay đổi cuối cùng')
    failing = true
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    const failed = await $.tool.call({ tool: PLAN, action: 'update', step: 2, status: 'verified', evidence: 'npm test: chạy' })
    expect(String(failed.result)).toContain('[x] 2. b')
    expect(String(failed.result)).toContain('đã lỗi')
    failing = false
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    const ok = await $.tool.call({ tool: PLAN, action: 'update', step: 3, status: 'verified', evidence: 'npm test: 12 pass' })
    expect(String(ok.result)).toContain('[v] 3. c')
    expect(String(ok.result)).not.toContain('chưa tính là đã kiểm tra')
  })

  test('04: chỉ kiểm tĩnh thì ghi chú; việc chỉ đọc nêu file đã đọc thì nhận verified', {}, async ($, on) => {
    base(on, { router: request => (request.startsWith('Đọc') ? plan({ goal: 'Đọc hiểu', kind: 'investigate' }) : DEFAULT_ROUTER(request)) })
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'sạch' }))
    on('tool.call', { tool: 'Read' }, () => ({ result: 'nội dung' }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] })
    await edit($, 'src/a.ts')
    await $.tool.call({ tool: 'Bash', command: 'npx tsc --noEmit' })
    const typed = await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: 'npx tsc --noEmit: sạch' })
    expect(String(typed.result)).toContain('[v] 1. Sửa')
    expect(String(typed.result)).toContain('chỉ là kiểm tĩnh')
    await submit($, 'Đọc src/pay.ts và giải thích luồng')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Đọc luồng' }] })
    await $.tool.call({ tool: 'Read', file_path: '/repo/src/pay.ts' })
    const read = await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: 'đã đọc pay.ts' })
    expect(String(read.result)).toContain('[v] 1. Đọc luồng')
  })

  test('04: tiêu chí nghiệm thu của bước được nhắc khi đóng bước; đóng bước cuối thì nhắc tiêu chí chất lượng', {}, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: '12 pass' }))
    await submit($, COMPLEX_PROMPT)
    const set = await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Migrate', check: 'API công khai không đổi' }] })
    expect(String(set.result)).toContain('[nghiệm thu: API công khai không đổi]')
    await edit($, 'src/a.ts')
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    const done = await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: 'npm test: 12 pass' })
    expect(String(done.result)).toContain('Tiêu chí nghiệm thu của bước 1: API công khai không đổi')
    expect(String(done.result)).toContain('(1) Hiệu năng không giảm')
  })

  test('04: subagent tự sửa rồi tự chạy test: lệnh test đó là bằng chứng cho phần nó sửa', {}, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: '12 pass' }))
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
    on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'chk-1' }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] })
    await spawnTool($, 'u-chk', 'Sửa và chạy test', 'Sửa src/a.ts rồi chạy npm test')
    await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b', agentId: 'chk-1' } as never)
    await $.tool.call({ tool: 'Bash', command: 'npm test', agentId: 'chk-1' } as never)
    const done = await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: 'subagent chạy npm test: 12 pass' })
    expect(String(done.result)).toContain('[v] 1. Sửa')
  })

  test('việc giao subagent: chờ, đang chạy, lỗi (Stop và cảnh báo nhắc), giao lại rồi xong; lời gọi bị từ chối thì về chờ', {}, async ($, on) => {
    base(on)
    let n = 0
    let isDenied = false
    on('tool.call', { tool: 'Agent' }, () => (isDenied ? { deny: 'người dùng từ chối' } : { result: 'đã giao' }))
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `dg-${(n += 1)}` }))
    on('turn.complete', () => ({ text: '' }))
    on('classic.Stop', () => ({}))
    await submit($, FOUR)
    const status = async () => String((await conductor($, 'status')).text)
    expect(await status()).toContain('2. Đổi tên userId thành accountId trong 12 file controller.: chờ giao')
    await spawnTool($, 'u-2', 'Việc 2: đổi tên userId', EDIT)
    expect(await status()).toContain('accountId trong 12 file controller.: đang chạy')
    await $.turn.complete({ turnId: 'a-2', agentId: 'dg-1', answer: '', durationMs: 1, isAborted: false, reason: 'error' } as never)
    expect(await status()).toContain('accountId trong 12 file controller.: lỗi, chưa giao lại')
    await edit($, 'src/x.ts')
    expect((await $.classic.Stop({ stop_hook_active: false })).block).toContain('Việc giao subagent đã lỗi, chưa giao lại: Việc 2 (sonnet/medium)')
    await $.turn.complete(MAIN_DONE)
    const pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: /giao subagent đã lỗi, chưa giao lại/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /accountId trong 12 file controller\./ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^\s*lỗi, chưa giao lại$/ })).toBeDefined()
    await pane.unmount()
    await spawnTool($, 'u-2b', 'Việc 2: đổi tên userId, lần hai', EDIT)
    await $.turn.complete({ turnId: 'a-2b', agentId: 'dg-2', answer: 'xong', durationMs: 1, isAborted: false, reason: 'answer' } as never)
    expect(await status()).toContain('accountId trong 12 file controller.: xong')
    // Lời gọi Agent bị từ chối: việc không chạy, trở lại danh sách chờ.
    isDenied = true
    await $.tool.call({ tool: 'Agent', tool_use_id: 'u-4', description: 'Việc 4: README', prompt: 'Cập nhật README phần cài đặt.' })
    expect(await status()).toContain('4. Cập nhật README phần cài đặt.: chờ giao')
  })

  test('blockLimit: số lần chặn theo cấu hình', { options: { strictDelegation: 'block', blockLimit: 3 } }, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, FOUR)
    for (let i = 0; i < 3; i++) expect((await edit($, 'src/a.ts')).deny).toBeDefined()
    expect((await edit($, 'src/a.ts')).deny).toBeUndefined()
  })

  test('status tách chi phí đo được với phần còn ước tính, và báo độ trễ router', {}, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
    on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'est-1' }))
    await submit($, FOUR)
    await spawnTool($, 'u-e', 'Việc 2: đổi tên userId', EDIT)
    const text = String((await conductor($, 'status')).text)
    expect(text).toContain('Phiên, đo được:')
    expect(text).toContain('Ước tính lúc giao, chưa có số đo:')
    expect(text).toContain('Độ trễ router: trung bình 0.0 s qua 1 lượt')
  })
})

describe('0.5.1: dấu vết thực thi giữ theo mục tiêu', () => {
  test('khôi phục mục tiêu cũ không mất lịch sử thay đổi: evidence chỉ nhắc file vẫn lưu done', {}, async ($, on) => {
    const PLAN = 'mcp__focus-conductor__plan'
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Read' }, () => ({ result: 'nội dung' }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] })
    await $.tool.call({ tool: 'Edit', file_path: 'src/pay.ts', old_string: 'a', new_string: 'b' })
    await submit($, 'Viết hàm slugify(text) bằng TypeScript, có unit test.')
    // Mục tiêu mới có tool call riêng: dấu vết chuyển sang mục tiêu mới.
    await $.tool.call({ tool: 'Edit', file_path: 'src/slugify.ts', old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: PLAN, action: 'restore' })
    // Chỉ đọc lại file sau khi khôi phục: mục tiêu này đã có thay đổi, nên đọc lại không đủ để ghi verified.
    await $.tool.call({ tool: 'Read', file_path: 'src/pay.ts' })
    const done = await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: 'đã đọc lại pay.ts' })
    expect(String(done.result)).toContain('[x] 1. Sửa')
  })
})

describe('0.5.1: output thật của lệnh kiểm tra', () => {
  test('test qua | tail không lỗi theo mã thoát nhưng output báo fail: verified lưu done', {}, async ($, on) => {
    const PLAN = 'mcp__focus-conductor__plan'
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: '# tests 1\n# pass 0\n# fail 1' }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] })
    await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: 'Bash', command: 'node --test src/ 2>&1 | tail -15' })
    const done = await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: 'node --test src/: 1 pass' })
    expect(String(done.result)).toContain('[x] 1. Sửa')
    expect(String(done.result)).toContain('đã lỗi')
  })
})

describe('0.5.1 vòng cuối: phân loại lệnh, subagent, lệnh lỗi, phạm vi theo root', () => {
  const PLAN = 'mcp__focus-conductor__plan'
  const MAIN_DONE = { turnId: 't1', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as never
  const edit = ($: Engine, path: string, agentId?: string) =>
    $.tool.call({ tool: 'Edit', file_path: path, old_string: 'a', new_string: 'b', ...(agentId ? { agentId } : {}) } as never)
  const bash = ($: Engine, command: string, agentId?: string) => $.tool.call({ tool: 'Bash', command, ...(agentId ? { agentId } : {}) } as never)

  test('luồng chính sửa, test đạt, subagent sửa tiếp: cuối turn báo chưa kiểm tra', {}, async ($, on) => {
    const seen = base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: '12 pass' }))
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
    on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'sub-1' }))
    on('turn.complete', () => ({ text: '' }))
    await submit($, COMPLEX_PROMPT)
    await edit($, 'src/a.ts')
    await bash($, 'npm test')
    await spawnTool($, 'u-s1', 'Sửa B', 'Sửa src/b.ts')
    await edit($, 'src/b.ts', 'sub-1')
    await $.turn.complete(MAIN_DONE)
    expect(seen.toasts.some(t => t.includes('sau lần kiểm tra cuối chưa được kiểm tra lại'))).toBe(true)
  })

  test('luồng chính sửa A, subagent sửa B rồi tự test đạt: A chưa được kiểm tra lại, verified dựa trên test đó lưu done', {}, async ($, on) => {
    const seen = base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: '12 pass' }))
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
    on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'sub-2' }))
    on('turn.complete', () => ({ text: '' }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] })
    await edit($, 'src/a.ts')
    await spawnTool($, 'u-s2', 'Sửa B', 'Sửa src/b.ts và chạy test')
    await edit($, 'src/b.ts', 'sub-2')
    await bash($, 'npm test', 'sub-2')
    const done = await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: 'npm test: 12 pass' })
    expect(String(done.result)).toContain('[x] 1. Sửa')
    await $.turn.complete(MAIN_DONE)
    expect(seen.toasts.some(t => t.includes('chưa được kiểm tra lại') || t.includes('không chạy bước kiểm tra nào'))).toBe(true)
  })

  test('subagent tự sửa rồi tự test đạt (luồng chính không sửa gì): không báo chưa kiểm tra', {}, async ($, on) => {
    const seen = base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: '12 pass' }))
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
    on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'sub-3' }))
    on('turn.complete', () => ({ text: '' }))
    await submit($, COMPLEX_PROMPT)
    await spawnTool($, 'u-s3', 'Sửa B', 'Sửa src/b.ts và chạy test')
    await edit($, 'src/b.ts', 'sub-3')
    await bash($, 'npm test', 'sub-3')
    await $.turn.complete(MAIN_DONE)
    expect(seen.toasts.some(t => t.includes('chưa được kiểm tra lại') || t.includes('không chạy bước kiểm tra nào'))).toBe(false)
  })

  test('subagent của mục tiêu cũ sửa file không đụng trạng thái kiểm tra của mục tiêu hiện tại', {}, async ($, on) => {
    const seen = base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: '12 pass' }))
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
    on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'old-1' }))
    on('turn.complete', () => ({ text: '' }))
    await submit($, COMPLEX_PROMPT)
    await spawnTool($, 'u-o1', 'Việc nền', 'Sửa src/legacy.ts')
    await submit($, 'Viết hàm slugify(text) bằng TypeScript, có unit test.')
    await edit($, 'src/slugify.ts')
    await bash($, 'npm test')
    await edit($, 'src/legacy.ts', 'old-1')
    await $.turn.complete(MAIN_DONE)
    expect(seen.toasts.some(t => t.includes('chưa được kiểm tra lại'))).toBe(false)
  })

  test('test đạt rồi lệnh ghi file thất bại ở bước cuối: mất trạng thái đã kiểm tra, verified lưu done', {}, async ($, on) => {
    const seen = base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, (_$, e) =>
      String((e as { command?: string }).command).includes('false') ? { result: '', isError: true } : { result: '12 pass' },
    )
    on('turn.complete', () => ({ text: '' }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] })
    await edit($, 'src/a.ts')
    await bash($, 'npm test')
    await bash($, 'echo x > src/a.ts && false')
    const done = await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: 'npm test: 12 pass' })
    expect(String(done.result)).toContain('[x] 1. Sửa')
    await $.turn.complete(MAIN_DONE)
    expect(seen.toasts.some(t => t.includes('sau lần kiểm tra cuối chưa được kiểm tra lại'))).toBe(true)
  })

  test('lệnh test kèm ghi file: cảnh báo phạm vi và cuối turn báo chưa kiểm tra', {}, async ($, on) => {
    const seen = base(on, { router: () => plan({ goal: 'Sửa src', scope: ['src/'] }) })
    on('tool.call', { tool: 'Bash' }, () => ({ result: '12 pass' }))
    on('turn.complete', () => ({ text: '' }))
    await submit($, 'Chỉ sửa trong src/: sửa hàm charge')
    const combined = await bash($, 'npm test && echo changed > ../outside.txt')
    expect((combined.context ?? []).join('\n')).toContain('/outside.txt, nằm ngoài phạm vi')
    const piped = await bash($, 'npm test | tee ../out.log')
    expect((piped.context ?? []).join('\n')).toContain('/out.log, nằm ngoài phạm vi')
    await $.turn.complete(MAIN_DONE)
    expect(seen.toasts.some(t => t.includes('chưa được kiểm tra lại') || t.includes('không chạy bước kiểm tra nào'))).toBe(true)
  })

  test('strictDelegation block từ chối lệnh test kèm ghi file khi còn việc chưa giao', { options: { strictDelegation: 'block' } }, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }))
    await submit($, FOUR)
    expect((await bash($, 'npm test && sed -i s/a/b/ src/a.ts')).deny).toContain('Còn việc ghi giao subagent chưa giao')
    expect((await bash($, 'npm test')).deny).toBeUndefined()
  })

  test('phạm vi theo thư mục gốc: dự án khác có thư mục src là ngoài phạm vi; trong gốc thì trong phạm vi', {}, async ($, on) => {
    base(on, { router: () => plan({ goal: 'Sửa src', scope: ['src/'] }) })
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, 'Chỉ sửa trong src/: sửa hàm charge')
    const other = await edit($, '/tmp/another-project/src/x.ts')
    expect((other.context ?? []).join('\n')).toContain('nằm ngoài phạm vi')
    const inside = await edit($, '/repo/src/x.ts')
    expect((inside.context ?? []).join('\n')).not.toContain('phạm vi')
  })

  test('không lấy được thư mục gốc: không khẳng định trong phạm vi, cảnh báo không xác định được phạm vi', {}, async ($, on) => {
    base(on, { root: null, router: () => plan({ goal: 'Sửa src', scope: ['src/'] }) })
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, 'Chỉ sửa trong src/: sửa hàm charge')
    const result = await edit($, '/tmp/another-project/src/x.ts')
    expect((result.context ?? []).join('\n')).toMatch(/không xác định được phạm vi/i)
  })
})

describe('0.5.1 vòng cuối: thư mục gốc chốt theo mục tiêu', () => {
  test('thư mục gốc engine trả thay đổi giữa chừng: phạm vi vẫn neo theo gốc lúc đầu của mục tiêu', {}, async ($, on) => {
    let calls = 0
    base(on, { root: () => ((calls += 1) <= 1 ? '/repo' : '/elsewhere'), router: () => plan({ goal: 'Sửa src', scope: ['src/'] }) })
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, 'Chỉ sửa trong src/: sửa hàm charge')
    await $.tool.call({ tool: 'Edit', file_path: '/repo/src/a.ts', old_string: 'a', new_string: 'b' })
    const later = await $.tool.call({ tool: 'Edit', file_path: '/repo/src/b.ts', old_string: 'a', new_string: 'b' })
    expect((later.context ?? []).join('\n')).not.toContain('phạm vi')
  })
})

describe('PR #13 P1: verified dựa trên kiểm tra có mã thoát bị che', () => {
  test('npm test; echo done với output không rõ: verified lưu done', {}, async ($, on) => {
    const PLAN = 'mcp__focus-conductor__plan'
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'done' }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] })
    await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: 'Bash', command: 'npm test; echo done' })
    const done = await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: 'npm test chạy xong' })
    expect(String(done.result)).toContain('[x] 1. Sửa')
  })
})

describe('PR #13 vòng 2: lệnh sau tự in báo đạt và evidence gắn đúng đoạn', () => {
  const PLAN = 'mcp__focus-conductor__plan'

  test("npm test; printf '1 passed' rồi verified: lưu done", {}, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: '1 passed' }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] })
    await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: 'Bash', command: "npm test; printf '1 passed\\n'" })
    const done = await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: 'npm test: 1 passed' })
    expect(String(done.result)).toContain('[x] 1. Sửa')
  })

  test('npm test && npm run lint | tail -3: evidence về lint không xác nhận bằng kết quả của npm test', {}, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: '# tests 3\n# pass 3\n# fail 0\nlint: problem' }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] })
    await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: 'Bash', command: 'npm test && npm run lint | tail -3' })
    const done = await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: 'npm run lint: đạt' })
    expect(String(done.result)).toContain('[x] 1. Sửa')
  })
})

describe('PR #13 vòng 3: bộ lọc đọc file và chuyển hướng trên lệnh kiểm tra', () => {
  const PLAN = 'mcp__focus-conductor__plan'

  for (const command of ['npm test | cat < /tmp/fake.log', 'node --test 2>/dev/null | cat']) {
    test(`${command} với output là báo cáo đạt thật: verified lưu done`, {}, async ($, on) => {
      base(on)
      on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
      on('tool.call', { tool: 'Bash' }, () => ({ result: NODE.pass_tap }))
      await submit($, COMPLEX_PROMPT)
      await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] })
      await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
      await $.tool.call({ tool: 'Bash', command })
      const done = await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: `${command}: pass 3` })
      expect(String(done.result)).toContain('[x] 1. Sửa')
      expect(String(done.result)).toContain('chưa tính là đã kiểm tra')
    })
  }

  test('đối chứng: cargo test | cat với output đạt thật đầy đủ: verified được nhận', {}, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: CARGO.pass }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] })
    await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: 'Bash', command: 'cargo test | cat' })
    const done = await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: 'cargo test | cat: 3 passed' })
    expect(String(done.result)).not.toContain('chưa tính là đã kiểm tra')
  })
})

describe('0.5.6 A: gợi ý checkCommands khi verified bị hạ', () => {
  const PLAN = 'mcp__focus-conductor__plan'


  test('script riêng đã chạy nhưng chưa khai option: hạ xuống done, nêu checkCommands và ví dụ từ lệnh thật', {}, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'ĐẠT toàn bộ' }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Dựng bảng tổng' }] })
    await $.tool.call({ tool: 'Edit', file_path: 'build_totals.py', old_string: 'x', new_string: 'y' })
    await $.tool.call({ tool: 'Bash', command: 'python3 check_totals.py --final' })
    const out = String((await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: 'python3 check_totals.py --final: ĐẠT toàn bộ' })).result)
    expect(out).toContain('chưa tính là đã kiểm tra')
    expect(out).toContain('checkCommands')
    expect(out).toContain('`python3 check_totals.py`')
    expect(out).not.toContain('--final`')
    expect(out).toContain('[x] 1. Dựng bảng tổng')
  })

  test('mức none (evidence không nhắc gì): có checkCommands và ví dụ trung tính', {}, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] })
    await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'x', new_string: 'y' })
    const out = String((await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: 'đã kiểm tra kỹ, chạy ổn' })).result)
    expect(out).toContain('checkCommands')
    expect(out).toContain('`python3 check_totals.py`')
  })

  test('mức stale (lệnh kiểm tra nhận ra nhưng chạy trước thay đổi cuối): không nhắc checkCommands', {}, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: '12 pass' }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] })
    await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'x', new_string: 'y' })
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    await $.tool.call({ tool: 'Edit', file_path: 'src/b.ts', old_string: 'x', new_string: 'y' })
    const out = String((await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: 'npm test: 12 pass' })).result)
    expect(out).toContain('chưa tính là đã kiểm tra')
    expect(out).not.toContain('checkCommands')
  })

  test('cổng không đổi: cùng chuỗi lệnh, chưa khai option thì done; evidence lệnh kiểm tra thật vẫn verified', {}, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: '12 pass' }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] })
    await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'x', new_string: 'y' })
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    const out = String((await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: 'npm test: 12 pass' })).result)
    expect(out).not.toContain('chưa tính là đã kiểm tra')
    expect(out).not.toContain('checkCommands')
  })
})
