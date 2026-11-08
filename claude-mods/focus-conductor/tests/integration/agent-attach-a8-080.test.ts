// 0.8.0 A8: lời gọi Agent không khớp việc nào (taskMatch) gắn vào việc của bước doing hiện tại (stepCovers): dòng nhật ký agent ghi
// attached "doing-step", pane hiện subagent dưới việc ấy thay vì "Claude tự giao". Không có bước doing gắn được thì giữ "Claude tự giao".

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { PANE, base, plan, spawnTool, step, submit, task } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const LOG = '/tmp/fc-attach-a8-080.jsonl'
// Router chỉ nhận tối đa 20 việc (TASK_LIMIT): việc mang mã V8 là việc cuối, số 20.
const TASKS = [...Array.from({ length: 19 }, (_, i) => task(`Việc ${i + 1}: phần ${i + 1}`, 'main', 'sonnet', 'medium')), task('V8: chạy lại lô cuối', 'main', 'sonnet', 'medium')]

function logLines(on: On): () => Array<Record<string, unknown>> {
  const writes: string[] = []
  on('fs.write', (_$, e) => {
    writes.push(e.text)
    return { value: undefined }
  })
  return () => (writes[writes.length - 1] ?? '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
}

async function paneText($: Engine): Promise<string> {
  const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 100 } })
  const texts = (await pane.findAll({ type: 'Text' })).map(t => t.text ?? '').join('\n')
  await pane.unmount()
  return texts
}

async function start($: Engine, seen: ReturnType<typeof base>, steps: Array<{ title: string; status: string }>) {
  await submit($, 'Làm ba mươi phần')
  await $.tool.call({ tool: PLAN, action: 'set', steps: steps.map(s => ({ title: s.title })) })
  for (const [i, s] of steps.entries()) if (s.status !== 'todo') await $.tool.call({ tool: PLAN, action: 'update', step: i + 1, status: s.status })
  await $.turn.start({ text: 'Làm ba mươi phần', turnId: 't1' })
  await step($, seen, { turnId: 't1' })
}

describe('0.8.0 A8: subagent Claude tự giao gắn vào việc của bước doing', () => {
  test('bước doing "V8: chạy lại" phủ việc 20: subagent gắn việc 20, nhật ký attached, pane không ghi "Claude tự giao"', { options: { decisionLog: LOG } }, async ($, on) => {
    const lines = logLines(on)
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'ok' }))
    on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: `a-${e.tool_use_id}` }))
    const seen = base(on, { router: () => plan({ goal: 'Làm ba mươi phần', depth: 'substantial', volume: 'large', tasks: TASKS }) })
    await start($, seen, [{ title: 'Chuẩn bị dữ liệu', status: 'done' }, { title: 'V8: chạy lại', status: 'doing' }])
    await spawnTool($, 'tu-1', 'Evaluate batch results', 'Đánh giá kết quả lô')
    const line = lines().find(l => l['kind'] === 'agent' && l['description'] === 'Evaluate batch results')
    expect(line).toMatchObject({ kind: 'agent', attached: 'doing-step', task: 20 })
    const texts = await paneText($)
    expect(texts).toContain('Evaluate batch results')
    expect(texts).not.toContain('Claude tự giao')
  })

  test('không có bước doing: vẫn "Claude tự giao", nhật ký không có attached', { options: { decisionLog: LOG } }, async ($, on) => {
    const lines = logLines(on)
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'ok' }))
    on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: `a-${e.tool_use_id}` }))
    const seen = base(on, { router: () => plan({ goal: 'Làm ba mươi phần', depth: 'substantial', volume: 'large', tasks: TASKS }) })
    await start($, seen, [{ title: 'Chuẩn bị dữ liệu', status: 'done' }, { title: 'V8: chạy lại', status: 'todo' }])
    await spawnTool($, 'tu-2', 'Evaluate batch results', 'Đánh giá kết quả lô')
    expect(lines().some(l => l['attached'] !== undefined)).toBe(false)
    const texts = await paneText($)
    expect(texts).toContain('Claude tự giao')
  })
})
