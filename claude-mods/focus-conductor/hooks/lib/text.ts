// Văn bản mod gửi cho model và hiển thị cho người dùng. Gom về một chỗ để
// giữ giọng văn nhất quán và dễ chỉnh.

import type { Brief, PlanStep, Route, StepStatus } from '../../types'
import { openSteps } from './drift'
import { describePick, stepHint } from './route'

export const PLAN_TOOL = 'plan'
export const PLAN_TOOL_FULL = 'mcp__focus-conductor__plan'

/**
 * Mục system prompt cố định. Nội dung không đổi giữa các turn để không phá
 * prompt cache; mọi thông tin thay đổi theo prompt đi qua context của
 * prompt.submit (nằm trong messages, sau phần đã cache).
 */
export const DISCIPLINE = `# Focus Conductor
Mỗi prompt của người dùng có thể kèm một khối "[focus-conductor]" do plugin phân tích sẵn: mục tiêu cuối, các bước, ràng buộc, tiêu chí chất lượng và mức độ phức tạp. Khối đó là bản đọc nhanh, không thay thế prompt gốc.
1. Đọc kỹ trước khi làm: đối chiếu khối phân tích với prompt gốc, sửa chỗ sai hoặc thiếu, xác định rõ mục tiêu cuối, ràng buộc và tiêu chí nghiệm thu, rồi mới gọi tool thực thi đầu tiên.
2. Với việc từ mức moderate trở lên: gọi ${PLAN_TOOL_FULL} (action "set") để ghi mục tiêu và checklist đã chuẩn hóa; cập nhật từng bước (doing, done, verified kèm bằng chứng, skipped hoặc blocked kèm lý do).
3. Nhất quán: mọi bước phải phục vụ mục tiêu cuối; không làm thêm việc ngoài phạm vi, không bỏ sót yêu cầu; giữ văn phong, quy ước đặt tên và định dạng đã dùng từ đầu.
4. Tự kiểm tra sau mỗi bước quan trọng (chạy test, type-check, đọc lại thay đổi) trước khi sang bước sau.
5. Khi giao việc cho subagent: để trống model và effort, plugin tự chọn theo độ khó; chọn Explore cho tra cứu chỉ đọc, Plan cho thiết kế, general-purpose cho thực thi.
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

/** Khối context đi kèm prompt khi bắt đầu một mục tiêu mới. */
export function briefContext(brief: Brief, route: Route | null): string {
  const steps =
    brief.steps.length === 0 ? '' : `\nBước dự kiến:\n${brief.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
  const main = route ? describePick(route) : 'chưa chọn'
  const isSmall = brief.depth === 'none' || (brief.depth === 'light' && brief.volume === 'small')
  const next = isSmall
    ? 'Việc nhỏ: làm trực tiếp, không cần checklist; vẫn kiểm tra kết quả trước khi trả lời.'
    : `Trước khi thực thi: xác nhận mục tiêu, rồi gọi ${PLAN_TOOL_FULL} action "set" với checklist chuẩn hóa.`
  return [
    '[focus-conductor] Bản đọc prompt (tự động; đối chiếu lại với prompt gốc trước khi làm)',
    `Mục tiêu cuối: ${brief.goal}${steps}${bullets('Ràng buộc:', brief.constraints)}${bullets('Tiêu chí chất lượng:', brief.quality)}`,
    `Đánh giá: độ sâu ${brief.depth}, khối lượng ${brief.volume}, bản chất ${brief.kind} (${brief.signals.slice(0, 5).join(', ')})`,
    `Điều phối: luồng chính ${main}; subagent được chọn theo độ khó của từng việc con, không thấp hơn mục tiêu cha.`,
    brief.scopePaths.length > 0 ? `Phạm vi được sửa: ${brief.scopePaths.join(', ')}` : '',
    next,
  ]
    .filter(Boolean)
    .join('\n')
}

/** Báo cho Claude biết checklist cũ còn bước mở đã bị bỏ vì prompt được xếp là mục tiêu mới. */
export function droppedPlanNotice(open: readonly PlanStep[]): string {
  return (
    `[focus-conductor] Checklist cũ còn ${open.length} bước mở đã bị bỏ vì prompt này được xếp là mục tiêu mới ` +
    `(${open.map(s => s.title).slice(0, 3).join('; ')}). Nếu thực ra đây là tiếp nối, gọi ${PLAN_TOOL_FULL} action "set" để lập lại.`
  )
}

/** Khối context cho prompt tiếp nối cùng mục tiêu. */
export function followUpContext(brief: Brief, plan: readonly PlanStep[], newConstraints: readonly string[]): string {
  const open = openSteps(plan)
  const lines = [
    `[focus-conductor] Tiếp nối mục tiêu hiện tại: ${brief.goal}`,
    open.length > 0 ? `Bước còn mở: ${open.map(s => `${s.id}. ${s.title}`).join('; ')}` : '',
    newConstraints.length > 0 ? `Ràng buộc mới: ${newConstraints.join('; ')}` : '',
    'Giữ nhất quán với phần đã làm; nếu yêu cầu này đổi mục tiêu, cập nhật lại checklist.',
  ]
  return lines.filter(Boolean).join('\n')
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
  const tier = next?.tier ?? brief?.tier
  const hint = next ? `\nBước tiếp theo: ${next.id}. ${next.title}${tier ? ` (gợi ý: ${stepHint(tier)})` : ''}` : ''
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
