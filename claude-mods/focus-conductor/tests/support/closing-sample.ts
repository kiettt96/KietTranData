// "Mục tiêu mẫu" của phần giao diện vòng 2 (U1 tới U8): mục tiêu substantial, loại edit, planApproval off, không khai checkCommands, đã mời
// agent general-purpose; checklist ba bước, bước 1 có check `bash tests/kiem.sh` trả "ĐẠT 5/5". Helper đọc chữ band, pane, status line.

import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { PANE, RUN, base, plan, step, submit } from './engine'
import type { Json, Seen } from './engine'

export const PLAN_TOOL = 'mcp__focus-conductor__plan'
export const CHECK = 'bash tests/kiem.sh'
export const STEPS = [{ title: 'Việc 1: tách hàm', check: `\`${CHECK}\`` }, { title: 'Việc 2: thêm cờ' }, { title: 'Việc 3: báo cáo' }]
export const sampleGoal = (over: Json = {}) => plan({ goal: 'Sửa thống kê', scope: ['/repo'], depth: 'substantial', volume: 'medium', kind: 'edit', main: { model: 'sonnet', effort: 'medium' }, ...over })
export const SAMPLE_OPTS = (over: Json = {}) => ({ options: { planApproval: 'off', ...over } })

export type Sample = { seen: Seen; outputs: Record<string, { text: string; isError?: boolean }> }
/** Dựng engine giả cho mục tiêu mẫu; `reply` thay câu trả lời router, `offer` false thì không mời agent nào. */
export function sampleSetup(on: On, reply: Json = sampleGoal()): Sample {
  const seen = base(on, { router: () => reply, root: '/repo' })
  const sample: Sample = { seen, outputs: { [CHECK]: { text: 'ĐẠT 5/5' } } }
  on('tool.call', { tool: /^(?:Edit|Write|Read|Agent)$/ }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    const out = sample.outputs[String((e as { command?: unknown }).command ?? '')] ?? { text: '' }
    return { result: out.text, ...(out.isError === true ? { isError: true } : {}) } as never
  })
  on('agent.spawn', (_$, e) => ({ model: 'claude-opus-5-5', agentId: `a-${String((e as { tool_use_id?: unknown }).tool_use_id)}` }) as never)
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  on('agent.offer', () => ({ isOffered: true }))
  // Tầng dưới của session.start (như engine nạp lại mod): mod đăng ký tool plan và lệnh /conductor ở đó.
  on('tool.register', () => ({ value: { tool: PLAN_TOOL } }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', (_$, e) => ({ cwd: (e as { cwd?: string }).cwd }) as never)
  return sample
}
export const offerAgent = ($: Engine) => $.agent.offer({ agent: 'general-purpose', description: 'việc chung', source: 'built-in', provider: { plugin: 'engine', tier: 'core' } } as never)
/** Mở mục tiêu mẫu: mời agent (trừ khi `offer` false), gửi prompt, lập checklist. */
export async function openSample($: Engine, sample: Sample, steps: ReadonlyArray<Record<string, unknown>> = STEPS, offer = true) {
  if (offer) await offerAgent($)
  await submit($, 'Sửa thống kê')
  await $.tool.call({ tool: PLAN_TOOL, action: 'set', steps } as never)
  await $.turn.start({ text: 'Sửa thống kê', turnId: 't1' })
  await step($, sample.seen, { turnId: 't1' })
}
export const callTool = async ($: Engine, input: Record<string, unknown>) => (await $.tool.call(input as never)) as { deny?: string; context?: string[] }
export const editSample = ($: Engine) => callTool($, { tool: 'Edit', file_path: '/repo/thong-ke.sh', old_string: 'a', new_string: 'b' })
export const runCheck = ($: Engine) => callTool($, { tool: 'Bash', command: CHECK })
export async function closeAll($: Engine, count = STEPS.length) {
  for (let k = 1; k <= count; k++) await $.tool.call({ tool: PLAN_TOOL, action: 'update', step: k, status: 'done' } as never)
}
let n = 0
/** Một lượt duyệt "Kiểm độc lập: " (opus) trả `text`. */
export async function reviewSample($: Engine, text = 'ĐẠT', description = 'Kiểm độc lập: thống kê') {
  const id = `u${(n += 1)}`
  await $.tool.call({ tool: 'Agent', tool_use_id: id, description, prompt: 'Rà.' } as never)
  await $.agent.spawn({ prompt: 'Rà.', description, tool_use_id: id } as never)
  await $.turn.complete({ turnId: `x-${id}`, agentId: `a-${id}`, answer: text, durationMs: 5, isAborted: false, reason: 'answer', usage: { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 10 } } as never)
}
export const stopSample = async ($: Engine) => String(((await $.classic.Stop({ stop_hook_active: false } as never)) as { block?: string }).block ?? '')
export const runCommand = async ($: Engine, args: string, origin: Json = { kind: 'composer' }) =>
  String(((await $.command.run({ command: 'conductor', args, origin, presentation: RUN.presentation } as never)) as { text?: string }).text ?? '')

type Mounted = Awaited<ReturnType<Engine['ui']['mount']>>
const panes = new WeakMap<Engine, Mounted>()
/** Chữ pane (mount một lần mỗi engine, mỗi lần đọc lại chữ của cùng bản); `rows` là số dòng thân pane lúc mount đầu. */
export async function paneText($: Engine, rows?: number, columns?: number): Promise<string> {
  const pane = panes.get($) ?? (await $.ui.mount({ ...PANE, props: { ...PANE.props, ...(rows !== undefined ? { scroll: { offset: 0, bodyRows: rows } } : {}), ...(columns !== undefined ? { bodyColumns: columns } : {}) } } as never))
  panes.set($, pane)
  return (await pane.findAll({ type: 'Text' })).map(e => e.text ?? '').join('\n')
}
/** Chữ band ở `columns` cột, hai dòng (mount rồi gỡ). */
export async function bandText($: Engine, columns = 72): Promise<string> {
  const band = await $.ui.mount({ plugin: 'focus-conductor', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 2, bodyColumns: columns, scroll: { offset: 0, bodyRows: 2 }, view: {} } } as never)
  const text = (await band.findAll({ type: 'Text' })).map(e => e.text ?? '').join('\n')
  await band.unmount()
  return text
}
/** Giá trị status line cuối mod đặt. */
export const lastStatus = (sample: Sample) => String(sample.seen.statuses[sample.seen.statuses.length - 1] ?? '')
