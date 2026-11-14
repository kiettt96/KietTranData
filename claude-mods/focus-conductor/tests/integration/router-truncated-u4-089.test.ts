// 0.8.9 U4 (tích hợp): conductor fable, prompt 100.000 ký tự; engine giả trả JSON bị cắt cho request đọc trọn và JSON đúng cho request đã cắt
// theo trần cũ. Context có bản đọc prompt, có cảnh báo prompt bị lược, mục tiêu không phải mục tiêu tối thiểu, dòng route có firstFail.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { PANE, base, plan, submit } from '../support/engine'

const GOAL = 'Mục tiêu router đọc được'
const MARK = 'DAU_CHO_GIUA_XQ'
const LONG = `Sửa luồng thanh toán. ${'a'.repeat(60_000)}${MARK}${'b'.repeat(40_000 - 22 - MARK.length)}`
const paneTexts = async ($: Engine) => (await (await $.ui.mount(PANE)).findAll({ type: 'Text' })).map(e => e.text).join('\n')

describe('0.8.9 U4: lượt đọc trọn bị cắt câu trả lời', () => {
  test('conductor fable, prompt 100.000 ký tự, câu trả lời của request đọc trọn bị cắt: request đã cắt đọc được; có cảnh báo; mục tiêu không tối thiểu; route có firstFail', { options: { planApproval: 'off', conductor: 'fable', decisionLog: '/tmp/fc-truncated-u4-089.jsonl' } }, async ($, on) => {
    const writes: string[] = []
    on('fs.write', (_$, e) => {
      writes.push(e.text)
      return { value: undefined }
    })
    const seen = base(on, { router: request => (request.includes(MARK) ? '{"goal": "Mục tiêu bị cắt' : plan({ goal: GOAL })) })
    await submit($, LONG)
    const prompts = seen.requests.filter(r => r.kind === 'prompt')
    expect(prompts.at(-1)?.timeoutMs).toBe(120_000)
    expect(prompts.at(-1)?.prompt.includes(MARK)).toBe(false)
    expect((seen.contexts.at(-1) ?? []).join('\n')).toContain(GOAL)
    expect(await paneTexts($)).toContain('router chỉ đọc')
    const lines = (writes.at(-1) ?? '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
    const route = lines.find(line => line['kind'] === 'route')
    expect(String(route?.['firstFail'] ?? '')).toContain('câu trả lời không đúng định dạng')
    expect(lines.some(line => line['kind'] === 'router-fail')).toBe(false)
  })
})
