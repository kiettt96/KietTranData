// Văn bản mod gửi cho model và hiển thị cho người dùng. Gom về một chỗ để
// giữ giọng văn nhất quán và dễ chỉnh.

import type { Brief, Choice, PlanStep, QuotaCheckpoint, QuotaReason, Route, StepStatus, Task } from '../../types'
import { openSteps, pendingSteps } from './drift'
import { evaluateQuota, isStale, reasonsOf } from './quota'
import type { QuotaBadge, QuotaThresholds } from './quota'
import { labels } from '../ui/labels'
import { taskBarRuns } from '../ui/style'
import type { Lang } from '../ui/labels'
import { describePick } from './route'
import { uncoveredRequirements } from './router'

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
2. Với việc từ mức moderate trở lên: gọi ${PLAN_TOOL_FULL} (action "set") để ghi mục tiêu và checklist đã chuẩn hóa; cập nhật từng bước (doing, done, verified kèm bằng chứng, skipped, blocked hoặc waiting kèm lý do). Khi checklist có việc của mục "Phân việc", tiêu đề bước mở đầu "Việc N: ".
3. Nhất quán: mọi bước phải phục vụ mục tiêu cuối; không làm thêm việc ngoài phạm vi, không bỏ sót yêu cầu; giữ văn phong, quy ước đặt tên và định dạng đã dùng từ đầu.
4. Tự kiểm tra sau mỗi bước quan trọng (chạy test, type-check, đọc lại thay đổi) trước khi sang bước sau. Lệnh test chạy đạt sau thay đổi cuối thì mod tự nâng bước đã xong thành verified, không cần chép lệnh; kiểm tĩnh (type-check, lint) không tính.
5. Khi giao việc cho subagent: nếu khối có mục "Phân việc", giao đúng các việc ghi "giao", description của Agent mở đầu "Việc N: " (N là số của việc) để chạy đúng model và effort đã phân; việc ghi "làm trực tiếp" thì tự làm. Việc ngoài danh sách: để trống model và effort, router của plugin chấm khi giao; chọn Explore cho tra cứu chỉ đọc, Plan cho thiết kế, general-purpose cho thực thi.
Nếu bạn là subagent: không dùng tool plan của mod; việc từ ba bước trở lên thì ghi danh sách bằng tool danh sách việc có sẵn (nếu có trong phiên của bạn); làm đúng nhiệm vụ được giao và báo cáo ngắn gọn.`

const MARKS: Record<StepStatus, string> = {
  todo: '[ ]',
  doing: '[~]',
  done: '[x]',
  verified: '[v]',
  skipped: '[-]',
  blocked: '[b]',
  waiting: '[w]',
}

export function mark(status: StepStatus): string {
  return MARKS[status]
}

export function progress(plan: readonly PlanStep[]): { closed: number; total: number } {
  const closed = plan.filter(s => s.status === 'done' || s.status === 'verified' || s.status === 'skipped').length
  return { closed, total: plan.length }
}

/** Số bước verified (đã kiểm chứng): mod tự nâng khi lệnh test chạy đạt sau thay đổi cuối, hoặc Claude ghi kèm bằng chứng (0.7.0). */
export function verifiedCount(plan: readonly PlanStep[]): number {
  return plan.filter(s => s.status === 'verified').length
}

/** Số bước đã đóng kèm " · k✓" khi có bước verified; band, pane và status line dùng chung một dạng. */
export function countLabel(plan: readonly PlanStep[]): string {
  const { closed, total } = progress(plan)
  const verified = verifiedCount(plan)
  return `${closed}/${total}${verified > 0 ? ` · ${verified}✓` : ''}`
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
  // Yêu cầu router đã liệt kê mà không việc nào phủ (0.7.0): nhắc để không bị bỏ sót khi lập checklist.
  const uncovered = brief.isReference ? [] : uncoveredRequirements(brief)
  const gaps = uncovered.length > 0 ? `\nYêu cầu chưa có việc nào phủ (đừng bỏ sót khi lập checklist): ${uncovered.join('; ')}` : ''
  return [
    '[focus-conductor] Bản đọc prompt của router (đối chiếu lại với prompt gốc trước khi làm)',
    `Mục tiêu cuối: ${brief.goal}${tasks}${gaps}${rules}`,
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

/** "N bước mở", "M bước đang chờ" hoặc cả hai, cho các bước khôi phục được (todo, doing, waiting). */
export function restorableLabel(steps: readonly PlanStep[]): string {
  const waiting = steps.filter(s => s.status === 'waiting').length
  const open = steps.length - waiting
  if (waiting === 0) return `${open} bước mở`
  return open === 0 ? `${waiting} bước đang chờ` : `${open} bước mở và ${waiting} bước đang chờ`
}

/** Báo cho Claude biết checklist cũ còn bước mở (hoặc đang chờ) đã được lưu vì prompt được xếp là mục tiêu mới. */
export function droppedPlanNotice(open: readonly PlanStep[]): string {
  return (
    `[focus-conductor] Checklist cũ còn ${restorableLabel(open)} đã được lưu vì prompt này được xếp là mục tiêu mới ` +
    `(${open.map(s => s.title).slice(0, 3).join('; ')}). Nếu thực ra đây là tiếp nối, gọi ${PLAN_TOOL_FULL} action "restore" ` +
    'để khôi phục mục tiêu và checklist cũ (trạng thái từng bước giữ nguyên).'
  )
}

/** Dòng nhắc bước waiting hoặc blocked khi làm tiếp mục tiêu: các bước đó không chặn Stop nên phải được đặt lại thì mới được theo dõi. */
function pendingLine(plan: readonly PlanStep[]): string {
  const pending = pendingSteps(plan)
  if (pending.length === 0) return ''
  return (
    `Bước đang chờ hoặc bị chặn: ${pending.map(s => `${s.id}. ${s.title}`).join('; ')}. ` +
    'Khi làm tiếp các bước đó, đặt lại về todo hoặc doing bằng action "update" để cổng Stop theo dõi lại.'
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
    uncoveredRequirements(brief).length > 0 ? `Yêu cầu chưa có việc nào phủ (đừng bỏ sót): ${uncoveredRequirements(brief).join('; ')}` : '',
    pendingLine(plan),
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
    pendingLine(plan),
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

/**
 * "verified" chưa đủ bằng chứng: bước được lưu là done, kèm lý do và việc cần làm để nâng lên verified.
 * `examples` (0.5.6): có mặt khi evidence không nhắc lệnh kiểm tra nào chạy sau thay đổi cuối (weak, none); thêm gợi ý
 * option checkCommands, ví dụ lấy từ lệnh script đã chạy (rỗng thì dùng ví dụ trung tính). Mức stale không truyền.
 */
export function unbackedNotice(reason: string, examples?: readonly string[]): string {
  const base =
    `[focus-conductor] Bước được lưu là done, chưa tính là đã kiểm tra: ${reason}. ` +
    'Chạy lệnh test (không phải kiểm tĩnh như type-check, lint, build) sau thay đổi cuối cùng: mod sẽ tự nâng bước done thành verified, ' +
    'không cần chép lệnh vào evidence. Việc chỉ đọc, chưa sửa gì thì nêu lệnh hay file đã đọc.'
  if (examples === undefined) return base
  const sample = examples[0] ?? 'python3 check_totals.py'
  return (
    `${base} Nếu bước này được kiểm bằng script riêng của dự án, người dùng khai option checkCommands của mod ` +
    `(lệnh phân tách bằng dấu phẩy, khớp theo tiền tố token, ví dụ \`${sample}\`); model không tự khai được. ` +
    'Khi chưa khai, bước vẫn là done: nêu với người dùng lệnh đã chạy và kết quả.'
  )
}

/** Bằng chứng mạnh nhưng chỉ có kiểm tĩnh (type-check, lint, build): ghi chú để Claude cân nhắc chạy test. */
export function staticOnlyNotice(): string {
  return '[focus-conductor] Ghi chú: bằng chứng chỉ là kiểm tĩnh (type-check, lint, build, validate), chưa chạy test hành vi. Nếu bước thay đổi hành vi, chạy test tương ứng.'
}

/** Bước có tiêu chí nghiệm thu: nhắc lại để Claude đối chiếu với bằng chứng vừa ghi. */
export function criteriaNotice(step: { id: number; check?: string }): string {
  return `[focus-conductor] Tiêu chí nghiệm thu của bước ${step.id}: ${step.check ?? ''}. Đối chiếu bằng chứng với tiêu chí này; chưa đạt thì mở lại bước (doing).`
}

/** Bước mở cuối cùng vừa đóng: yêu cầu xác nhận từng tiêu chí chất lượng của mục tiêu trước khi kết thúc. */
export function qualityNotice(quality: readonly string[]): string {
  return (
    '[focus-conductor] Checklist đã đóng hết. Trước khi kết thúc, xác nhận từng tiêu chí chất lượng của mục tiêu bằng bằng chứng cụ thể ' +
    `(lệnh đã chạy, kết quả, file): ${quality.map((q, i) => `(${i + 1}) ${q}`).join('; ')}. Tiêu chí nào chưa đạt thì thêm bước bằng action "add".`
  )
}

/** Option remindSubagents: nhắc subagent đang lạc đề, kèm việc nó được giao (không nhắc checklist của luồng chính). */
export function subagentReminder(task: string, finding: string): string {
  return `[focus-conductor] Việc được giao cho subagent này: ${task}\n${finding.replace(/^\[focus-conductor\]\s*/, '')}\nQuay về đúng việc được giao và báo cáo ngắn gọn.`
}

/** Option semanticDrift: router nhận xét các thay đổi gần đây có thể không còn phục vụ mục tiêu. */
export function driftContext(goal: string, why: string): string {
  return (
    `[focus-conductor] Router đọc các thay đổi gần đây và thấy có thể đang lệch mục tiêu: ${why}. ` +
    `Mục tiêu: ${goal}. Nếu thay đổi này thật sự cần cho mục tiêu, ghi rõ lý do; nếu không, quay về bước còn mở.`
  )
}

/**
 * Checklist dạng văn bản, trả về trong kết quả của tool plan. `changed` (0.5.6): chỉ in hàng của các bước đó và bỏ dòng
 * Mục tiêu (kết quả update và add); không truyền thì in đủ.
 */
export function renderPlan(brief: Brief | null, plan: readonly PlanStep[], changed?: readonly number[]): string {
  if (plan.length === 0) return `${brief ? `Mục tiêu: ${brief.goal}\n` : ''}Checklist trống.`
  const shown = changed === undefined ? plan : plan.filter(step => changed.includes(step.id))
  const goal = brief && changed === undefined ? `Mục tiêu: ${brief.goal}\n` : ''
  return `${goal}${totalLine(plan)}\n${shown.map(step => stepRow(step)).join('\n')}${nextLine(plan)}`
}

/** Một hàng của checklist: dấu trạng thái, id, tiêu đề, tiêu chí nghiệm thu và ghi chú. */
export function stepRow(step: PlanStep): string {
  const note = step.note ? ` (${step.note})` : ''
  const check = step.check ? ` [nghiệm thu: ${step.check}]` : ''
  return `${mark(step.status)} ${step.id}. ${step.title}${check}${note}`
}

/** Dòng tổng: số bước đã đóng, thêm số bước đang chờ và bị chặn khi có (bỏ vế bằng 0). */
export function totalLine(plan: readonly PlanStep[]): string {
  const { closed, total } = progress(plan)
  const waiting = plan.filter(s => s.status === 'waiting').length
  const blocked = plan.filter(s => s.status === 'blocked').length
  const extra = [waiting > 0 ? `${waiting} đang chờ` : '', blocked > 0 ? `${blocked} bị chặn` : ''].filter(Boolean)
  return `Checklist (${closed}/${total} đã đóng${extra.length > 0 ? `, ${extra.join(', ')}` : ''}):`
}

/** Dòng cuối: bước mở tiếp theo; không còn bước mở mà còn bước waiting thì liệt kê các bước đang chờ (tối đa 3). */
export function nextLine(plan: readonly PlanStep[]): string {
  const next = openSteps(plan)[0]
  if (next) return `\nBước tiếp theo: ${next.id}. ${next.title}`
  const waiting = plan.filter(s => s.status === 'waiting').slice(0, 3)
  return waiting.length > 0 ? `\nĐang chờ: ${waiting.map(s => `${s.id}. ${s.title}`).join('; ')}` : ''
}

/** id liên tiếp rút thành dải: [1,2,3,5,7,8] thành "1-3, 5, 7-8". */
export function idRanges(ids: readonly number[]): string {
  const sorted = [...new Set(ids)].sort((a, b) => a - b)
  const out: string[] = []
  for (let i = 0; i < sorted.length; ) {
    let j = i
    while (j + 1 < sorted.length && (sorted[j + 1] ?? 0) === (sorted[j] ?? 0) + 1) j += 1
    out.push(j > i ? `${sorted[i]}-${sorted[j]}` : `${sorted[i]}`)
    i = j + 1
  }
  return out.join(', ')
}

/** Kết quả của update hàng loạt: dòng tổng, một dòng nêu các bước đã chuyển và ghi chú chung, rồi bước tiếp theo (nếu còn bước mở). Không in từng hàng. */
export function renderBulk(plan: readonly PlanStep[], changed: readonly number[], status: StepStatus, note: string): string {
  const moved = `Đã chuyển ${changed.length} bước sang ${status}: id ${idRanges(changed)}.${note ? ` Ghi chú: ${note}` : ''}`
  // Hết bước mở thì pendingNotice (đi kèm) đã liệt kê các bước đang chờ hoặc bị chặn, không lặp lại ở đây.
  return `${totalLine(plan)}\n${moved}${openSteps(plan).length > 0 ? nextLine(plan) : ''}`
}

/** Mọi bước đã hết mở nhưng còn bước chờ hoặc bị chặn: không được tuyên bố hoàn tất. */
export function pendingNotice(plan: readonly PlanStep[]): string {
  const pending = pendingSteps(plan)
  return (
    `[focus-conductor] Không còn bước mở, nhưng còn ${pending.length} bước đang chờ hoặc bị chặn: ` +
    `${pending.slice(0, 3).map(s => `${s.id}. ${s.title}`).join('; ')}. ` +
    'Các bước đó chưa tính là xong: nói rõ với người dùng, không tuyên bố hoàn tất.'
  )
}

/** Lý do chặn kết thúc khi checklist còn mở hoặc còn việc giao subagent đã lỗi chưa giao lại. */
export function stopBlockReason(plan: readonly PlanStep[], failed: readonly string[] = []): string {
  const open = openSteps(plan)
  const parts: string[] = []
  if (open.length > 0) {
    parts.push(
      `[focus-conductor] Checklist còn ${open.length} bước mở: ` +
        `${open.map(s => `${s.id}. ${s.title}`).join('; ')}. ` +
        `Hoàn thành các bước đó, hoặc cập nhật trạng thái bằng ${PLAN_TOOL_FULL} ` +
        '(skipped, blocked hoặc waiting kèm lý do) trước khi kết thúc. Đang chờ lệnh nền, tiến trình hay người dùng thì ghi waiting; blocked dành cho vướng mắc không tự gỡ được. ' +
        'Dừng cả checklist theo lệnh người dùng: một lần gọi action "update" với allOpen true, status waiting hoặc blocked và một note chung.',
    )
  }
  if (failed.length > 0) {
    parts.push(
      `[focus-conductor] Việc giao subagent đã lỗi, chưa giao lại: Việc ${failed.join(', ')}. ` +
        'Giao lại qua Agent với description "Việc N: ...", tự làm việc đó, hoặc báo người dùng lý do bỏ qua trước khi kết thúc.',
    )
  }
  return parts.join('\n')
}

/** Một dòng tóm tắt cho status line. */
/** Số ô của thanh chữ trên status line (0.6.1). */
export const STATUS_BAR = 8

export function statusLine(brief: Brief | null, plan: readonly PlanStep[], route: Route | null, mode: string): string {
  if (brief === null) return mode
  const { total } = progress(plan)
  // Thanh chữ cùng ký hiệu với band (barRuns), không màu: surface không có band (vscode, mobile) vẫn thấy tiến độ.
  const bar = taskBarRuns({ kind: 'steps', plan: [...plan] }, STATUS_BAR).map(run => run.text).join('')
  const steps = total > 0 ? ` · ${bar ? `${bar} ` : ''}${countLabel(plan)}` : ''
  const model = route ? ` · ${describePick(route)}` : ''
  return `${brief.tier}${model}${steps}${mode === 'auto' ? '' : ` · ${mode}`}`
}

// ------------------------------------------------------------ bảo vệ hạn mức (0.6.0)

const QUOTA_NAME: Record<QuotaReason['kind'], string> = { five_hour: 'hạn mức phiên (5 giờ)', seven_day: 'hạn mức tuần' }

/** Mốc làm mới theo giờ của máy (HH:MM dd/MM); rỗng khi không có hoặc không đọc được. */
export function resetLabel(resetsAt: string | undefined): string {
  if (resetsAt === undefined) return ''
  const at = new Date(resetsAt)
  if (!Number.isFinite(at.getTime())) return ''
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(at.getHours())}:${two(at.getMinutes())} ${two(at.getDate())}/${two(at.getMonth() + 1)}`
}

function percent(value: number): string {
  return `${String(Math.round(value * 10) / 10).replace('.', ',')}%`
}

/** Một cửa sổ đã qua ngưỡng: tên, phần còn lại, ngưỡng và giờ làm mới. */
export function quotaReasonText(reason: QuotaReason): string {
  const remaining = Math.max(0, Math.round((100 - reason.percentUsed) * 10) / 10)
  const reset = resetLabel(reason.resetsAt)
  return `${QUOTA_NAME[reason.kind]} chỉ còn ${percent(remaining)} (ngưỡng ${percent(reason.thresholdRemainingPct)})${reset ? `, làm mới lúc ${reset}` : ''}`
}

function pauseCause(reasons: readonly QuotaReason[], isUser: boolean): string {
  if (isUser) return 'người dùng yêu cầu tạm dừng (/conductor pause)'
  return reasons.length > 0 ? reasons.map(quotaReasonText).join('; ') : 'hạn mức sắp hết'
}

/** Lệnh chạy tiếp: người dùng tự dừng thì /conductor resume là đủ; dừng vì hạn mức thì phải ép (resume force). */
export function resumeCommand(isUser: boolean): string {
  return isUser ? '/conductor resume' : '/conductor resume force'
}

/** Lý do từ chối tool khi đang dừng: luồng chính ghi điểm dừng rồi kết thúc; subagent kết thúc ngay. */
export function quotaDenyText(reasons: readonly QuotaReason[], isUser: boolean, isAgent: boolean): string {
  const cause = `[focus-conductor] Tạm dừng: ${pauseCause(reasons, isUser)}.`
  if (isAgent) return `${cause} Subagent không gọi tool nào khác; kết thúc ngay và báo ngắn phần đã làm, phần còn dở.`
  return (
    `${cause} Không gọi tool nào khác. Gọi ${PLAN_TOOL_FULL} với action "checkpoint" và note nêu: bước kế tiếp cụ thể, ` +
    'những gì đã hoàn tất không được làm lại, và điều cần kiểm khi quay lại. Sau đó kết thúc turn bằng một câu báo điểm dừng ' +
    `và nhắc người dùng chạy tiếp bằng ${resumeCommand(isUser)}.`
  )
}

/** Dòng context của prompt đến khi đang dừng: router không chạy, tool vẫn bị từ chối. */
export function quotaPausedContext(reasons: readonly QuotaReason[], isUser: boolean): string {
  return (
    `[focus-conductor] Đang tạm dừng: ${pauseCause(reasons, isUser)}. Router không chạy và mọi tool (trừ plan) bị từ chối. ` +
    `Trả lời được những gì không cần tool; nói với người dùng dùng ${resumeCommand(isUser)} để chạy tiếp ngay` +
    (isUser ? '.' : ', hoặc đợi hạn mức làm mới.')
  )
}

/** Khối ĐIỂM DỪNG chèn vào prompt tiếp tục: tối đa bấy nhiêu ký tự. */
export const RESUME_MAX = 2000

const RESUME_RULES =
  'Quy tắc tiếp tục: (1) kiểm trạng thái thật (git status, diff, file liên quan) trước khi chạy lại bất kỳ lệnh nào; ' +
  '(2) không chạy lại thao tác đã hoàn tất, nhất là lệnh ghi hay lệnh không idempotent; (3) bước doing được tiếp tục, không bắt đầu lại; ' +
  '(4) việc giao subagent pending hoặc failed được giao lại đúng như đã phân; (5) sau đó cập nhật checklist như bình thường.'

/**
 * Khối context đầu tiên của prompt tiếp tục: lúc và lý do dừng, mục tiêu, checklist, note của Claude, lệnh bị từ chối
 * (điểm tiếp tục chính xác), năm tool call cuối, file đổi sau lúc dừng và quy tắc tiếp tục. Tối đa RESUME_MAX ký tự:
 * phần dài bị cắt theo thứ tự tool call cuối, checklist, note; tiêu đề, lệnh bị từ chối, file đổi và quy tắc giữ.
 */
export function resumeContext(cp: QuotaCheckpoint, changed: readonly string[]): string {
  const reasons = cp.reason.length > 0 ? cp.reason.map(quotaReasonText).join('; ') : 'người dùng tạm dừng'
  const head = `[focus-conductor] ĐIỂM DỪNG (${resetLabel(new Date(cp.createdAt).toISOString()) || 'không rõ giờ'}): đã dừng vì ${reasons}.`
  const goal = [
    cp.brief.goal ? `Mục tiêu: ${cp.brief.goal}` : '',
    cp.brief.constraints.length > 0 ? `Ràng buộc: ${cp.brief.constraints.join('; ')}` : '',
    cp.brief.quality.length > 0 ? `Tiêu chí chất lượng: ${cp.brief.quality.join('; ')}` : '',
  ].filter(Boolean)
  const doing = cp.doing.length > 0 ? `Bước đang làm: ${cp.doing.join(', ')}.` : ''
  const checklist = cp.plan.map(step => `${mark(step.status)} ${step.id}. ${step.title}${step.note ? ` (${step.note})` : ''}`)
  const note = cp.note ? `Ghi chú của Claude lúc dừng: ${cp.note}` : 'Claude chưa kịp ghi note lúc dừng.'
  const denied = cp.denied ? `Lệnh bị từ chối lúc dừng (điểm tiếp tục chính xác): ${cp.denied.tool} ${cp.denied.input}` : ''
  const recent = cp.recent.length > 0 ? `Tool call cuối: ${cp.recent.join(' | ')}` : ''
  const files = changed.length > 0 ? `File đổi sau lúc dừng (người dùng hay tiến trình khác đã sửa), đọc lại trước khi sửa: ${changed.join(', ')}` : ''
  const build = (parts: { checklist: string[]; note: string; recent: string }) =>
    [head, ...goal, 'Checklist:', ...parts.checklist, doing, parts.note, denied, parts.recent, files, RESUME_RULES].filter(Boolean).join('\n')
  let parts = { checklist, note, recent }
  let text = build(parts)
  if (text.length > RESUME_MAX) parts = { ...parts, recent: '' }
  text = build(parts)
  while (text.length > RESUME_MAX && parts.checklist.length > 1) {
    parts = { ...parts, checklist: parts.checklist.slice(0, -1) }
    text = build(parts)
  }
  if (text.length > RESUME_MAX) {
    const over = text.length - RESUME_MAX
    parts = { ...parts, note: `${parts.note.slice(0, Math.max(0, parts.note.length - over - 1))}…` }
    text = build(parts)
  }
  return text.length > RESUME_MAX ? `${text.slice(0, RESUME_MAX - 1)}…` : text
}

/**
 * Dòng nhắc khi có điểm dừng mở mà prompt được xếp là việc khác: điểm dừng giữ nguyên để tiếp tục sau.
 */
export function resumePendingContext(cp: QuotaCheckpoint): string {
  const goal = cp.brief.goal ? `, mục tiêu: ${cp.brief.goal.length > 120 ? `${cp.brief.goal.slice(0, 119)}…` : cp.brief.goal}` : ''
  return (
    `[focus-conductor] Có điểm dừng chưa tiếp tục (tạo lúc ${resetLabel(new Date(cp.createdAt).toISOString()) || 'không rõ giờ'}${goal}). ` +
    'Prompt này được xếp là việc khác nên điểm dừng giữ nguyên; người dùng muốn làm tiếp thì nói "tiếp tục" hoặc dùng /conductor resume.'
  )
}

/** Phần trăm cho nhãn band và status line (dấu phẩy thập phân). */
export function quotaPercent(value: number): string {
  return percent(value)
}

/** Status line kèm nhãn hạn mức (đang dừng, hay phần còn lại khi gần ngưỡng); không có nhãn thì giữ nguyên. */
export function withQuotaStatus(base: string | undefined, badge: QuotaBadge | null, lang: Lang): string | undefined {
  if (base === undefined || badge === null) return base
  const l = labels(lang)
  return `${base} · ${badge.paused ? l.quotaPaused : l.quotaLeft(percent(badge.left ?? 0))}`
}

export type QuotaStatusInput = {
  enabled: boolean
  limits: readonly unknown[] | null
  thresholds: QuotaThresholds
  pause: { source: 'quota' | 'user'; reason?: readonly QuotaReason[] } | null
  overrideUntil: number
  overrideKinds: ReadonlyArray<QuotaReason['kind']>
  checkpoint: QuotaCheckpoint | null
  now: number
}

/** Trạng thái hạn mức: bình thường, đang dừng (hạn mức hay người dùng), đang ép tiếp, hay không có số đo. */
export type QuotaStateKind = 'ok' | 'quota' | 'user' | 'forced' | 'none'

/** Số liệu chung của /conductor status và mục Hạn mức trong pane (không định dạng, không theo ngôn ngữ). */
export type QuotaOverview = {
  windows: Array<{ kind: QuotaReason['kind']; used: number; resetsAt?: string; threshold: number }>
  state: QuotaStateKind
  /** Cửa sổ đang ép tiếp và mốc hết ép (state forced). */
  forcedKinds: ReadonlyArray<QuotaReason['kind']>
  forcedUntil: number
  /** Lý do dừng (state quota): lý do đã ghi lúc vào dừng, không có thì các cửa sổ đang qua ngưỡng. */
  reasons: readonly QuotaReason[]
  /** Điểm dừng chưa dùng xong (open hay resuming). */
  checkpoint: QuotaCheckpoint | null
}

export function quotaOverview(input: QuotaStatusInput): QuotaOverview {
  const windows: QuotaOverview['windows'] = []
  for (const raw of Array.isArray(input.limits) ? input.limits : []) {
    const item = raw as { kind?: unknown; percentUsed?: unknown; resetsAt?: unknown }
    if ((item.kind !== 'five_hour' && item.kind !== 'seven_day') || typeof item.percentUsed !== 'number' || !Number.isFinite(item.percentUsed)) continue
    const resetsAt = typeof item.resetsAt === 'string' ? item.resetsAt : undefined
    if (isStale(resetsAt, input.now)) continue
    const threshold = item.kind === 'five_hour' ? input.thresholds.session : input.thresholds.week
    windows.push({ kind: item.kind, used: item.percentUsed, ...(resetsAt !== undefined ? { resetsAt } : {}), threshold })
  }
  const evaluation = evaluateQuota(input.limits, input.now, input.thresholds)
  const isForced = input.overrideUntil > input.now && input.overrideKinds.length > 0
  const blocking = evaluation.hits.filter(h => !(isForced && input.overrideKinds.includes(h.kind)))
  const state: QuotaStateKind =
    input.pause?.source === 'user'
      ? 'user'
      : isForced && blocking.length === 0 && input.pause === null
        ? 'forced'
        : input.pause !== null || blocking.length > 0
          ? 'quota'
          : evaluation.zone === 'ok'
            ? 'ok'
            : 'none'
  const reasons = state !== 'quota' ? [] : input.pause?.reason?.length ? input.pause.reason : reasonsOf(blocking)
  const cp = input.checkpoint !== null && input.checkpoint.status !== 'consumed' ? input.checkpoint : null
  return { windows, state, forcedKinds: input.overrideKinds, forcedUntil: input.overrideUntil, reasons, checkpoint: cp }
}

/** Mục Hạn mức của /conductor status: từng cửa sổ (đã dùng, còn lại, làm mới, ngưỡng), trạng thái và điểm dừng. */
export function quotaStatusLines(input: QuotaStatusInput): string[] {
  if (!input.enabled) return ['Hạn mức: bảo vệ đang tắt (quotaGuard false).']
  const view = quotaOverview(input)
  const lines = ['Hạn mức:']
  for (const w of view.windows) {
    const reset = resetLabel(w.resetsAt)
    lines.push(
      `  ${w.kind === 'five_hour' ? 'phiên (5 giờ)' : 'tuần'}: đã dùng ${percent(w.used)}, còn ${percent(Math.max(0, 100 - w.used))}` +
        `${reset ? `, làm mới ${reset}` : ''}, ngưỡng còn ${percent(w.threshold)}`,
    )
  }
  const state = {
    user: 'tạm dừng (người dùng)',
    forced: `ép tiếp ${view.forcedKinds.map(k => QUOTA_NAME[k]).join(' và ')} tới ${resetLabel(new Date(view.forcedUntil).toISOString())}`,
    quota: 'tạm dừng (hạn mức)',
    ok: 'ok',
    none: 'không có dữ liệu (engine không báo hạn mức: tài khoản không dùng gói subscription, chưa có lượt đọc đầu, hoặc số đo đã cũ)',
  }[view.state]
  lines.push(`  trạng thái: ${state}`)
  const cp = view.checkpoint
  if (cp !== null) {
    lines.push(`  điểm dừng: ${cp.status === 'open' ? 'đang mở' : 'đang tiếp tục'} (tạo lúc ${resetLabel(new Date(cp.createdAt).toISOString()) || 'không rõ giờ'}${cp.note ? '' : ', Claude chưa ghi note'})`)
  }
  return lines
}

/** Ghi chú của Claude trong mục Hạn mức của pane: tối đa bấy nhiêu ký tự. */
export const PANE_NOTE_MAX = 160

/** Các dòng chữ của mục Hạn mức trong pane theo ngôn ngữ giao diện. `cause` là câu thay "Không có cảnh báo." khi đang dừng. */
export type QuotaPaneText = { windows: string[]; state: string; isPaused: boolean; cause: string; checkpoint: string[] }

export function quotaPaneText(view: QuotaOverview, lang: Lang): QuotaPaneText {
  const l = labels(lang)
  const windows = view.windows.map(w => `${l.quotaWindow[w.kind]}: ${l.quotaUsage(percent(w.used), percent(Math.max(0, 100 - w.used)), resetLabel(w.resetsAt), percent(w.threshold))}`)
  const reasonText = (r: QuotaReason) =>
    l.quotaReason(l.quotaName[r.kind], percent(Math.max(0, Math.round((100 - r.percentUsed) * 10) / 10)), percent(r.thresholdRemainingPct), resetLabel(r.resetsAt))
  const state = {
    ok: l.quotaStateOk,
    quota: l.quotaStateQuota,
    user: l.quotaStateUser,
    forced: l.quotaStateForced(view.forcedKinds.map(k => l.quotaName[k]).join(l.quotaAnd), resetLabel(new Date(view.forcedUntil).toISOString())),
    none: l.quotaStateNone,
  }[view.state]
  const isPaused = view.state === 'quota' || view.state === 'user'
  const cause = view.state === 'user' ? l.quotaUserCause : view.reasons.length > 0 ? view.reasons.map(reasonText).join('; ') : l.quotaNearlyOut
  const checkpoint: string[] = []
  const cp = view.checkpoint
  if (cp !== null) {
    const created = resetLabel(new Date(cp.createdAt).toISOString())
    checkpoint.push(`${l.quotaCheckpoint}: ${cp.status === 'open' ? l.quotaCheckpointOpen : l.quotaCheckpointResuming}${created ? `, ${l.quotaCreated(created)}` : ''}`)
    if (cp.reason.length > 0) checkpoint.push(`${l.quotaReasonLabel}: ${cp.reason.map(reasonText).join('; ')}`)
    const note = cp.note.length > PANE_NOTE_MAX ? `${cp.note.slice(0, PANE_NOTE_MAX - 1)}…` : cp.note
    checkpoint.push(note ? `${l.quotaNote}: ${note}` : l.quotaNoNote)
    checkpoint.push(`${l.quotaContinue}: ${isPaused ? resumeCommand(view.state === 'user') : l.quotaContinueSoft}`)
  } else if (isPaused) {
    checkpoint.push(`${l.quotaContinue}: ${resumeCommand(view.state === 'user')}`)
  }
  return { windows, state: `${l.quotaState}: ${state}`, isPaused, cause, checkpoint }
}
