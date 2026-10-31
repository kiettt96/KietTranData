// Test tích hợp qua engine của `claude plugin test`: router đọc prompt, router lỗi, prompt tiếp nối, prompt dài, đọc lại prompt, hỏi lại router. Router được giả lập qua model.complete.
// Gom từ tests/hooks.test.ts; tên describe và test giữ nguyên.

import { describe, expect, test } from 'claude-code/testing'
import { K4_META_LEAD, K4_PROMPT } from '../fixtures/prompt-k4'
import { COMPLEX_PROMPT, DEFAULT_ROUTER, EDIT, FOUR, base, conductor, plan, requestOf, step, submit, task } from '../support/engine'

describe('router đọc prompt', () => {
  test('khối context lấy đúng từ router: mục tiêu, ràng buộc, tiêu chí, đánh giá, điều phối', {}, async ($, on) => {
    const seen = base(on)
    await submit($, COMPLEX_PROMPT)
    const context = seen.contexts[0]?.join('\n') ?? ''
    expect(context).toContain('[focus-conductor] Bản đọc prompt của router')
    expect(context).toContain('Mục tiêu cuối: Refactor module thanh toán sang kiến trúc hướng sự kiện')
    expect(context).toContain('- Không được thay đổi API công khai')
    expect(context).toContain('- Hiệu năng không giảm')
    expect(context).toContain('Đánh giá: độ sâu hard, khối lượng large, bản chất mixed (việc vừa)')
    expect(context).toContain('Điều phối: luồng chính opus/xhigh')
    expect(context).toContain('mcp__focus-conductor__plan')
    // Router nhận nguyên prompt, gọi bằng model mặc định.
    expect(seen.routed.length).toBe(1)
    expect(requestOf(seen.routed[0] ?? '')).toBe(COMPLEX_PROMPT)
    expect(seen.routerModels).toEqual(['sonnet'])
  })

  test('chế độ off: không gọi router, prompt đi qua nguyên vẹn', { options: { routing: 'off' } }, async ($, on) => {
    const seen = base(on)
    await submit($, COMPLEX_PROMPT)
    expect(seen.contexts[0]).toEqual([])
    expect(seen.routed.length).toBe(0)
  })

  test('option router chọn model router; chi phí router ghi theo đúng họ model đó', { options: { router: 'opus' } }, async ($, on) => {
    const seen = base(on)
    await submit($, COMPLEX_PROMPT)
    expect(seen.routerModels).toEqual(['opus'])
    // 1.000 token vào và 500 token ra ở giá opus ($4/$20 mỗi 1M) = $0.014.
    expect(String((await conductor($, 'status')).text)).toContain('router $0,01 trong 1 lượt')
  })

  test('Phân việc: việc giao kèm loại agent, model, effort; việc làm trực tiếp ghi model luồng chính', {}, async ($, on) => {
    const seen = base(on)
    await submit($, FOUR)
    const context = seen.contexts[0]?.join('\n') ?? ''
    expect(context).toContain('Phân việc (router đã chấm trước khi làm; khi giao, description của Agent mở đầu "Việc N: "')
    expect(context).toContain('1. Tìm trong src/ tất cả chỗ gọi hàm charge và liệt kê đường dẫn. → giao Explore haiku/low')
    expect(context).toContain('2. Đổi tên userId thành accountId trong 12 file controller. → giao general-purpose sonnet/medium')
    expect(context).toContain('3. Thiết kế lại kiến trúc xử lý thanh toán đa tiền tệ, nêu trade-off. → làm trực tiếp ở luồng chính (opus/xhigh)')
    expect(context).toContain('việc ghi "giao" chạy đúng model đã ghi; subagent ngoài danh sách được router chấm khi giao')
    expect(seen.toasts.some(t => t.includes('3 việc giao subagent'))).toBe(true)
  })

  test('router kẹp theo allowFable: chưa bật thì fable về opus, bật thì chạy fable', { options: { allowFable: true } }, async ($, on) => {
    const seen = base(on, { router: () => plan({ kind: 'mixed', main: { model: 'fable', effort: 'high' } }) })
    await submit($, 'Thiết kế lại toàn bộ engine giao dịch')
    expect((await step($, seen))?.model).toBe('claude-fable-5-1')
  })

  test('chưa bật allowFable: lựa chọn fable của router chạy opus, lý do kẹp hiện trong bản đọc', {}, async ($, on) => {
    const seen = base(on, { router: () => plan({ kind: 'mixed', main: { model: 'fable', effort: 'high' } }) })
    await submit($, 'Thiết kế lại toàn bộ engine giao dịch')
    expect((await step($, seen))?.model).toBe('claude-opus-5-5')
    expect(seen.contexts[0]?.join('\n')).toContain('chưa bật allowFable: fable về opus')
  })
})

describe('router lỗi: không đoán, turn chạy theo model của phiên', () => {
  test('lỗi API: step đi qua nguyên vẹn, có toast, cảnh báo và báo cho Claude', {}, async ($, on) => {
    const seen = base(on, { router: () => null })
    await submit($, COMPLEX_PROMPT)
    expect(await step($, seen)).toEqual({ model: 'claude-sonnet-5-5', effort: 'medium' })
    expect(seen.toasts).toContain('Router (sonnet) không đọc được prompt (lỗi API overloaded 529); turn này chạy theo model của phiên')
    expect(seen.contexts[0]?.join('\n')).toContain('Router không đọc được prompt này (lỗi API overloaded 529)')
    // 0.7.2: router lỗi ở prompt đầu thì mod lập mục tiêu tối thiểu (không còn "Chưa có mục tiêu"), status ghi lần lỗi.
    const status = String((await conductor($, 'status')).text)
    expect(status).toContain('Router lỗi gần nhất: lỗi API overloaded 529')
    expect(status).not.toContain('Chưa có mục tiêu')
  })

  test('JSON hỏng hoặc thiếu lựa chọn luồng chính: coi như router lỗi', {}, async ($, on) => {
    const seen = base(on, { router: () => '{"goal": "x", "main": {"model": "gpt"' })
    await submit($, COMPLEX_PROMPT)
    expect(await step($, seen)).toEqual({ model: 'claude-sonnet-5-5', effort: 'medium' })
    expect(seen.toasts.some(t => t.includes('câu trả lời không đúng định dạng'))).toBe(true)
  })

  test('engine từ chối gọi model router: cũng không đoán', {}, async ($, on) => {
    const seen = base(on, { isRejected: true })
    await submit($, COMPLEX_PROMPT)
    expect(await step($, seen)).toEqual({ model: 'claude-sonnet-5-5', effort: 'medium' })
    expect(seen.toasts.some(t => t.includes('engine từ chối'))).toBe(true)
  })

  test('router lỗi sau một mục tiêu đã có: lựa chọn luồng chính không bị áp lên prompt mới; việc đã phân vẫn là của mục tiêu', {}, async ($, on) => {
    let isDown = false
    const seen = base(on, { router: request => (isDown ? null : DEFAULT_ROUTER(request)) })
    const agents: Array<string | undefined> = []
    on('tool.call', { tool: 'Agent' }, (_$, e) => {
      agents.push(e.model)
      return { deny: 'test: đã ghi nhận đầu vào' }
    })
    await submit($, FOUR)
    expect((await step($, seen, { turnId: 't1' }))?.model).toBe('claude-opus-5-5')
    isDown = true
    await submit($, 'Giờ chuyển sang việc khác hẳn: dọn thư mục build')
    expect(await step($, seen, { turnId: 't2' })).toEqual({ model: 'claude-sonnet-5-5', effort: 'medium' })
    const status = String((await conductor($, 'status')).text)
    expect(status).toContain('model của phiên (router chưa chọn)')
    // Việc đã phân của mục tiêu vẫn khớp và dùng đúng lựa chọn đã chấm, không hỏi router lần nữa.
    await $.tool.call({ tool: 'Agent', description: 'Việc 2: đổi tên userId', prompt: EDIT })
    expect(seen.agentRouted.length).toBe(0)
  })

  test('router lỗi ngay sau một turn đã chạy: route cũ không còn hiện trong status, trước cả turn mới', {}, async ($, on) => {
    let isDown = false
    const seen = base(on, { router: request => (isDown ? null : DEFAULT_ROUTER(request)) })
    await submit($, COMPLEX_PROMPT)
    await step($, seen, { turnId: 't1' })
    expect(String((await conductor($, 'status')).text)).toContain('opus/xhigh')
    isDown = true
    await submit($, 'Giờ dọn thư mục build cho sạch')
    const status = String((await conductor($, 'status')).text)
    expect(status).not.toContain('opus/xhigh')
    expect(status).toContain('model của phiên (router chưa chọn)')
  })

  test('router lỗi hai lần liên tiếp thì tạm bỏ qua router ba prompt, rồi hỏi lại', {}, async ($, on) => {
    const seen = base(on, { router: () => null })
    for (let i = 1; i <= 6; i++) await submit($, `Prompt thử số ${i} có nhiều chữ`)
    expect(seen.routed.length).toBe(3)
    expect(seen.toasts.some(t => t.includes('tạm bỏ qua router trong 3 prompt tới'))).toBe(true)
    expect(seen.contexts[3]?.join('\n')).toContain('router đang tạm ngừng')
  })
  test('lỗi không liên tiếp (lỗi, đọc được, lỗi) thì không tạm ngừng router', {}, async ($, on) => {
    let n = 0
    const seen = base(on, { router: request => ((n += 1) % 2 === 1 ? null : DEFAULT_ROUTER(request)) })
    for (let i = 1; i <= 4; i++) await submit($, `Prompt thử số ${i} có nhiều chữ`)
    expect(seen.routed.length).toBe(4)
    expect(seen.toasts.some(t => t.includes('tạm bỏ qua router'))).toBe(false)
  })
})

describe('prompt tiếp nối', () => {
  test('prompt một từ cũng hỏi router: router nói tiếp nối thì giữ mục tiêu', {}, async ($, on) => {
    const seen = base(on, { router: request => (request.includes('tiếp') ? plan({ relation: 'continue', goal: '' }) : DEFAULT_ROUTER(request)) })
    await submit($, FOUR)
    await submit($, 'tiếp')
    expect(seen.routed.length).toBe(2)
    expect(seen.contexts[1]?.join('\n')).toContain('Tiếp nối mục tiêu hiện tại: Nâng cấp module thanh toán')
  })

  test('tiếp nối thêm việc: việc mới đánh số tiếp theo, vào phần chờ giao; lựa chọn luồng chính theo router', {}, async ($, on) => {
    const seen = base(on, {
      router: request =>
        request.startsWith('Thêm')
          ? plan({ relation: 'refine', goal: '', main: { model: 'sonnet', effort: 'high' }, tasks: [task('Viết test webhook', 'agent', 'sonnet', 'medium')] })
          : DEFAULT_ROUTER(request),
    })
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, FOUR)
    await submit($, 'Thêm test cho webhook thanh toán nữa')
    const context = seen.contexts[1]?.join('\n') ?? ''
    expect(context).toContain('Tiếp nối mục tiêu hiện tại: Nâng cấp module thanh toán')
    // 0.7.5 A7: refine không hạ luồng chính dưới lượt trước (opus/xhigh của FOUR_PLAN); trước đây là sonnet/high của router.
    expect(context).toContain('Router: refine; luồng chính opus/xhigh')
    expect(context).toContain('5. Viết test webhook → giao general-purpose sonnet/medium')
    // Router thấy mục tiêu và các việc trước.
    expect(seen.routed[1]).toContain('Previous goal: Nâng cấp module thanh toán')
    expect(seen.routed[1]).toContain('  2. Đổi tên userId thành accountId trong 12 file controller. (general-purpose sonnet/medium)')
    const edit = await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
    expect((edit.context ?? []).join('\n')).toContain('Việc 1 (haiku/low), 2 (sonnet/medium), 4 (sonnet/medium), 5 (sonnet/medium)')
    // 0.7.5 A7: luồng chính giữ opus/xhigh của lượt trước (trước đây chạy sonnet/high của router).
    expect(await step($, seen)).toEqual({ model: 'claude-opus-5-5', effort: 'xhigh' })
  })

  test('nâng theo bằng chứng về 0 khi router quyết lại, kẻo nâng hai lần', {}, async ($, on) => {
    const seen = base(on, {
      router: request => (request.startsWith('vẫn') ? plan({ relation: 'dissatisfied', goal: '', main: { model: 'sonnet', effort: 'high' } }) : plan({ goal: 'Sửa typo' })),
    })
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'lỗi', isError: true }))
    await submit($, 'sửa typo trong README')
    await step($, seen, { turnId: 't1' })
    for (const file of ['a.txt', 'b.txt', 'c.txt']) await $.tool.call({ tool: 'Bash', command: `cat ${file}` })
    // Turn sau cùng prompt: nâng effort một bậc theo bằng chứng.
    expect((await step($, seen, { turnId: 't2' }))?.effort).toBe('high')
    // Người dùng báo chưa đạt: router đã thấy model đã chạy và tự nâng; mod không nâng thêm.
    await submit($, 'vẫn sai, README vẫn còn lỗi chính tả')
    expect(seen.routed[1]).toContain('Main thread ran: sonnet/high')
    expect(await step($, seen, { turnId: 't3' })).toEqual({ model: 'claude-sonnet-5-5', effort: 'high' })
  })

  test('ba tool call lỗi trong một turn thì turn sau nâng effort một bậc', {}, async ($, on) => {
    const seen = base(on)
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'lỗi', isError: true }))
    await submit($, 'sửa typo trong README')
    await step($, seen, { turnId: 't1' })
    for (const file of ['a.txt', 'b.txt', 'c.txt']) await $.tool.call({ tool: 'Bash', command: `cat ${file}` })
    expect(await step($, seen, { turnId: 't2', index: 1, messageCount: 3 })).toEqual({ model: 'claude-sonnet-5-5', effort: 'high' })
  })
})

describe('prompt dài và prompt đính kèm', () => {
  // Câu trả lời router mẫu cho K4: 11 mục có mã, 4 việc giao (sonnet/medium), 7 việc ở luồng chính (opus).
  const K4_TASKS = Array.from({ length: 11 }, (_, i) => {
    const code = `K4.${i + 1}`
    const isAgent = [2, 3, 6, 9].includes(i + 1)
    return isAgent ? task(`${code}. Việc giao`, 'agent', 'sonnet', 'medium') : task(`${code}. Việc luồng chính`, 'main', 'opus', 'high', { depth: 'hard' })
  })
  const K4_PLAN = plan({ goal: 'Engine ra quyết định đúng luật', depth: 'hard', volume: 'large', kind: 'mixed', main: { model: 'opus', effort: 'high' }, tasks: K4_TASKS })

  test('prompt K4: router nhận trọn prompt; phân việc đủ 11 mục, 4 việc giao, 7 việc ở luồng chính; "K4.N" khớp đúng việc', {}, async ($, on) => {
    const seen = base(on, { router: () => K4_PLAN })
    const models: Array<string | undefined> = []
    on('tool.call', { tool: 'Agent' }, (_$, e) => {
      models.push(e.model)
      return { deny: 'test: đã ghi nhận đầu vào' }
    })
    await submit($, K4_PROMPT)
    expect(requestOf(seen.routed[0] ?? '')).toBe(K4_PROMPT.trim())
    const context = seen.contexts[0]?.join('\n') ?? ''
    const block = context.split('Phân việc (router đã chấm')[1]?.split('Điều phối')[0] ?? ''
    expect(block.match(/^\d+\. K4\./gm)?.length).toBe(11)
    expect(block.match(/→ giao general-purpose sonnet\/medium/g)?.length).toBe(4)
    expect(block.match(/→ làm trực tiếp ở luồng chính \(opus\/high\)/g)?.length).toBe(7)
    await $.tool.call({ tool: 'Agent', description: 'K4.9 Báo cáo', prompt: 'làm' })
    await $.tool.call({ tool: 'Agent', description: 'Việc 6: phần 6', prompt: 'làm' })
    expect(models).toEqual(['sonnet', 'sonnet'])
    expect(seen.agentRouted.length).toBe(0)
  })

  test('prompt đính kèm chỉ để đối chiếu: phân việc của phần đính kèm, không thực thi, không theo dõi giao việc', {}, async ($, on) => {
    const seen = base(on, {
      router: () => plan({ ...K4_PLAN, reference: true, goal: 'Đối chiếu phân việc của prompt K4', kind: 'answer', main: { model: 'sonnet', effort: 'low' }, referenceMain: { model: 'opus', effort: 'high' } }),
    })
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Agent' }, () => ({ deny: 'test: đã ghi nhận đầu vào' }))
    await submit($, `${K4_META_LEAD}\n\n${K4_PROMPT}`)
    // Router nhận cả câu mở lẫn phần đính kèm: chính router nhận ra đây là đối chiếu.
    expect(requestOf(seen.routed[0] ?? '')).toContain(K4_META_LEAD)
    const context = seen.contexts[0]?.join('\n') ?? ''
    expect(context).toContain('Mục tiêu cuối: Đối chiếu phân việc của prompt K4')
    expect(context).toContain('Phân việc của prompt đính kèm (chỉ để đối chiếu: không thực thi, không giao subagent; luồng chính của prompt đó: opus/high)')
    expect(context).toContain('Không thực thi prompt đính kèm.')
    expect(context).toContain('luồng chính của lượt này sonnet/low')
    const edit = await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
    expect((edit.context ?? []).join('\n')).not.toContain('chưa giao')
    // Việc của prompt đối chiếu không khớp lời gọi Agent.
    await $.tool.call({ tool: 'Agent', description: 'Việc 2: phần 2', prompt: 'làm' })
    expect(seen.agentRouted.length).toBe(1)
  })

  test('sau lượt đối chiếu, người dùng yêu cầu chạy thật: việc đối chiếu thành việc thật và được theo dõi giao', {}, async ($, on) => {
    const seen = base(on, {
      router: request =>
        request.startsWith('ok')
          ? plan({ relation: 'continue', runReference: true, goal: '', kind: 'mixed', main: { model: 'opus', effort: 'high' } })
          : plan({ ...K4_PLAN, reference: true, goal: 'Đối chiếu K4', kind: 'answer', main: { model: 'sonnet', effort: 'low' }, referenceMain: { model: 'opus', effort: 'high' } }),
    })
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, `${K4_META_LEAD}\n\n${K4_PROMPT}`)
    await submit($, 'ok giờ chạy thật prompt đó đi')
    const context = seen.contexts[1]?.join('\n') ?? ''
    expect(context).toContain('Phân việc (router đã chấm trước khi làm')
    expect(context).not.toContain('chỉ để đối chiếu')
    // Vòng sửa 2 của 0.7.5 (M11): việc có mã (K4.N) chưa có checklist thì chưa xác định được bước nên chưa nhắc; checklist có
    // mã (K4.2 đang làm) thì nhắc đủ các việc giao chưa có bước hay đang làm.
    const before = await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
    expect((before.context ?? []).join('\n')).not.toContain('chưa giao')
    await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'set', steps: [{ title: 'K4.1. Việc luồng chính' }, { title: 'K4.2. Việc giao' }] })
    await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'update', step: 1, status: 'done' })
    await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'update', step: 2, status: 'doing' })
    const edit = await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
    expect((edit.context ?? []).join('\n')).toContain('Việc 2 (sonnet/medium), 3 (sonnet/medium), 6 (sonnet/medium), 9 (sonnet/medium)')
    expect(await step($, seen)).toEqual({ model: 'claude-opus-5-5', effort: 'high' })
  })
})

describe('0.5.0: prompt tiếp nối ngắn và đọc lại prompt', () => {
  test('mặc định (routerSkip trống) prompt "ok" vẫn qua router', {}, async ($, on) => {
    const seen = base(on)
    await submit($, FOUR)
    await submit($, 'ok')
    expect(seen.routed.length).toBe(2)
  })

  test('routerSkip: câu trong danh sách không hỏi router, giữ mục tiêu và điều phối; câu khác vẫn hỏi', { options: { routerSkip: 'ok, tiếp tục' } }, async ($, on) => {
    const seen = base(on)
    await submit($, FOUR)
    await step($, seen, { turnId: 't1' })
    await submit($, 'OK.')
    await submit($, 'Tiếp tục')
    expect(seen.routed.length).toBe(1)
    const context = seen.contexts[1]?.join('\n') ?? ''
    expect(context).toContain('Tiếp nối mục tiêu hiện tại: Nâng cấp module thanh toán')
    expect(context).toContain('router không đọc lại')
    // Điều phối luồng chính giữ nguyên lựa chọn của router cho mục tiêu.
    expect((await step($, seen, { turnId: 't2' }))?.model).toBe('claude-opus-5-5')
    await submit($, 'ok sửa luôn phần README')
    expect(seen.routed.length).toBe(2)
  })

  test('routerSkip khi chưa có mục tiêu: vẫn hỏi router', { options: { routerSkip: 'ok' } }, async ($, on) => {
    const seen = base(on)
    await submit($, 'ok')
    expect(seen.routed.length).toBe(1)
  })

  test('/conductor reroute: router đọc lại prompt gần nhất kể cả khi đang tạm ngừng, giữ checklist', {}, async ($, on) => {
    let isDown = true
    const seen = base(on, { router: request => (isDown ? null : DEFAULT_ROUTER(request)) })
    await submit($, 'Prompt thử số 1 có nhiều chữ')
    await submit($, FOUR)
    expect(seen.toasts.some(t => t.includes('tạm bỏ qua router'))).toBe(true)
    isDown = false
    const result = await conductor($, 'reroute')
    expect(result.text).toContain('Router đã đọc lại prompt gần nhất: Nâng cấp module thanh toán')
    expect(result.context?.join('\n')).toContain('2. Đổi tên userId thành accountId')
    // Router hết tạm ngừng: prompt sau được đọc ngay.
    await submit($, 'Thêm test cho webhook')
    expect(seen.routed.length).toBe(4)
    await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'set', steps: [{ title: 'Đổi tên' }] })
    const again = await conductor($, 'reroute')
    expect(again.text).toContain('Router đã đọc lại')
    expect(String((await conductor($, 'status')).text)).toContain('1. Đổi tên')
  })

  test('/conductor reroute khi router vẫn lỗi: giữ điều phối hiện tại; khi chưa có prompt: báo rõ', {}, async ($, on) => {
    let isDown = false
    base(on, { router: request => (isDown ? null : DEFAULT_ROUTER(request)) })
    expect((await conductor($, 'reroute')).text).toContain('Không có prompt nào')
    await submit($, FOUR)
    isDown = true
    expect((await conductor($, 'reroute')).text).toContain('Router không đọc được')
    expect(String((await conductor($, 'status')).text)).toContain('Mục tiêu: Nâng cấp module thanh toán')
  })

  test('/conductor reroute sau khi router lỗi ở prompt tiếp nối: áp phần đọc mới lên mục tiêu, không lập mục tiêu mới', {}, async ($, on) => {
    let isDown = false
    const seen = base(on, {
      router: request =>
        isDown ? null : request.startsWith('Thêm') ? plan({ relation: 'continue', goal: '', tasks: [task('Viết test webhook', 'agent', 'sonnet', 'medium')] }) : DEFAULT_ROUTER(request),
    })
    await submit($, FOUR)
    await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'set', steps: [{ title: 'Tìm chỗ gọi' }] })
    isDown = true
    await submit($, 'Thêm test cho webhook thanh toán nữa')
    isDown = false
    const result = await conductor($, 'reroute')
    expect(result.context?.join('\n')).toContain('5. Viết test webhook')
    const status = String((await conductor($, 'status')).text)
    expect(status).toContain('Mục tiêu: Nâng cấp module thanh toán')
    expect(status).toContain('1. Tìm chỗ gọi')
    void seen
  })

  test('/conductor goal hỏi router cả khi router đang tạm ngừng', {}, async ($, on) => {
    let isDown = true
    const seen = base(on, { router: request => (isDown ? null : DEFAULT_ROUTER(request)) })
    await submit($, 'Prompt thử số 1 có nhiều chữ')
    await submit($, 'Prompt thử số 2 có nhiều chữ')
    isDown = false
    const goal = await conductor($, 'goal Viết hàm parseDate cho ngày ISO')
    expect(goal.text).toContain('luồng chính sonnet/medium')
    expect(seen.routed.length).toBe(3)
  })
})

describe('0.5.0: hỏi lại router và bộ đếm lỗi riêng', () => {
  test('router trả JSON hỏng rồi trả đúng: prompt được đọc, chi phí cộng cả hai lượt, nhật ký ghi đã hỏi lại', { options: { decisionLog: '/tmp/fc.jsonl' } }, async ($, on) => {
    let n = 0
    const seen = base(on, { router: request => ((n += 1) === 1 ? '{"goal": "x", "main": {' : DEFAULT_ROUTER(request)) })
    const writes: string[] = []
    on('fs.write', (_$, e) => {
      writes.push(e.text)
      return { value: undefined }
    })
    await submit($, COMPLEX_PROMPT)
    expect(seen.routed.length).toBe(2)
    expect(seen.contexts[0]?.join('\n')).toContain('Mục tiêu cuối: Refactor module thanh toán')
    // Hai lượt router, mỗi lượt $0.007 ở giá sonnet.
    expect(String((await conductor($, 'status')).text)).toContain('Mục tiêu này, đo được: $0,01,')
    expect(JSON.parse(writes[writes.length - 1]?.trim() ?? '{}')).toMatchObject({ kind: 'route', retried: true })
  })

  test('router chấm subagent lỗi liên tiếp không làm tạm ngừng router đọc prompt', {}, async ($, on) => {
    const seen = base(on, { agent: () => null })
    on('tool.call', { tool: 'Agent' }, () => ({ deny: 'test' }))
    await submit($, FOUR)
    for (const n of [1, 2, 3]) await $.tool.call({ tool: 'Agent', description: `Rà soát phần ${n}`, prompt: `Rà soát phần ${n} của module` })
    expect(seen.toasts.some(t => t.includes('Router chấm subagent (sonnet) lỗi 2 lần liên tiếp'))).toBe(true)
    // Lần thứ ba trong thời gian tạm ngừng của router chấm subagent: không hỏi.
    expect(seen.agentRouted.length).toBe(2)
    await submit($, 'Viết hàm parseDate nhận chuỗi ISO và trả về Date')
    expect(seen.routed.length).toBe(2)
    expect(seen.toasts.some(t => t.includes('tạm bỏ qua router trong'))).toBe(false)
  })
})
