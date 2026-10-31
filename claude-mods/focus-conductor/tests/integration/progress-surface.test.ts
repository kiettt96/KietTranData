// 0.6.1 2.5: band (AbovePrompt) và pane vẽ được trên mọi surface có component đó, với ba loại nội dung tiến độ.
// Band chỉ có trên terminal và desktop; pane có trên terminal, desktop, vscode, mobile.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { COMPLEX_PROMPT, FOUR, PANE, base, spawnTool, submit } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const BAND_SURFACES = ['terminal', 'desktop'] as const
const PANE_SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const

type Todo = { content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm: string }
const todo = (content: string, status: Todo['status']): Todo => ({ content, status, activeForm: content })

/** Câu trả lời của engine cho TodoWrite và các tool của việc giao subagent. */
function hooks(on: On) {
  on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: `a-${e.tool_use_id}` }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', { tool: 'TodoWrite' }, (_$, e) => ({ result: { oldTodos: [], newTodos: (e as unknown as { todos: Todo[] }).todos } }) as never)
  on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }) as never)
}

/** Dựng band trên một surface, kiểm engine nhận cây, trả các Text. */
async function bandTexts($: Engine, surface: (typeof BAND_SURFACES)[number]) {
  const band = await $.ui.mount({
    plugin: 'focus-conductor',
    surface,
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 6 }, view: {} },
  })
  expect(await band.drawn()).toMatchObject({ type: 'Box' })
  const texts = (await band.findAll({ type: 'Text' })).map(e => e.text)
  await band.unmount()
  return texts
}

/** Dựng pane trên một surface, kiểm engine nhận cây, trả các Text. */
async function paneTexts($: Engine, surface: (typeof PANE_SURFACES)[number]) {
  const pane = await $.ui.mount({ ...PANE, surface })
  expect(await pane.drawn()).toMatchObject({ type: 'Box' })
  const texts = (await pane.findAll({ type: 'Text' })).map(e => e.text)
  await pane.unmount()
  return texts
}

const has = (texts: readonly string[], pattern: RegExp | string) => texts.some(t => (typeof pattern === 'string' ? t === pattern : pattern.test(t)))

describe('0.6.1 2.5: band và pane trên các surface', () => {
  test('checklist nguồn mirror: band có 1/2, pane ghi nguồn danh sách việc của Claude Code, trên mọi surface', {}, async ($, on) => {
    base(on)
    hooks(on)
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: 'TodoWrite', todos: [todo('Đọc mã', 'completed'), todo('Sửa', 'in_progress')] } as never)
    for (const surface of BAND_SURFACES) {
      expect(has(await bandTexts($, surface), '1/2'), `band ${surface}`).toBe(true)
    }
    for (const surface of PANE_SURFACES) {
      expect(has(await paneTexts($, surface), /danh sách việc của Claude Code/), `pane ${surface}`).toBe(true)
    }
  })

  test('checklist nguồn plan: band có 0/2, pane có Checklist 0/2 và không ghi nguồn phản chiếu, trên mọi surface', {}, async ($, on) => {
    base(on)
    hooks(on)
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Một' }, { title: 'Hai' }] })
    for (const surface of BAND_SURFACES) {
      expect(has(await bandTexts($, surface), '0/2'), `band ${surface}`).toBe(true)
    }
    for (const surface of PANE_SURFACES) {
      const texts = await paneTexts($, surface)
      expect(has(texts, /^Danh sách bước 0\/2/), `pane ${surface} có tiêu đề checklist`).toBe(true)
      expect(has(texts, /danh sách việc của Claude Code/), `pane ${surface} không ghi nguồn`).toBe(false)
    }
  })

  test('mục Tiến độ từng việc đủ các loại việc, trên mọi surface', {}, async ($, on) => {
    base(on)
    hooks(on)
    await submit($, FOUR)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Việc 3: phác kiến trúc' }] })
    await spawnTool($, 'u1', 'Việc 1: tìm chỗ gọi charge', 'tìm')
    await spawnTool($, 'u9', 'Kiểm tra log lỗi thanh toán', 'kiểm tra')
    await $.turn.complete({ turnId: 't1', agentId: 'a-u1', answer: '', durationMs: 1, isAborted: false, reason: 'answer' } as never)
    for (const surface of PANE_SURFACES) {
      const texts = await paneTexts($, surface)
      expect(has(texts, /^Tiến độ từng việc \d+ ─/), `pane ${surface} tiêu đề`).toBe(true)
      // 0.7.6 U1: luồng chính chính là danh sách bước nên không còn dòng "Việc chính"; việc 3 khớp bước "Việc 3: ..." nên đi cùng
      // dòng bước đó (chip "opus xhigh"), không có dòng riêng.
      expect(has(texts, /^Việc chính: /), `pane ${surface} việc chính`).toBe(false)
      expect(has(texts, /^Việc 1: /), `pane ${surface} việc 1`).toBe(true)
      expect(has(texts, /^Việc 3: Thiết kế/), `pane ${surface} việc 3`).toBe(false)
      expect(has(texts, /^opus xhigh$/), `pane ${surface} chip việc 3`).toBe(true)
      expect(has(texts, /^Claude tự giao: Kiểm tra log/), `pane ${surface} tự giao`).toBe(true)
      expect(has(texts, 'xong'), `pane ${surface} xong`).toBe(true)
      expect(has(texts, 'chờ giao'), `pane ${surface} chờ giao`).toBe(true)
    }
    for (const surface of BAND_SURFACES) {
      expect(has(await bandTexts($, surface), /^(Việc \d|Claude tự giao): /), `band ${surface}`).toBe(true)
    }
  })
})
