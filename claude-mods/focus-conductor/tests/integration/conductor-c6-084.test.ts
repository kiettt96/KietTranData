// 0.8.4 C6: router Fable lỗi ROUTER_FAIL_LIMIT lần liên tiếp thì tạm ngừng ROUTER_PAUSE prompt (bộ đếm và số prompt còn lại trong
// Core.fable, sống qua hot reload): trong lúc đó các lượt router dùng option router với thời gian chờ và effort của 0.8.3, luồng chính
// theo main của router; hết số prompt thì thử lại Fable. Một lượt Fable đạt đưa bộ đếm về 0. Lỗi của Fable không cộng vào bộ đếm tạm
// ngừng router cũ. Mỗi lần vào tạm ngừng: một toast, một cảnh báo model, một dòng nhật ký conductor; status hiện nhãn Fable tạm ngừng.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { PANE, ROUTER_TIMEOUT, base, conductor, plan, step, submit } from '../support/engine'
import type { Json, Seen } from '../support/engine'

const LOG = '/tmp/fc-conductor-c6-084.jsonl'
const FABLE = { options: { planApproval: 'off', conductor: 'fable', decisionLog: LOG } }
/** 0.8.7 F1: các ca mô tả cách chạy khi Fable không dùng được mà không có họ dự phòng. */
const NO_FALLBACK = { options: { ...FABLE.options, conductorFallback: 'off' } }
const ID = 'fable'
const BIG = (over: Json = {}) => plan({ goal: 'Sửa luồng thanh toán', depth: 'substantial', volume: 'medium', kind: 'edit', main: { model: 'sonnet', effort: 'medium', why: '' }, ...over })
const FOLLOW = plan({ relation: 'continue', goal: '', depth: 'substantial', volume: 'medium', kind: 'edit', main: { model: 'sonnet', effort: 'medium', why: '' } })
const PAUSE_TEXT = 'Fable điều phối tạm ngừng'
const prompts = (seen: Seen) => seen.routerCalls.filter(c => c.kind === 'prompt')

/** Router giả: model Fable trả `fable(n)` (lỗi khi null), model khác trả kế hoạch tiếp nối. */
function setup(on: Parameters<typeof base>[0], fable: (n: number) => Json | string | null) {
  let n = 0
  const seen: Seen = base(on, { router: () => (seen.routerModels.at(-1) === ID ? fable(n++) : FOLLOW) })
  on('turn.complete', () => ({ text: '' }))
  const writes: string[] = []
  on('fs.write', (_$, e) => {
    writes.push(e.text)
    return { value: undefined }
  })
  const lines = () => (writes[writes.length - 1] ?? '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
  return { seen, lines }
}

const paneTexts = async ($: Engine) => (await (await $.ui.mount(PANE)).findAll({ type: 'Text' })).map(e => e.text).join('\n')

describe('0.8.4 C6: router Fable tạm ngừng rồi thử lại', () => {
  test('lỗi API hai prompt liên tiếp: prompt 3 tới 5 gửi sonnet với 45 giây, đúng một cảnh báo và nhãn; prompt 6 gửi lại Fable', NO_FALLBACK, async ($, on) => {
    const { seen, lines } = setup(on, () => null)
    for (let i = 0; i < 6; i++) await submit($, i === 0 ? 'Sửa luồng thanh toán' : `làm tiếp bước ${i}`)
    expect(prompts(seen).map(c => c.model)).toEqual([ID, ID, 'sonnet', 'sonnet', 'sonnet', ID])
    expect(prompts(seen)[2]).toEqual({ kind: 'prompt', model: 'sonnet', effort: 'medium', timeoutMs: 45_000 })
    expect(seen.toasts.filter(t => t.includes(PAUSE_TEXT)).length).toBe(1)
    expect(lines().filter(l => l['kind'] === 'conductor' && String(l['reason'] ?? '').includes('tạm ngừng')).length).toBe(1)
  })

  test('trong lúc tạm ngừng: status và pane có nhãn Fable tạm ngừng, cảnh báo model nêu model thay', NO_FALLBACK, async ($, on) => {
    const { seen } = setup(on, () => null)
    for (let i = 0; i < 3; i++) await submit($, i === 0 ? 'Sửa luồng thanh toán' : `làm tiếp bước ${i}`)
    expect(seen.statuses.at(-1) ?? '').toContain('Fable tạm ngừng')
    const pane = await paneTexts($)
    expect(pane).toContain(PAUSE_TEXT)
    expect(pane).toContain('sonnet')
  })

  test('hot reload giữa lúc tạm ngừng: vẫn tạm ngừng, số prompt còn lại giữ nguyên', NO_FALLBACK, async ($, on) => {
    const { seen } = setup(on, () => null)
    on('tool.register', () => ({ value: { tool: 'mcp__focus-conductor__plan' } }) as never)
    on('command.register', () => ({ value: { command: 'conductor' } }) as never)
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    for (let i = 0; i < 3; i++) await submit($, i === 0 ? 'Sửa luồng thanh toán' : `làm tiếp bước ${i}`)
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: true } as never)
    for (let i = 3; i < 6; i++) await submit($, `làm tiếp bước ${i}`)
    expect(prompts(seen).map(c => c.model)).toEqual([ID, ID, 'sonnet', 'sonnet', 'sonnet', ID])
  })

  test('Fable hết giờ một lần rồi đạt: bộ đếm về 0, lỗi tiếp theo không làm tạm ngừng', FABLE, async ($, on) => {
    // Mỗi prompt một kết quả: prompt 1 hết giờ (cả lượt thử lại), prompt 2 đạt, prompt 3 hết giờ, prompt 4 vẫn gửi Fable.
    let prompt = 0
    const { seen } = setup(on, () => (prompt === 1 || prompt === 3 ? ROUTER_TIMEOUT : BIG()))
    const models: string[] = []
    for (prompt = 1; prompt <= 4; prompt++) {
      const before = prompts(seen).length
      await submit($, prompt === 1 ? 'Sửa luồng thanh toán' : `làm tiếp bước ${prompt}`)
      models.push(prompts(seen)[before]?.model ?? '')
    }
    expect(models).toEqual([ID, ID, ID, ID])
    expect(seen.toasts.some(t => t.includes(PAUSE_TEXT))).toBe(false)
  })

  test('trong lúc tạm ngừng, mục tiêu lớn: luồng chính theo main của router, không gửi Fable', NO_FALLBACK, async ($, on) => {
    const { seen } = setup(on, n => (n === 0 ? BIG() : null))
    for (let i = 0; i < 3; i++) await submit($, i === 0 ? 'Sửa luồng thanh toán' : `làm tiếp bước ${i}`)
    const ran = await step($, seen, { turnId: 't3' })
    expect(`${ran?.model}/${String(ran?.effort)}`).toBe('claude-sonnet-5-5/medium')
  })
})

describe('0.8.4 W3: vẫn gọi Fable khi router cũ còn tạm ngừng', () => {
  /** Fable lỗi 2 prompt (tạm ngừng 3 prompt), router thay thế cũng lỗi 2 prompt (router cũ tạm ngừng 3 prompt); prompt 6 Fable sẵn sàng. */
  async function bothPaused($: Engine, on: Parameters<typeof base>[0]) {
    let fable = 0
    const seen: Seen = base(on, { router: request => (seen.routerModels.at(-1) === ID ? (fable++ < 2 ? null : request.startsWith('Requirements:') ? { missing: [], extra: [], issues: [] } : BIG()) : null) })
    on('turn.complete', () => ({ text: '' }))
    on('classic.Stop', () => ({}))
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    for (let i = 1; i <= 6; i++) await submit($, i === 6 ? 'Sửa luồng thanh toán' : `làm tiếp bước ${i}`)
    return seen
  }

  test('lượt đọc prompt và lượt rà kế hoạch gửi Fable dù router cũ còn tạm ngừng', { options: { conductor: 'fable', enforceChecklist: true } }, async ($, on) => {
    const seen = await bothPaused($, on)
    expect(prompts(seen).at(-1)?.model).toBe(ID)
    await $.turn.start({ text: 'việc', turnId: 't6' })
    await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'set', steps: [{ title: 'Sửa hàm phí', check: 'bun test' }, { title: 'Thêm test', check: 'bun test' }] } as never)
    await $.classic.Stop({ stop_hook_active: false } as never)
    expect(seen.routerCalls.filter(c => c.kind === 'review').map(c => c.model)).toEqual([ID])
  })

  test('lượt kiểm lạc đề gửi Fable dù router cũ còn tạm ngừng', { options: { planApproval: 'off', conductor: 'fable' } }, async ($, on) => {
    const seen = await bothPaused($, on)
    // 0.8.6 R1: luồng chính đang điều phối không tự sửa file; solo để các lần Edit dựng tình huống được chạy.
    await conductor($, 'solo')
    for (const f of ['a', 'b', 'c', 'd', 'e']) await $.tool.call({ tool: 'Edit', file_path: `src/${f}.ts`, old_string: 'x', new_string: 'y' } as never)
    expect(seen.routerCalls.filter(c => c.kind === 'drift').map(c => c.model)).toEqual([ID])
  })
})

describe('0.8.4 C6: conductor mặc định giữ luật tạm ngừng router của 0.8.3', () => {
  test('router lỗi hai prompt: prompt thứ ba không hỏi router', { options: { planApproval: 'off' } }, async ($, on) => {
    const seen = base(on, { router: () => null })
    for (let i = 0; i < 3; i++) await submit($, i === 0 ? 'Sửa luồng thanh toán' : `làm tiếp bước ${i}`)
    expect(prompts(seen).length).toBe(2)
    expect(seen.toasts.some(t => t.includes(PAUSE_TEXT))).toBe(false)
  })
})

describe('0.8.4 W4: nhật ký nguyên nhân, lượt kiểm lạc đề và ID phiên', () => {
  test('ready vẫn false nhưng nguyên nhân đổi từ tạm ngừng sang chế độ: có dòng conductor mới', FABLE, async ($, on) => {
    const { lines } = setup(on, () => null)
    await conductor($, 'mode subagents')
    for (let i = 0; i < 6; i++) await submit($, i === 0 ? 'Sửa luồng thanh toán' : `làm tiếp bước ${i}`)
    const reasons = lines().filter(l => l['kind'] === 'conductor').map(l => String(l['reason'] ?? ''))
    expect(reasons).toEqual(['chế độ điều phối không phải auto', 'router Fable tạm ngừng sau các lần lỗi', 'chế độ điều phối không phải auto'])
  })

  test('hai lượt kiểm lạc đề gửi Fable đều lỗi: router Fable tạm ngừng, prompt kế gửi router cũ', NO_FALLBACK, async ($, on) => {
    const seen = base(on, { router: () => (seen.routerModels.at(-1) === ID ? BIG() : FOLLOW), drift: () => null })
    on('turn.complete', () => ({ text: '' }))
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, 'Sửa luồng thanh toán')
    // 0.8.6 R1: luồng chính đang điều phối không tự sửa file; solo để các lần Edit dựng tình huống được chạy.
    await conductor($, 'solo')
    for (let i = 0; i < 10; i++) {
      if (i === 5) await seen.clock.advance(600_000)
      await $.tool.call({ tool: 'Edit', file_path: `src/f${i}.ts`, old_string: 'x', new_string: 'y' } as never)
    }
    expect(seen.routerCalls.filter(c => c.kind === 'drift').map(c => c.model)).toEqual([ID, ID])
    await submit($, 'làm tiếp bước 1')
    expect(prompts(seen).at(-1)?.model).toBe('sonnet')
    expect(seen.toasts.filter(t => t.includes(PAUSE_TEXT)).length).toBe(1)
  })

  test('phiên họ fable có hậu tố: lượt router sau step đầu dùng nguyên ID của phiên', FABLE, async ($, on) => {
    const seen = base(on, { router: () => BIG() })
    await submit($, 'Sửa luồng thanh toán')
    await step($, seen, { turnId: 't1', model: 'claude-fable-5-2[1m]' })
    await submit($, 'làm tiếp bước 1')
    expect(prompts(seen).map(c => c.model)).toEqual([ID, 'claude-fable-5-2[1m]'])
  })
})
