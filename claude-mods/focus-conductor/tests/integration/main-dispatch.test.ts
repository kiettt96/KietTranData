// Test tích hợp: điều phối model và effort của luồng chính theo router, model không phản hồi, engine tự đổi model, system prompt.
// Gom từ tests/hooks.test.ts; tên describe và test giữ nguyên.

import { describe, expect, test } from 'claude-code/testing'
import { COMPLEX_PROMPT, PANE, base, conductor, step, submit } from '../support/engine'

describe('điều phối luồng chính theo router', () => {
  test('step đầu nhận đúng model và effort router chọn, giữ nguyên cho mọi step của turn', {}, async ($, on) => {
    const seen = base(on)
    await submit($, COMPLEX_PROMPT)
    const first = await step($, seen)
    expect(first).toEqual({ model: 'claude-opus-5-5', effort: 'xhigh' })
    expect((await step($, seen, { index: 1, messageCount: 3 }))?.model).toBe('claude-opus-5-5')
  })

  test('router chọn haiku/low cho hỏi đáp thì luồng chính chạy haiku/low', {}, async ($, on) => {
    const seen = base(on)
    await submit($, 'Liệt kê các hàm export trong utils.ts')
    expect(await step($, seen)).toEqual({ model: 'claude-haiku-5-5', effort: 'low' })
  })

  test('chế độ subagents không chạm luồng chính', { options: { routing: 'subagents' } }, async ($, on) => {
    const seen = base(on)
    await submit($, COMPLEX_PROMPT)
    expect(await step($, seen)).toEqual({ model: 'claude-sonnet-5-5', effort: 'medium' })
  })

  test('sessionModel ceiling: luồng chính không vượt model của phiên', { options: { sessionModel: 'ceiling' } }, async ($, on) => {
    const seen = base(on)
    await submit($, COMPLEX_PROMPT)
    expect((await step($, seen, { model: 'claude-sonnet-5-5', effort: 'medium' }))?.model).toBe('claude-sonnet-5-5')
  })

  test('sessionModel fixed: giữ model của phiên, effort theo router', { options: { sessionModel: 'fixed' } }, async ($, on) => {
    const seen = base(on)
    await submit($, 'Liệt kê các hàm export trong utils.ts')
    expect(await step($, seen, { model: 'claude-sonnet-5-5', effort: 'high' })).toEqual({ model: 'claude-sonnet-5-5', effort: 'low' })
  })

  test('không có route đã lưu thì so với model engine đang chạy: nâng cấp ghi đúng "từ haiku/xhigh"', {}, async ($, on) => {
    // Turn đầu chạy opus nhưng model thất bại nên route bị xóa; engine vẫn là haiku/xhigh.
    const seen = base(on, { failFamily: 'opus' })
    on('turn.complete', () => ({ text: '' }))
    await submit($, COMPLEX_PROMPT)
    await step($, seen, { turnId: 't1', model: 'claude-haiku-5-5', effort: 'xhigh' })
    await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as never)
    await submit($, 'Viết hàm parseDate nhận chuỗi ISO và trả về Date')
    await step($, seen, { turnId: 't2', model: 'claude-haiku-5-5', effort: 'xhigh' })
    expect(String((await conductor($, 'status')).text)).toContain('sonnet/medium (việc khó hơn, nâng cấp từ haiku/xhigh)')
  })

  test('người dùng tự đổi model rồi sang mục tiêu mới: quyết định so với model đang chạy, có tính chi phí cache', {}, async ($, on) => {
    const seen = base(on)
    on('turn.complete', () => ({ text: '' }))
    await submit($, COMPLEX_PROMPT)
    await step($, seen, { turnId: 't1' })
    await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as never)
    await step($, seen, { turnId: 't2', model: 'claude-opus-5-5', effort: 'xhigh' })
    await submit($, 'Viết hàm parseDate nhận chuỗi ISO và trả về Date')
    expect((await step($, seen, { turnId: 't3', model: 'claude-opus-5-5', effort: 'xhigh' }))?.model).toBe('claude-sonnet-5-5')
    const status = String((await conductor($, 'status')).text)
    expect(status).toContain('hạ xuống sonnet/medium')
    expect(status).not.toContain('turn đầu tiên')
  })

  test('model cũ được giữ vì đổi không đáng chi phí cache: bản đọc ghi đúng model sẽ chạy', {}, async ($, on) => {
    const seen = base(on)
    on('turn.complete', () => ({ text: '' }))
    await submit($, COMPLEX_PROMPT)
    await step($, seen, { turnId: 't1' })
    await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as never)
    // Router chọn opus/high; hạ effort từ xhigh không bù được chi phí ghi lại cache nên opus/xhigh được giữ.
    await submit($, 'Fix race condition khi hai worker cùng ghi file cache')
    expect(seen.contexts[1]?.join('\n')).toContain('luồng chính opus/xhigh')
    expect((await step($, seen, { turnId: 't2' }))?.effort).toBe('xhigh')
  })
})

describe('model được chọn không phản hồi', () => {
  test('lỗi một lần chỉ quay về model của engine; lỗi hai turn liên tiếp mới bị chặn, hết chặn sau 5 turn', {}, async ($, on) => {
    const seen = base(on, { failFamily: 'opus' })
    await submit($, COMPLEX_PROMPT)
    const attempts = async (turnId: string) => {
      const from = seen.steps.length
      await step($, seen, { turnId, messageCount: 3 })
      return seen.steps.slice(from).map(s => s.model)
    }
    const retried = ['claude-opus-5-5', 'claude-sonnet-5-5']
    expect(await attempts('t1')).toEqual(retried)
    expect(await attempts('t2')).toEqual(retried)
    for (const id of ['t3', 't4', 't5', 't6']) expect(await attempts(id)).toEqual(['claude-sonnet-5-5'])
    expect(await attempts('t7')).toEqual(retried)
  })

  test('lỗi một lần chưa chặn: /conductor status không báo model tạm ngừng', {}, async ($, on) => {
    const seen = base(on, { failFamily: 'opus' })
    await submit($, COMPLEX_PROMPT)
    await step($, seen, { turnId: 't1', messageCount: 3 })
    expect((await conductor($, 'status')).text).not.toContain('tạm ngừng')
  })
})

describe('system prompt', () => {
  const FACTS = { model: 'claude-sonnet-5-5', promptModel: 'claude-sonnet-5-5', surfaces: [], tools: [], outputStyle: null, traits: [] } as const

  test('thêm mục kỷ luật làm việc (nói rõ khối do router đọc), tắt khi mode off', {}, async ($, on) => {
    base(on)
    const result = await $.prompt.compose(FACTS)
    const section = result.sections.find(s => s.id === 'focus-conductor:discipline')
    expect(section?.text).toContain('do model router của plugin đọc sẵn')
    expect(section?.text).toContain('description của Agent mở đầu "Việc N: "')
    await conductor($, 'mode off')
    expect((await $.prompt.compose(FACTS)).sections).toEqual([])
  })
})

describe('0.5.0: engine tự đổi model khác người dùng đổi model', () => {
  const SWITCH = { from_model: 'claude-sonnet-5-5', requested_model: null, context_tokens: 0, prompt_cache_warm: false, cache_ttl: '5m', estimated_cache_write_usd: 0 } as const

  test('engine tự đổi (source auto): mod vẫn điều phối luồng chính, nhật ký ghi là engine', {}, async ($, on) => {
    const seen = base(on)
    on('classic.PostModelSwitch', () => ({}))
    await submit($, COMPLEX_PROMPT)
    expect((await step($, seen, { turnId: 't1' }))?.model).toBe('claude-opus-5-5')
    await $.classic.PostModelSwitch({ ...SWITCH, to_model: 'claude-haiku-5-5', source: 'auto' } as never)
    expect((await step($, seen, { turnId: 't2', model: 'claude-haiku-5-5' }))?.model).toBe('claude-opus-5-5')
    const ui = await $.ui.mount(PANE)
    expect(await ui.find({ type: 'Text', text: /engine tự đổi model phiên sang claude-haiku-5-5 \(auto\)/ })).toBeDefined()
    await ui.unmount()
  })

  test('người dùng gõ /model (source command): tạm dừng tự điều phối tới mục tiêu mới', {}, async ($, on) => {
    const seen = base(on)
    on('classic.PostModelSwitch', () => ({}))
    await submit($, COMPLEX_PROMPT)
    await step($, seen, { turnId: 't1' })
    await $.classic.PostModelSwitch({ ...SWITCH, to_model: 'claude-haiku-5-5', source: 'command' } as never)
    expect((await step($, seen, { turnId: 't2', model: 'claude-haiku-5-5' }))?.model).toBe('claude-haiku-5-5')
  })

  test('engine không báo nguồn (không có hook): đổi model giữa các turn vẫn coi là người dùng đổi', {}, async ($, on) => {
    const seen = base(on)
    await submit($, COMPLEX_PROMPT)
    await step($, seen, { turnId: 't1' })
    expect((await step($, seen, { turnId: 't2', model: 'claude-haiku-5-5' }))?.model).toBe('claude-haiku-5-5')
  })

  test('lần đổi do engine chỉ áp cho đúng lần đổi đó: người dùng đổi tiếp sau đó thì tạm dừng', {}, async ($, on) => {
    const seen = base(on)
    on('classic.PostModelSwitch', () => ({}))
    await submit($, COMPLEX_PROMPT)
    await step($, seen, { turnId: 't1' })
    await $.classic.PostModelSwitch({ ...SWITCH, to_model: 'claude-haiku-5-5', source: 'auto' } as never)
    await step($, seen, { turnId: 't2', model: 'claude-haiku-5-5' })
    expect((await step($, seen, { turnId: 't3', model: 'claude-sonnet-5-5' }))?.model).toBe('claude-sonnet-5-5')
  })
})
