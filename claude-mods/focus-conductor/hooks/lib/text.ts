// Văn bản mod gửi cho model và hiển thị cho người dùng. Gom về một chỗ để
// giữ giọng văn nhất quán và dễ chỉnh.

import type { Brief, Choice, PlanStep, Route, StepStatus, Task } from '../../types'
import { openSteps } from './drift'
import { describePick } from './route'

export const PLAN_TOOL = 'plan'
export const PLAN_TOOL_FULL = 'mcp__focus-conductor__plan'

/**
 * Mục system prompt cố định. Nội dung không đổi giữa các turn để không phá
 * prompt cache; mọi thông tin thay đổi theo prompt đi qua context của
 * prompt.submit (nằm trong messages, sau phần đã cache).
 */
export const DISCIPLINE = `# Focus Conductor
Mỗi prompt của người dùng có thể kèm một khối "[focus-conductor]" do model router của plugin đọc sẵn: mục tiêu cuối, các việc, ràng buộc, tiêu chí chất lượng, mức độ phức tạp và cách điều phối. Khối đó là bản đọc trước, không thay thế prompt gốc.
1. Đọc kỹ trước khi làm: đối chiếu khối phân tích với prompt gốc, sửa chỗ sai hoặc thiếu, xác định rõ mục tiêu cuối, ràng buộc và tiêu chí nghiệm thu, rồi mới gọi tool thực thi đầu tiên.
2. Với việc từ mức moderate trở lên: gọi ${PLAN_TOOL_FULL} (action "set") để ghi mục tiêu và checklist đã chuẩn hóa; cập nhật từng bước (doing, done, verified kèm bằng chứng, skipped hoặc blocked kèm lý do).
3. Nhất quán: mọi bước phải phục vụ mục tiêu cuối; không làm thêm việc ngoài phạm vi, không bỏ sót yêu cầu; giữ văn phong, quy ước đặt tên và định dạng đã dùng từ đầu.
4. Tự kiểm tra sau mỗi bước quan trọng (chạy test, type-check, đọc lại thay đổi) trước khi sang bước sau.
5. Khi giao việc cho subagent: nếu khối có mục "Phân việc", giao đúng các việc ghi "giao", description của Agent mở đầu "Việc N: " (N là số của việc) để chạy đúng model và effort đã phân; việc ghi "làm trực tiếp" thì tự làm. Việc ngoài danh sách: để trống model và effort, router của plugin chấm khi giao; chọn Explore cho tra cứu chỉ đọc, Plan cho thiết kế, general-purpose cho thực thi.
Nếu bạn là subagent: bỏ qua checklist, làm đúng nhiệm vụ được giao và báo cáo ngắn gọn.`

const MARKS: Record<StepStatus, string> = {
  todo: '[ ]',
  doing: '[~]',
  done: '[x]',
  verified: '[v]',
  skipped: '[-]',
  blocked: '[b]',
}

export function mark(status: StepStatus): string {
  return MARKS[status]
}

export function progress(plan: readonly PlanStep[]): { closed: number; total: number } {
  const closed = plan.filter(s => s.status === 'done' || s.status === 'verified' || s.status === 'skipped').length
  return { closed, total: plan.length }
}

function bullets(title: string, items: readonly string[]): string {
  return items.length === 0 ? '' : `\n${title}\n${items.map(item => `- ${item}`).join('\n')}`
}

function taskLine(task: Task, main: string): string {
  return task.run === 'main'
    ? `${task.index}. ${task.title} → làm trực tiếp ở luồng chính (${main})`
    : `${task.index}. ${task.title} → giao ${task.agentType ?? 'general-purpose'} ${describePick(task.pick)}`
}

/** Nhãn luồng chính: model sẽ chạy, kèm ghi chú khi mod chỉ đề xuất (suggest, subagents) và không đổi luồng chính. */
function mainLabel(main: Choice | null, isApplied: boolean): string {
  if (main === null) return 'model của phiên'
  return isApplied ? describePick(main) : `${describePick(main)} (chỉ đề xuất)`
}

/** Mục phân việc: mỗi việc kèm cách làm, model và effort router đã chấm trước khi làm. */
function taskBlock(tasks: readonly Task[], main: string, isReference: boolean): string {
  const lines = tasks.map(task => taskLine(task, main))
  if (isReference) {
    return `\nPhân việc của prompt đính kèm (chỉ để đối chiếu: không thực thi, không giao subagent; luồng chính của prompt đó: ${main}):\n${lines.join('\n')}`
  }
  return `\nPhân việc (router đã chấm trước khi làm; khi giao, description của Agent mở đầu "Việc N: " với N là số của việc):\n${lines.join('\n')}`
}

/**
 * Khối context đi kèm prompt khi bắt đầu một mục tiêu mới. `main` là model luồng chính sẽ
 * thật sự chạy (có thể là model cũ được giữ để bảo toàn cache); null khi chưa chọn.
 */
export function briefContext(brief: Brief, main: Choice | null, isApplied = true): string {
  const mainText = mainLabel(main, isApplied)
  const reference = brief.referenceMain ? describePick(brief.referenceMain) : 'chưa rõ'
  const tasks =
    brief.tasks.length === 0 ? '' : taskBlock(brief.tasks, brief.isReference ? reference : mainText, brief.isReference)
  const hasDelegation = brief.tasks.some(task => task.run === 'agent')
  const isSmall = brief.depth === 'none' || (brief.depth === 'light' && brief.volume === 'small')
  const next = brief.isReference
    ? 'Không thực thi prompt đính kèm. Chỉ trả lời phần đối chiếu phân việc ở trên, rồi dừng.'
    : isSmall
      ? 'Việc nhỏ: làm trực tiếp, không cần checklist; vẫn kiểm tra kết quả trước khi trả lời.'
      : `Trước khi thực thi: xác nhận mục tiêu, rồi gọi ${PLAN_TOOL_FULL} action "set" với checklist chuẩn hóa.`
  const routing = brief.isReference
    ? `Điều phối: prompt đính kèm chỉ để đối chiếu, không thực thi việc nào trong đó; luồng chính của lượt này ${mainText}.`
    : hasDelegation
      ? `Điều phối: luồng chính ${mainText}; việc ghi "giao" chạy đúng model đã ghi; subagent ngoài danh sách được router chấm khi giao.`
      : `Điều phối: luồng chính ${mainText}; subagent (nếu cần) được router chấm khi giao.`
  // Lượt đối chiếu không hiển thị ràng buộc và tiêu chí: chúng thuộc prompt đính kèm, không phải việc của lượt này.
  const rules = brief.isReference ? '' : `${bullets('Ràng buộc:', brief.constraints)}${bullets('Tiêu chí chất lượng:', brief.quality)}`
  return [
    '[focus-conductor] Bản đọc prompt của router (đối chiếu lại với prompt gốc trước khi làm)',
    `Mục tiêu cuối: ${brief.goal}${tasks}${rules}`,
    `Đánh giá: độ sâu ${brief.depth}, khối lượng ${brief.volume}, bản chất ${brief.kind}${brief.why ? ` (${brief.why})` : ''}`,
    routing,
    brief.scopePaths.length > 0 ? `Phạm vi được sửa: ${brief.scopePaths.join(', ')}` : '',
    next,
  ]
    .filter(Boolean)
    .join('\n')
}

/** Router không đọc được prompt: báo để Claude không dựa vào phân việc cũ. */
export function unroutedContext(reason: string): string {
  return (
    `[focus-conductor] Router không đọc được prompt này (${reason}). Không có phân việc mới; ` +
    'mod không chọn model cho turn này, và phân việc cũ (nếu có) không còn hiệu lực. ' +
    `Tự đọc kỹ prompt, và gọi ${PLAN_TOOL_FULL} action "set" nếu việc từ mức moderate trở lên.`
  )
}

/** Báo cho Claude biết checklist cũ còn bước mở đã được lưu vì prompt được xếp là mục tiêu mới. */
export function droppedPlanNotice(open: readonly PlanStep[]): string {
  return (
    `[focus-conductor] Checklist cũ còn ${open.length} bước mở đã được lưu vì prompt này được xếp là mục tiêu mới ` +
    `(${open.map(s => s.title).slice(0, 3).join('; ')}). Nếu thực ra đây là tiếp nối, gọi ${PLAN_TOOL_FULL} action "restore" ` +
    'để khôi phục mục tiêu và checklist cũ (trạng thái từng bước giữ nguyên).'
  )
}

/**
 * Khối context cho prompt tiếp nối cùng mục tiêu. `main` là lựa chọn luồng chính mới của router
 * (null khi không hỏi router); `added` là các việc mới router tách thêm.
 */
export function followUpContext(
  brief: Brief,
  plan: readonly PlanStep[],
  newConstraints: readonly string[],
  added: readonly Task[] = [],
  main: Choice | null = null,
  isApplied = true,
): string {
  const open = openSteps(plan)
  const mainText = mainLabel(main, isApplied)
  const lines = [
    `[focus-conductor] Tiếp nối mục tiêu hiện tại: ${brief.goal}`,
    main ? `Router: ${brief.relation}; luồng chính ${mainText}${brief.why ? ` (${brief.why})` : ''}` : '',
    added.length > 0
      ? `Việc mới (router đã chấm; khi giao, description của Agent mở đầu "Việc N: "):\n${added.map(task => taskLine(task, mainText)).join('\n')}`
      : '',
    open.length > 0 ? `Bước còn mở: ${open.map(s => `${s.id}. ${s.title}`).join('; ')}` : '',
    newConstraints.length > 0 ? `Ràng buộc mới: ${newConstraints.join('; ')}` : '',
    'Giữ nhất quán với phần đã làm; nếu yêu cầu này đổi mục tiêu, cập nhật lại checklist.',
  ]
  return lines.filter(Boolean).join('\n')
}

/** Prompt ngắn người dùng cho bỏ qua router (option routerSkip): giữ mục tiêu và điều phối đang có. */
export function skippedContext(brief: Brief, plan: readonly PlanStep[]): string {
  const open = openSteps(plan)
  return [
    `[focus-conductor] Tiếp nối mục tiêu hiện tại: ${brief.goal}`,
    'Prompt nằm trong danh sách routerSkip nên router không đọc lại; giữ nguyên phân việc và điều phối đang có.',
    open.length > 0 ? `Bước còn mở: ${open.map(s => `${s.id}. ${s.title}`).join('; ')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/** strictDelegation "block": lý do từ chối luồng chính tự sửa file khi còn việc ghi giao subagent chưa giao. */
export function blockText(waiting: readonly string[], left: number): string {
  return (
    `[focus-conductor] Còn việc ghi giao subagent chưa giao: Việc ${waiting.join(', ')}. ` +
    'Giao các việc đó qua Agent với description "Việc N: ..." trước khi luồng chính tự sửa file. ' +
    (left > 0
      ? `Nếu thay đổi này không thuộc các việc đó, giải thích ngắn rồi thử lại (còn ${left} lần chặn trong mục tiêu này).`
      : 'Đây là lần chặn cuối của mục tiêu này; từ lần sau chỉ nhắc.')
  )
}

/** Checklist dạng văn bản, trả về trong kết quả của tool plan. */
export function renderPlan(brief: Brief | null, plan: readonly PlanStep[]): string {
  if (plan.length === 0) return `${brief ? `Mục tiêu: ${brief.goal}\n` : ''}Checklist trống.`
  const { closed, total } = progress(plan)
  const rows = plan.map(step => {
    const note = step.note ? ` (${step.note})` : ''
    return `${mark(step.status)} ${step.id}. ${step.title}${note}`
  })
  const next = openSteps(plan)[0]
  const hint = next ? `\nBước tiếp theo: ${next.id}. ${next.title}` : ''
  const goal = brief ? `Mục tiêu: ${brief.goal}\n` : ''
  return `${goal}Checklist (${closed}/${total} đã đóng):\n${rows.join('\n')}${hint}`
}

/** Lý do chặn kết thúc khi checklist còn mở. */
export function stopBlockReason(plan: readonly PlanStep[]): string {
  const open = openSteps(plan)
  return (
    `[focus-conductor] Checklist còn ${open.length} bước mở: ` +
    `${open.map(s => `${s.id}. ${s.title}`).join('; ')}. ` +
    `Hoàn thành các bước đó, hoặc cập nhật trạng thái bằng ${PLAN_TOOL_FULL} ` +
    '(skipped hoặc blocked kèm lý do) trước khi kết thúc. Nếu đang chờ người dùng, đánh dấu blocked.'
  )
}

/** Một dòng tóm tắt cho status line. */
export function statusLine(brief: Brief | null, plan: readonly PlanStep[], route: Route | null, mode: string): string {
  if (brief === null) return mode
  const { closed, total } = progress(plan)
  const steps = total > 0 ? ` · ${closed}/${total}` : ''
  const model = route ? ` · ${describePick(route)}` : ''
  return `${brief.tier}${model}${steps}${mode === 'auto' ? '' : ` · ${mode}`}`
}
