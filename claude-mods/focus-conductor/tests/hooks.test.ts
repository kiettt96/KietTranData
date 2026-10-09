// Test tích hợp: chạy hook của mod qua engine của `claude plugin test`.
// Hook của test nằm dưới plugin, đóng vai engine (nhận đầu vào đã bị mod sửa).

import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, TurnStepInput } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const HEURISTIC = { options: { analyzer: 'heuristic' } }

const COMPLEX_PROMPT = `### Mục tiêu
Refactor module thanh toán sang kiến trúc hướng sự kiện, đảm bảo bảo mật và hiệu năng.

1. Phân tích luồng hiện tại và các điểm nghẽn hiệu năng.
2. Thiết kế lại kiến trúc, nêu trade-off.
3. Migrate dần từng phần, viết test cho mỗi bước.
4. Kiểm tra bảo mật và đo lại hiệu năng.
- Không được thay đổi API công khai.`

type Seen = {
  contexts: string[][]
  steps: Array<{ model: string; effort?: TurnStepInput['effort'] }>
}

/**
 * Hook nền mà mọi test cần (đăng ký trước lần gọi $ đầu tiên): đồng hồ,
 * prompt, step của model, toast, status. Ghi lại thứ "engine" nhận được.
 */
function base(on: On): Seen {
  mock.clock(on, { now: 1000 })
  const seen: Seen = { contexts: [], steps: [] }
  on('prompt.submit', ($, e) => {
    seen.contexts.push([...(e.context ?? [])])
    return { text: e.text, context: e.context }
  })
  on('turn.step', async function* (_$, e) {
    seen.steps.push({ model: e.model, effort: e.effort })
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  return seen
}

async function submit($: Engine, text: string) {
  return $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
}

/** Chạy một step qua chuỗi hook, trả model/effort mà "engine" nhận được. */
async function step($: Engine, seen: Seen, input: Partial<TurnStepInput> = {}) {
  const stream = $.turn.step({
    turnId: 't1',
    index: 0,
    model: 'claude-sonnet-5-5',
    effort: 'medium',
    messageCount: 1,
    ...input,
  })
  for await (const chunk of stream) void chunk
  await stream.result
  return seen.steps[seen.steps.length - 1]
}

describe('đọc prompt', () => {
  test('gắn khối phân tích vào context trước khi model làm việc', HEURISTIC, async ($, on) => {
    const seen = base(on)
    await submit($, COMPLEX_PROMPT)
    const context = seen.contexts[0]?.join('\n') ?? ''
    expect(context).toContain('[focus-conductor]')
    expect(context).toContain('Mục tiêu cuối: Refactor module thanh toán')
    expect(context).toContain('Không được thay đổi API công khai')
    expect(context).toContain('mcp__focus-conductor__plan')
  })

  test('chế độ off để prompt đi qua nguyên vẹn', { options: { analyzer: 'heuristic', routing: 'off' } }, async ($, on) => {
    const seen = base(on)
    await submit($, COMPLEX_PROMPT)
    expect(seen.contexts[0]).toEqual([])
  })

  test('analyzer model dùng câu trả lời của Haiku', { options: { analyzer: 'model' } }, async ($, on) => {
    const seen = base(on)
    on('model.complete', () => ({
      value: {
        isAnswered: true as const,
        text: '{"goal":"Chuyển thanh toán sang event-driven","steps":["a","b"],"constraints":[],"quality":[],"tier":"complex","isNewGoal":true}',
        usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    }))
    await submit($, COMPLEX_PROMPT)
    expect(seen.contexts[0]?.join('\n')).toContain('Mục tiêu cuối: Chuyển thanh toán sang event-driven')
  })
})

describe('điều phối luồng chính', () => {
  test('việc rất phức tạp (deep) chạy opus/xhigh, giữ nguyên cho mọi step của turn', HEURISTIC, async ($, on) => {
    const seen = base(on)
    await submit($, COMPLEX_PROMPT)
    const first = await step($, seen)
    expect(first?.model).toBe('claude-opus-5-5')
    expect(first?.effort).toBe('xhigh')
    const second = await step($, seen, { index: 1, messageCount: 3 })
    expect(second?.model).toBe('claude-opus-5-5')
  })

  test('việc vặt ở turn đầu chạy haiku/low', HEURISTIC, async ($, on) => {
    const seen = base(on)
    await submit($, 'sửa typo trong README')
    const got = await step($, seen)
    expect(got?.model).toBe('claude-haiku-5-5')
    expect(got?.effort).toBe('low')
  })

  test('chế độ subagents không chạm luồng chính', { options: { analyzer: 'heuristic', routing: 'subagents' } }, async ($, on) => {
    const seen = base(on)
    await submit($, COMPLEX_PROMPT)
    const got = await step($, seen)
    expect(got?.model).toBe('claude-sonnet-5-5')
    expect(got?.effort).toBe('medium')
  })
})

describe('điều phối subagent', () => {
  test('điền model và effort khi Claude để trống, giữ khi Claude chỉ định', HEURISTIC, async ($, on) => {
    base(on)
    const seen: Array<{ model?: string; effort?: string; subagent_type?: string }> = []
    on('tool.call', { tool: 'Agent' }, (_$, e) => {
      seen.push({ model: e.model, effort: e.effort, subagent_type: e.subagent_type })
      return { deny: 'test: đã ghi nhận đầu vào' }
    })
    await $.tool.call({ tool: 'Agent', description: 'Viết test', prompt: 'Viết unit test cho hàm parseDate trong src/date.ts.' })
    await $.tool.call({
      tool: 'Agent',
      description: 'Viết test',
      prompt: 'Viết unit test cho hàm parseDate trong src/date.ts.',
      model: 'opus',
    })
    expect(seen[0]?.model).toBeDefined()
    expect(seen[0]?.effort).toBeDefined()
    expect(seen[1]?.model).toBe('opus')
  })
})

describe('checklist và chặn kết thúc', () => {
  test('checklist còn mở thì chặn dừng, đóng hết thì cho dừng', HEURISTIC, async ($, on) => {
    base(on)
    on('classic.Stop', () => ({}))
    await submit($, COMPLEX_PROMPT)
    const set = await $.tool.call({
      tool: 'mcp__focus-conductor__plan',
      action: 'set',
      goal: 'Refactor thanh toán',
      steps: [{ title: 'Phân tích' }, { title: 'Thiết kế' }],
    })
    expect(String(set.result)).toContain('Checklist (0/2 đã đóng)')

    const blocked = await $.classic.Stop({ stop_hook_active: false })
    expect(blocked.block).toContain('Checklist còn 2 bước mở')

    // Turn sau chỉ hỏi đáp, không thay đổi gì: không bị chặn dù checklist còn mở.
    await $.turn.start({ text: 'giải thích bước 1', turnId: 't2' })
    const question = await $.classic.Stop({ stop_hook_active: false })
    expect(question.block).toBeUndefined()

    const refused = await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'update', step: 1, status: 'verified' })
    expect(refused.deny).toContain('evidence')

    await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'update', step: 1, status: 'verified', evidence: 'đã đọc 3 file' })
    await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'update', step: 2, status: 'skipped', note: 'người dùng hoãn' })
    const allowed = await $.classic.Stop({ stop_hook_active: false })
    expect(allowed.block).toBeUndefined()
  })
})

describe('đổi mục tiêu qua tool plan', () => {
  test('plan "set" sang mục tiêu mới thì prompt khác chủ đề sau đó là mục tiêu mới', HEURISTIC, async ($, on) => {
    const seen = base(on)
    await submit(
      $,
      `Tạo plugin focus-conductor cho Claude Code:
1. Viết hooks phân tích prompt và điều phối model
2. Viết README hướng dẫn cài đặt plugin
3. Viết unit test cho hooks`,
    )
    await $.tool.call({
      tool: 'mcp__focus-conductor__plan',
      action: 'set',
      goal: 'Viết hàm slugify(text) bằng TypeScript, có unit test, code sạch có type đầy đủ.',
      steps: [{ title: 'slugify.ts: hàm slugify(text: string): string' }, { title: 'Unit test các trường hợp chính và biên' }],
    })
    await submit($, 'Bổ sung cho slugify: bỏ dấu tiếng Việt và cập nhật unit test.')
    await submit($, 'Sửa file README cho rõ cách cài đặt plugin.')

    expect(seen.contexts[1]?.join('\n')).toContain('Tiếp nối mục tiêu hiện tại: Viết hàm slugify')
    const readme = seen.contexts[2]?.join('\n') ?? ''
    expect(readme).toContain('Bản đọc prompt')
    expect(readme).toContain('Mục tiêu cuối: Sửa file README cho rõ cách cài đặt plugin.')
  })
})

describe('giao diện', () => {
  test('band hiện mục tiêu và tier trên terminal và desktop', HEURISTIC, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({
        plugin: 'focus-conductor',
        surface,
        component: 'AbovePrompt',
        props: {
          hasSurvey: false,
          isWorking: false,
          maxRows: 6,
          bodyColumns: 120,
          scroll: { offset: 0, bodyRows: 6 },
          view: {},
        },
      })
      expect(await ui.find({ type: 'Text', text: /Refactor module thanh toán/ })).toBeDefined()
      expect(await ui.find({ key: 'details' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('pane hiện checklist và đổi chế độ bằng nút', HEURISTIC, async ($, on) => {
    base(on)
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'set', steps: [{ title: 'Phân tích luồng' }] })
    const ui = await $.ui.mount({
      plugin: 'focus-conductor',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'focus-conductor',
      props: { title: 'Focus Conductor', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
    })
    expect(await ui.find({ type: 'Text', text: /Phân tích luồng/ })).toBeDefined()
    await ui.press({ key: 'mode-suggest' })
    expect(await ui.find({ type: 'Text', text: /Checklist 0\/1/ })).toBeDefined()
    await ui.unmount()
  })
})
