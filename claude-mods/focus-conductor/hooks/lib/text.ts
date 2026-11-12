// Văn bản mod gửi cho model và hiển thị cho người dùng. Gom về một chỗ để
// giữ giọng văn nhất quán và dễ chỉnh.

import type { Brief, CheckHint, CheckpointBackup, Choice, PlanStep, QuotaCheckpoint, QuotaReason, Route, RouterFail, StepStatus, Task, TurnFault } from '../../types'
import { STUCK_HINT, openSteps, pendingSteps } from './drift'
import { BACKUP_CALLS_MAX, evaluateQuota, isStale, reasonsOf } from './quota'
import type { QuotaBadge, QuotaNoticeHit, QuotaThresholds } from './quota'
import { clockOf, labels } from '../ui/labels'
import { currentStep, taskBarRuns } from '../ui/style'
import type { Lang } from '../ui/labels'
import { describePick, stepCovers } from './route'
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
2. Với việc từ mức moderate trở lên: gọi ${PLAN_TOOL_FULL} (action "set") để ghi mục tiêu và checklist đã chuẩn hóa; cập nhật từng bước (doing, done, verified kèm bằng chứng, skipped, blocked hoặc waiting kèm lý do). Khi checklist có việc của mục "Phân việc", tiêu đề bước mở đầu "Việc N: " (N là số thứ tự của việc trong Phân việc); việc mang mã riêng của prompt (như "BƯỚC 7") thì tiêu đề bước mở đầu bằng chính mã đó.
3. Nhất quán: mọi bước phải phục vụ mục tiêu cuối; không làm thêm việc ngoài phạm vi, không bỏ sót yêu cầu; giữ văn phong, quy ước đặt tên và định dạng đã dùng từ đầu. Người dùng gửi thêm yêu cầu trong lúc đang làm: giữ mục tiêu và các bước đang có, thêm bước cho yêu cầu mới bằng action "add", hỏi lại nếu yêu cầu mới thay hẳn mục tiêu cũ.
4. Tự kiểm tra sau mỗi bước quan trọng theo cách người dùng quy định (lệnh kiểm có sẵn của dự án hay của prompt, đọc lại thay đổi) trước khi sang bước sau; không tạo test hay script kiểm mới nếu người dùng không yêu cầu. Lệnh kiểm mod nhận ra (trình chạy test, lệnh khai trong checkCommands) chạy đạt sau thay đổi cuối thì mod tự nâng bước đã xong thành verified, không cần chép lệnh; kiểm tĩnh (type-check, lint) không tính.
5. Khi giao việc cho subagent: nếu khối có mục "Phân việc", giao đúng các việc ghi "giao", description của Agent mở đầu "Việc N: " (N là số thứ tự của việc, không phải số bước của prompt; việc mang mã riêng như "BƯỚC 7" thì mở đầu bằng chính mã đó) để chạy đúng model và effort đã phân; việc ghi "làm trực tiếp" thì tự làm. Việc ngoài danh sách: để trống model và effort, router của plugin chấm khi giao; chọn Explore cho tra cứu chỉ đọc, Plan cho thiết kế, general-purpose cho thực thi. Prompt quy định model cho việc giao (kể cả "model của phiên") thì ghi rõ model đó ở lời gọi Agent (model của phiên ghi bằng tên họ model đang chạy); model ghi ở lời gọi là mức sàn, mod không chọn thấp hơn. Prompt giao subagent phải tự đứng được: nêu mục tiêu cuối, việc cụ thể, ràng buộc và phạm vi file liên quan, tiêu chí xong và dạng kết quả trả về. Nhận kết quả subagent thì đối chiếu với tiêu chí đó trước khi đóng bước.
6. Báo cáo gọn (chỉ áp cho luồng chính; subagent theo quy tắc riêng ở dòng cuối): giữa các tool call không tường thuật; khi chuyển sang việc khác chỉ viết một dòng "Đang làm việc N/M: ...", không chép lại checklist, không tóm tắt lại kết quả tool. Vẫn báo ngay khi bị chặn, khi cần người dùng quyết định, hoặc khi phát hiện rủi ro. Báo cáo cuối nêu kết quả, đã kiểm bằng lệnh nào, và chỗ còn hở. Hướng dẫn riêng của người dùng (CLAUDE.md, prompt) được ưu tiên hơn mục này.
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
  return `\nPhân việc (router đã chấm trước khi làm; khi giao, description của Agent mở đầu "Việc N: " với N là số thứ tự của việc; việc mang mã riêng như "BƯỚC 7" thì mở đầu bằng chính mã đó):\n${lines.join('\n')}`
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
  // Việc tách chạy bằng phiên con (0.7.9 F1): mỗi việc có split một khối ngay sau phân việc; không có split thì không thêm chữ nào.
  const splits = brief.isReference ? '' : splitLines(brief.tasks)
  const hasDelegation = brief.tasks.some(task => task.run === 'agent')
  const isSmall = brief.depth === 'none' || (brief.depth === 'light' && brief.volume === 'small')
  // Từ hai việc làm trực tiếp (0.8.0 A4): tên bước mang mã việc để pane gắn đúng bước cho từng việc.
  const naming = brief.tasks.filter(task => task.run === 'main').length >= 2 ? ' Đặt tên bước plan mở đầu bằng mã việc (Việc N, S0, V8).' : ''
  const next = brief.isReference
    ? 'Không thực thi prompt đính kèm. Chỉ trả lời phần đối chiếu phân việc ở trên, rồi dừng.'
    : isSmall
      ? 'Việc nhỏ: làm trực tiếp, không cần checklist; vẫn kiểm tra kết quả trước khi trả lời.'
      : `Trước khi thực thi: xác nhận mục tiêu, rồi gọi ${PLAN_TOOL_FULL} action "set" với checklist chuẩn hóa.${naming}`
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
    `Mục tiêu cuối: ${brief.goal}${tasks}${splits}${gaps}${rules}`,
    `Đánh giá: độ sâu ${brief.depth}, khối lượng ${brief.volume}, bản chất ${brief.kind}${brief.why ? ` (${brief.why})` : ''}`,
    routing,
    brief.scopePaths.length > 0 ? `Phạm vi được sửa: ${brief.scopePaths.join(', ')}` : '',
    next,
  ]
    .filter(Boolean)
    .join('\n')
}

/** Router không đọc được prompt: báo để Claude không dựa vào phân việc cũ. */
export function unroutedContext(reason: string, isBare = false, hasTasks = false): string {
  return (
    `[focus-conductor] Router không đọc được prompt này (${reason}). Không có phân việc mới; ` +
    // 0.7.5: router lỗi ở prompt tiếp nối không làm mất phân việc đã có của mục tiêu.
    (hasTasks ? 'mod không chọn model cho turn này; phân việc đã có của mục tiêu vẫn giữ (giao đúng các việc ghi "giao" còn lại). ' : 'mod không chọn model cho turn này. ') +
    (isBare ? 'Mod đã lập mục tiêu tối thiểu từ prompt để vẫn theo dõi tiến độ; người dùng có thể /conductor reroute để router đọc lại. ' : '') +
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

/**
 * Mục tiêu cũ đang dở chưa có checklist (0.8.5 K2) đã được lưu vì prompt này được xếp là mục tiêu mới: lấy lại bằng tin bảo chạy tiếp hay
 * plan action "restore". Một dòng, tối đa 300 ký tự.
 */
export function droppedGoalNotice(goal: string): string {
  return `[focus-conductor] Mục tiêu cũ chưa có checklist "${clipItem(goal, 100)}" đã được lưu vì prompt này được xếp là mục tiêu mới; lấy lại bằng tin bảo chạy tiếp hay ${PLAN_TOOL_FULL} action "restore".`
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
      ? `Việc mới (router đã chấm; khi giao, description của Agent mở đầu "Việc N: "):\n${added.map(task => taskLine(task, mainText)).join('\n')}${splitLines(added)}`
      : '',
    open.length > 0 ? `Bước còn mở: ${open.map(s => `${s.id}. ${s.title}`).join('; ')}` : '',
    uncoveredRequirements(brief).length > 0 ? `Yêu cầu chưa có việc nào phủ (đừng bỏ sót): ${uncoveredRequirements(brief).join('; ')}` : '',
    pendingLine(plan),
    newConstraints.length > 0 ? `Ràng buộc mới: ${newConstraints.join('; ')}` : '',
    'Giữ nhất quán với phần đã làm; nếu yêu cầu này đổi mục tiêu, cập nhật lại checklist.',
  ]
  return lines.filter(Boolean).join('\n')
}

/** Trần ký tự của khối context cho tin chen ngang (0.7.8 G9). */
export const INTERJECT_CHARS = 1500
const INTERJECT_OPEN_STEPS = 5

/**
 * Khối context cho tin người dùng gửi chen ngang khi luồng chính đang làm (0.7.8 G9): việc mới kèm cách làm, ràng buộc mới, bước đang
 * mở (tối đa 5), dặn thêm bước bằng plan add và giữ các bước đang có. `isRouted` false khi router không đọc được tin. Bớt việc liệt kê
 * cho vừa INTERJECT_CHARS.
 */
export function interjectContext(
  brief: Brief,
  plan: readonly PlanStep[],
  added: readonly Task[],
  newConstraints: readonly string[],
  options: { main: string; mayReplace: boolean; isRouted: boolean },
): string {
  const open = openSteps(plan).slice(0, INTERJECT_OPEN_STEPS)
  const all = added.map(t =>
    clipItem(`Việc ${t.index}: ${t.title} → ${t.run === 'main' ? `làm trực tiếp ở luồng chính (${options.main})` : `giao ${t.agentType ?? 'general-purpose'} ${describePick(t.pick)}`}`, 140),
  )
  const rules = newConstraints.length > 0 ? clipItem(`Ràng buộc mới: ${newConstraints.join('; ')}`, 300) : ''
  const steps = open.length > 0 ? clipItem(`Bước đang mở: ${open.map(st => `${st.id}. ${st.title}`).join('; ')}`, 300) : ''
  const ask =
    'Hoàn tất hoặc tạm dừng đúng chỗ phần đang làm; thêm bước cho yêu cầu mới bằng plan add (action "add") trước khi làm phần mới, giữ nguyên các bước đang có.' +
    (options.mayReplace ? ' Nếu yêu cầu mới thay hẳn mục tiêu cũ, hỏi lại người dùng trước khi đổi.' : '')
  const build = (n: number) =>
    [
      `[focus-conductor] Yêu cầu chen ngang khi đang làm: ${clipItem(brief.goal, 160)}`,
      options.isRouted ? '' : 'Router không đọc được tin này; tự đọc kỹ yêu cầu mới.',
      n > 0 ? `Việc mới (khi giao, description của Agent mở đầu "Việc N: "):\n${all.slice(0, n).join('\n')}${all.length > n ? `\nvà ${all.length - n} việc nữa` : ''}` : '',
      rules,
      steps,
      ask,
    ]
      .filter(Boolean)
      .join('\n')
  let n = all.length
  while (n > 0 && build(n).length > INTERJECT_CHARS) n -= 1
  // Việc mới chia được (0.7.9 F1): khối tách của từng việc đi sau, mỗi khối có trần riêng.
  return `${build(n).slice(0, INTERJECT_CHARS)}${splitLines(added)}`
}

/** Trần ký tự của khối dặn tách một việc (0.7.9 F1). */
export const SPLIT_CHARS = 600

/** Khối dặn tách của các việc có split, mỗi khối một dòng mở đầu bằng xuống dòng; không việc nào có split thì chuỗi rỗng. */
function splitLines(tasks: readonly Task[]): string {
  return tasks
    .filter(t => (t.split?.length ?? 0) >= 2)
    .map(t => `\n${splitBlock(t)}`)
    .join('')
}

/**
 * Khối dặn chạy song song một việc tách (0.7.9 F1), tối đa SPLIT_CHARS ký tự: số phần, cách gọi phiên con, mã phần ở đầu description,
 * từng phần kèm file được sửa, rồi dặn đợi đủ kết quả, gộp và đối chiếu tiêu chí. Tên phần cắt đều cho vừa trần.
 */
export function splitBlock(task: Task): string {
  const parts = task.split ?? []
  const n = task.index
  const head =
    `Việc ${n} khối lượng lớn, tách ${parts.length} phần chạy song song bằng phiên con (Agent subagent_type "fork"), ` +
    `mỗi phần một lời gọi trong cùng một lượt trả lời, description mở đầu bằng mã phần như "Việc ${n}a: ": `
  const tail = `. Đợi đủ kết quả rồi gộp, đối chiếu tiêu chí của Việc ${n}, rồi mới sang bước sau. Các việc khác giữ nguyên phân việc.`
  const room = SPLIT_CHARS - head.length - tail.length - 2 * Math.max(0, parts.length - 1)
  const each = Math.max(12, Math.floor(room / Math.max(1, parts.length)))
  const items = parts.map(p => clipItem(`${n}${p.part} ${p.title} (${p.files.length > 0 ? p.files.join(', ') : 'chỉ đọc'})`, each))
  return `${head}${items.join('; ')}${tail}`.slice(0, SPLIT_CHARS)
}

/** Câu gom (0.7.9 F1), tối đa 200 ký tự: mọi phần của việc đã có kết quả từ phiên con. */
export function forkMergedNote(index: number): string {
  return `[focus-conductor] Việc ${index} đã đủ kết quả từ các phiên con: gộp kết quả và đối chiếu tiêu chí của Việc ${index} rồi mới sang bước sau.`.slice(0, 200)
}

/** Câu chuyển về luồng chính khi engine từ chối phiên con (0.7.9 F1), tối đa 200 ký tự; `index` null khi lời gọi không khớp việc tách nào. */
export function forkReturnNote(index: number | null, parts: readonly string[]): string {
  const what = index !== null && parts.length > 0 ? `làm Việc ${index} phần ${parts.join(', ')} ở luồng chính` : 'làm phần việc đó ở luồng chính'
  return `[focus-conductor] Engine không mở được phiên con: ${what}, không tách thêm việc nào trong phiên này.`.slice(0, 200)
}

/** Câu dặn khi giao phiên con "Sửa lỗi kiểm: " ở lượt 2 hay 3 của W4 (0.7.9 F1), tối đa 200 ký tự. */
export function forkRetryNote(): string {
  return `[focus-conductor] Phiên con chạy model của luồng chính nên không là lượt sửa ở mức đã nâng: giao subagent general-purpose, description mở đầu "${RETRY_PREFIX}".`.slice(0, 200)
}

/** Lý do từ chối mở phiên con khi turn đã nhận báo hạn mức mềm (0.7.9 F1). */
export const FORK_QUOTA_DENY = '[focus-conductor] Turn này đã nhận báo hạn mức mềm: không mở phiên con mới; làm phần còn lại ở luồng chính.'

/** Câu báo việc của tin chen ngang đã chuyển sang subagent vì tin được chèn vào turn đang chạy (0.7.8 G9). */
export function interjectMovedNote(moved: readonly Task[]): string {
  return clipItem(
    '[focus-conductor] Yêu cầu chen ngang đã vào turn đang chạy, luồng chính giữ model hiện tại. Giao subagent general-purpose để chạy đúng model, description mở đầu "Việc N: ": ' +
      moved.map(t => `Việc ${t.index}: ${clipItem(t.title, 60)} (${t.pick.family}/${t.pick.effort})`).join('; ') +
      '.',
    600,
  )
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

/**
 * Tin hỏi tiến độ (0.8.2 N1, intent status): trả lời từ checklist, không làm thêm việc, không đổi checklist; tin đến giữa turn thì trả lời
 * một dòng rồi làm tiếp bước đang làm. Tối đa 300 ký tự.
 */
export function intentStatusContext(isInterject: boolean): string {
  return isInterject
    ? '[focus-conductor] Tin hỏi tiến độ giữa turn: trả lời một dòng từ checklist, rồi làm tiếp bước đang làm. Không thêm việc, không đổi checklist.'
    : '[focus-conductor] Tin hỏi tiến độ: trả lời từ checklist hiện có (bước đã xong, đang làm, còn lại). Không làm thêm việc, không đổi checklist.'
}

/**
 * Tin ngoài lề (0.8.4 A1): trả lời mà không đổi mục tiêu đang dở. Giữa turn: trả lời ngắn rồi làm tiếp bước đang làm; ngoài turn: chỉ trả
 * lời, chưa làm tiếp cho tới khi người dùng bảo chạy tiếp. Không thêm việc, không đổi checklist. Một dòng, tối đa 300 ký tự.
 */
export function asideContext(isInterject: boolean, next: PlanStep | undefined): string {
  const at = next !== undefined ? `bước ${next.id}. ${clipItem(next.title, 80)}` : isInterject ? 'phần đang làm' : 'mục tiêu đang làm'
  return isInterject
    ? `[focus-conductor] Câu hỏi ngoài lề giữa turn: trả lời ngắn câu hỏi này rồi làm tiếp ${at}. Không thêm việc, không đổi checklist.`
    : `[focus-conductor] Câu hỏi ngoài lề: trả lời câu hỏi này; mục tiêu đang làm giữ nguyên, chưa làm tiếp ${at} cho tới khi người dùng bảo chạy tiếp. Không thêm việc, không đổi checklist.`
}

/**
 * Tin bảo chạy tiếp quay lại mục tiêu đã cất (0.8.4 A2): việc chen vào đã xong, mod khôi phục mục tiêu bị nó thay; chạy tiếp từ bước mở
 * kế tiếp của mục tiêu đó. Một dòng, tối đa 300 ký tự.
 */
export function restoreResumeContext(goal: string, next: PlanStep | undefined): string {
  return `[focus-conductor] Tin bảo chạy tiếp: đã quay lại mục tiêu đã cất "${clipItem(goal, 120)}"; chạy tiếp từ ${next !== undefined ? `bước ${next.id}. ${clipItem(next.title, 80)}` : 'bước đang mở'}; không thêm việc mới.`
}

/** Tin bảo chạy tiếp quay lại mục tiêu đã cất chưa có checklist (0.8.5 K2): làm tiếp mục tiêu đó từ đầu. Một dòng, tối đa 300 ký tự. */
export function restoreGoalOnlyContext(goal: string): string {
  return `[focus-conductor] Tin bảo chạy tiếp: đã quay lại mục tiêu đã cất "${clipItem(goal, 120)}"; mục tiêu này chưa có checklist, làm tiếp mục tiêu đó; không thêm việc mới.`
}

/**
 * Tin bảo chạy tiếp mà không còn gì để chạy (0.8.5 K5): checklist hiện tại đã đóng hết và không còn việc nào đã cất đang dở. Một dòng, tối
 * đa 300 ký tự.
 */
export function nothingLeftContext(): string {
  return '[focus-conductor] Tin bảo chạy tiếp: checklist hiện tại đã đóng hết và không còn việc nào đã cất đang dở; tóm tắt kết quả đã làm rồi hỏi người dùng muốn làm gì tiếp, không tự thêm việc mới.'
}

/** Tin bảo chạy tiếp (0.8.2 N1, intent resume; approve khi không có kế hoạch chờ duyệt): chạy tiếp từ bước đang mở. Tối đa 300 ký tự. */
export function intentResumeContext(plan: readonly PlanStep[]): string {
  const next = openSteps(plan)[0]
  return `[focus-conductor] Tin bảo chạy tiếp: chạy tiếp từ ${next !== undefined ? `bước ${next.id}. ${clipItem(next.title, 80)}` : 'bước đang mở'}; không thêm việc mới.`
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
    'Kiểm theo cách người dùng quy định (lệnh kiểm có sẵn của dự án hay của prompt, đọc lại kết quả) sau thay đổi cuối cùng; ' +
    'không tạo test hay script kiểm mới nếu người dùng không yêu cầu. Lệnh kiểm mod nhận ra (trình chạy test, lệnh kiểm riêng ' +
    'người dùng đã khai cho mod; kiểm tĩnh như type-check, lint, build không tính) chạy đạt thì mod tự nâng bước done thành verified, ' +
    'không cần chép lệnh vào evidence. Việc chỉ đọc, chưa sửa gì thì nêu lệnh hay file đã đọc.'
  if (examples === undefined) return base
  // Không có lệnh script thật đã chạy thì không nêu ví dụ (0.7.5): tên lệnh bịa dễ bị chép thành script mới.
  const sample = examples[0] !== undefined ? `, ví dụ \`${examples[0]}\`` : ''
  return (
    `${base} Nếu bước này được kiểm bằng script riêng của dự án, người dùng khai option checkCommands của mod ` +
    `(lệnh phân tách bằng dấu phẩy, khớp theo tiền tố token${sample}); model không tự khai được. ` +
    'Khi chưa khai, bước vẫn là done: nêu với người dùng lệnh đã chạy và kết quả.'
  )
}

/** Bằng chứng mạnh nhưng chỉ có kiểm tĩnh (type-check, lint, build): ghi chú để Claude cân nhắc chạy test. */
export function staticOnlyNotice(): string {
  return '[focus-conductor] Ghi chú: bằng chứng chỉ là kiểm tĩnh (type-check, lint, build, validate), chưa kiểm hành vi. Nếu bước thay đổi hành vi, kiểm theo cách người dùng quy định (lệnh kiểm có sẵn, đọc lại kết quả); không tạo test mới nếu người dùng không yêu cầu.'
}

/** Bước có tiêu chí nghiệm thu: nhắc lại để Claude đối chiếu với bằng chứng vừa ghi. */
export function criteriaNotice(step: { id: number; check?: string }): string {
  return `[focus-conductor] Tiêu chí nghiệm thu của bước ${step.id}: ${step.check ?? ''}. Đối chiếu bằng chứng với tiêu chí này; chưa đạt thì mở lại bước (doing).`
}

/** Bước mở cuối cùng vừa đóng: yêu cầu xác nhận từng tiêu chí chất lượng của mục tiêu trước khi kết thúc. */
/** Trần ký tự của lời nhắc đối chiếu từng yêu cầu (0.7.8 G2). */
export const REQUIREMENTS_NOTICE_CHARS = 2500
const REQUIREMENTS_NOTICE_ITEMS = 30

/**
 * Lời nhắc đối chiếu từng yêu cầu router đã trích khi checklist đóng hẳn (0.7.8 G2): đánh số, mỗi mục cắt 100 ký tự, tối đa 30 mục;
 * quá trần thì dừng ở mục cuối vừa đủ và thêm "và M yêu cầu nữa trong prompt gốc".
 */
export function requirementsNotice(requirements: readonly string[]): string {
  const all = requirements.slice(0, REQUIREMENTS_NOTICE_ITEMS).map((r, i) => `(${i + 1}) ${clipItem(r, 100)}`)
  const head = '[focus-conductor] Đối chiếu từng yêu cầu của prompt trước khi kết thúc, mỗi yêu cầu một bằng chứng cụ thể (lệnh đã chạy, kết quả, file):'
  const tail = 'Yêu cầu nào chưa đạt thì thêm bước bằng action "add".'
  const build = (n: number) => {
    const rest = requirements.length - n
    return `${head} ${all.slice(0, n).join('; ')}${rest > 0 ? `; và ${rest} yêu cầu nữa trong prompt gốc` : ''}. ${tail}`
  }
  let n = all.length
  while (n > 1 && build(n).length > REQUIREMENTS_NOTICE_CHARS) n -= 1
  return build(n)
}

/** Trần của lời nhắc ghép file đã đổi (0.8.2 N5): số file liệt kê và tổng ký tự. */
export const CHANGED_NOTICE_FILES = 20
export const CHANGED_NOTICE_CHARS = 1200

/**
 * Lời nhắc ghép file đã đổi với bước hay yêu cầu khi đóng bước mở cuối (0.8.2 N5): tối đa 20 file, mỗi đường dẫn cắt 100 ký tự; phần tràn
 * ghi "và M file nữa", lệnh ghi không rõ đích ghi "và N lệnh ghi không rõ đích"; tổng tối đa 1.200 ký tự.
 */
export function changedFilesNotice(changed: { paths: readonly string[]; unknown: number; overflow: number }): string {
  const all = changed.paths.slice(0, CHANGED_NOTICE_FILES).map(path => clipItem(path, 100))
  const head = '[focus-conductor] File đã đổi trong mục tiêu này:'
  const tail =
    'Ghép mỗi file với bước hay yêu cầu nó phục vụ; file không ghép được thì ghi vào mục "Ngoài yêu cầu" của báo cáo cuối kèm lý do, hoặc hoàn tác nếu không cần.'
  const build = (n: number) => {
    const rest = changed.paths.length + changed.overflow - n
    const parts = [...all.slice(0, n), ...(rest > 0 ? [`và ${rest} file nữa`] : []), ...(changed.unknown > 0 ? [`và ${changed.unknown} lệnh ghi không rõ đích`] : [])]
    return `${head} ${parts.join('; ')}. ${tail}`
  }
  let n = all.length
  while (n > 0 && build(n).length > CHANGED_NOTICE_CHARS) n -= 1
  return build(n)
}

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
    `Mục tiêu: ${goal}. Nếu thay đổi này thật sự cần cho mục tiêu, ghi rõ lý do; nếu không, quay về bước còn mở. ${STUCK_HINT}`
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

/**
 * Kết quả của tool plan, action set (0.7.3). Checklist lưu đúng như Claude gửi (có steps, không bước nào bị bỏ hay cắt) thì
 * chỉ một dòng: số bước đã lưu, mục tiêu nếu vừa đổi, bước tiếp theo kèm số. Khác đi thì in đầy đủ như trước kèm một dòng nói
 * đã chỉnh gì. Phạm vi lưu khác phạm vi gửi thì dòng kết quả nêu phạm vi đã lưu (cả hai dạng). Chỉ đổi goal hay scope, hoặc xóa
 * checklist (steps rỗng), thì in đầy đủ như cũ.
 */
export function setResultText(
  brief: Brief | null,
  plan: readonly PlanStep[],
  report: { hasSteps: boolean; adjusted: readonly string[]; scopeSaved?: readonly string[] },
  goal: string | undefined,
  previousGoal: string | null,
): string {
  const scope = report.scopeSaved !== undefined ? `Phạm vi đã lưu: ${report.scopeSaved.length > 0 ? report.scopeSaved.join(', ') : 'không có'}.` : ''
  if (report.hasSteps && plan.length > 0 && report.adjusted.length === 0) {
    const isGoalChanged = goal !== undefined && goal !== previousGoal
    return [`Đã lưu ${plan.length} bước.`, isGoalChanged ? `Mục tiêu: ${goal}.` : '', nextLine(plan).trim(), scope].filter(Boolean).join(' ')
  }
  const adjusted = report.adjusted.length > 0 ? `\nĐã chỉnh: ${report.adjusted.join('; ')}.` : ''
  return `${renderPlan(brief, plan)}${adjusted}${scope ? `\n${scope}` : ''}`
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
        // 0.7.5: hướng dẫn waiting đứng trước, để việc đang chờ (kể cả dừng theo quy tắc hạn mức của prompt) không bị đẩy làm tiếp.
        'Đang chờ lệnh nền, tiến trình, người dùng hay đang dừng theo quy tắc dừng theo hạn mức của prompt thì ghi waiting; blocked dành cho vướng mắc không tự gỡ được. ' +
        `Còn lại thì hoàn thành các bước đó, hoặc cập nhật trạng thái bằng ${PLAN_TOOL_FULL} ` +
        '(skipped, blocked hoặc waiting kèm lý do) trước khi kết thúc. ' +
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

/** Trần ký tự của lý do chặn khi mục tiêu chưa có checklist (0.7.8 G1). */
export const NO_CHECKLIST_CHARS = 1200
const NO_CHECKLIST_TASKS = 8
const NO_CHECKLIST_REQUIREMENTS = 10

/**
 * Mục tiêu cần checklist của tool plan trước khi kết thúc (0.7.8 G1): brief không phải isReference và có việc đã phân, hoặc tier từ
 * moderate; brief isBare (router lỗi ở prompt đầu, tier chỉ là đoán) chỉ tính việc đã phân.
 */
export function needsChecklist(brief: Brief): boolean {
  if (brief.isReference) return false
  if (brief.tasks.length > 0) return true
  return brief.isBare !== true && (brief.tier === 'moderate' || brief.tier === 'complex' || brief.tier === 'deep')
}

/**
 * Lý do cổng Stop chặn khi mục tiêu chưa có checklist của tool plan (0.7.8 G1): liệt kê việc đã phân (tối đa 8, tiêu đề cắt 60 ký
 * tự), không có việc thì yêu cầu router trích (tối đa 10, cắt 80 ký tự); không quá NO_CHECKLIST_CHARS ký tự.
 */
export function noChecklistReason(brief: Brief, hasMirror: boolean): string {
  const head = `[focus-conductor] Mục tiêu "${clipItem(brief.goal, 120)}" chưa có checklist của ${PLAN_TOOL_FULL}.`
  const tail =
    `Gọi ${PLAN_TOOL_FULL} action "set" để ghi checklist rồi làm tiếp, hoặc nêu rõ vì sao mọi yêu cầu đã xong trước khi kết thúc.` +
    (hasMirror ? ' Danh sách việc ghi bằng TodoWrite hay TaskCreate chỉ để hiển thị, cổng kết thúc không đọc danh sách đó.' : '')
  const hasTasks = brief.tasks.length > 0
  const all = hasTasks
    ? brief.tasks.map(t => `Việc ${t.index}: ${clipItem(t.title, 60)}`)
    : (brief.requirements ?? []).map((r, i) => `(${i + 1}) ${clipItem(r, 80)}`)
  const limit = hasTasks ? NO_CHECKLIST_TASKS : NO_CHECKLIST_REQUIREMENTS
  const label = hasTasks ? 'Các việc đã phân' : 'Các yêu cầu router đã trích'
  const unit = hasTasks ? 'việc' : 'yêu cầu'
  const build = (n: number) => {
    if (n === 0) return `${head} ${tail}`
    const rest = all.length - n
    return `${head} ${label}: ${all.slice(0, n).join('; ')}${rest > 0 ? `; và ${rest} ${unit} nữa` : ''}. ${tail}`
  }
  let n = Math.min(all.length, limit)
  while (n > 0 && build(n).length > NO_CHECKLIST_CHARS) n -= 1
  return build(n).slice(0, NO_CHECKLIST_CHARS)
}

/** Trần ký tự của dòng báo việc chưa có bước (0.7.8 G4). */
export const MISSING_TASKS_CHARS = 500
const MISSING_TASKS_SHOWN = 8

/**
 * Việc đã phân chưa có bước nào trong checklist (0.7.8 G4): một bước (mọi trạng thái) phủ việc theo stepCovers, tức cùng luật khớp với
 * description của Agent ("Việc N", mã mục, mã bước) rồi khớp theo tên (vòng sửa 3, W1). Mỗi bước phủ tối đa một việc.
 */
export function missingTasks(tasks: readonly Task[], plan: readonly PlanStep[]): Task[] {
  const covered = new Set(plan.map(step => stepCovers(tasks, step.title)?.index))
  return tasks.filter(t => !covered.has(t.index))
}

/** Dòng báo việc chưa có bước (0.7.8 G4): tối đa 8 việc, tiêu đề cắt 60 ký tự, không quá MISSING_TASKS_CHARS ký tự. */
export function missingTasksNotice(missing: readonly Task[]): string {
  const all = missing.map(t => `Việc ${t.index}: ${clipItem(t.title, 60)}`)
  const tail =
    'Thêm bước cho từng việc đó bằng action "add", tiêu đề mở đầu "Việc N: ", hoặc ghi lý do bỏ (bước skipped kèm note). ' +
    'Việc đã có bước dưới tên khác thì không thêm bước trùng; lần set sau đặt tiêu đề mở đầu "Việc N: ".'
  const build = (n: number) => {
    const rest = all.length - n
    return `[focus-conductor] Việc chưa có bước trong checklist: ${all.slice(0, n).join('; ')}${rest > 0 ? `; và ${rest} việc nữa` : ''}. ${tail}`
  }
  let n = Math.min(all.length, MISSING_TASKS_SHOWN)
  while (n > 1 && build(n).length > MISSING_TASKS_CHARS) n -= 1
  return build(n)
}

/** Một dòng tóm tắt cho status line. */
/** Số ô của thanh chữ trên status line (0.6.1). */
export const STATUS_BAR = 8

/** Độ dài tối đa của tên bước khi bước không có mã (0.7.6, U5). */
const STEP_TAG = 24
/** Mã đầu tiêu đề bước ("BƯỚC 4", "Step 2", "Việc 3", "K4.1"), giữ đúng chữ của tiêu đề. */
const STEP_TAG_CODE = /^[\s#*>-]*((?:bước|step|việc|task)\s*#?\s*\d+|[a-z]{1,3}\d+(?:\.\d+)*)(?![\p{L}\p{N}])/iu

/** Tên ngắn của mục tiêu (0.7.6, W4): 24 ký tự đầu, giữ nguyên mã ở đầu nếu có. */
export function goalTag(goal: string): string {
  const text = goal.normalize('NFC').trim()
  return [...text].length > STEP_TAG ? `${[...text].slice(0, STEP_TAG).join('').trimEnd()}…` : text
}

/** Nhãn ngắn của một bước (0.7.6, U5): mã đầu tiêu đề nếu có, không thì tên bước cắt ở 24 ký tự. */
export function stepTag(title: string): string {
  const text = title.normalize('NFC').trim()
  const code = STEP_TAG_CODE.exec(text)?.[1]
  if (code !== undefined) return code
  return [...text].length > STEP_TAG ? `${[...text].slice(0, STEP_TAG).join('').trimEnd()}…` : text
}

/**
 * Status line (0.7.6, U5): thanh chữ (cùng ký hiệu với band, không màu, cho surface không có band), số bước, nhãn ngắn của bước hiện tại
 * và họ model; không có tier. Chưa có checklist thì chỉ họ model, không có model thì tên chế độ. Chế độ khác auto ghi cuối.
 */
export function statusLine(brief: Brief | null, plan: readonly PlanStep[], route: Route | null, mode: string): string {
  if (brief === null) return mode
  const { total } = progress(plan)
  const bar = taskBarRuns({ kind: 'steps', plan: [...plan] }, STATUS_BAR).map(run => run.text).join('')
  const current = currentStep(plan)
  const parts = [
    ...(total > 0 ? [`${bar ? `${bar} ` : ''}${countLabel(plan)}`] : []),
    ...(total > 0 && current !== undefined ? [stepTag(current.title)] : []),
    ...(route ? [route.family] : []),
  ]
  // W4: chưa có checklist và chưa có model thì ghi tên ngắn của mục tiêu (kèm mã đầu mục tiêu nếu có), không chỉ tên chế độ.
  if (parts.length === 0) parts.push(goalTag(brief.goal))
  return `${parts.join(' · ')}${mode === 'auto' ? '' : ` · ${mode}`}`
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

/**
 * Báo hạn mức mềm cho luồng chính (0.7.4): phần còn lại, giờ làm mới nếu có, và nhắc áp quy tắc dừng của prompt (nếu có).
 * Mod không chặn tool ở vùng này; nhiều cửa sổ cùng vào vùng báo thì mỗi cửa sổ một câu.
 */
export function quotaNoticeText(hits: readonly QuotaNoticeHit[]): string {
  return hits
    .map(hit => {
      const reset = resetLabel(hit.resetsAt)
      const name = QUOTA_NAME[hit.kind].replace(/^h/, 'H')
      return (
        `[focus-conductor] ${name} còn ${percent(hit.remaining)}${reset ? ` (làm mới lúc ${reset})` : ''}. ` +
        'Nếu prompt có quy tắc dừng theo hạn mức thì áp dụng ngay: làm xong phần đang làm, ghi điểm dừng theo cách prompt quy định, rồi dừng.'
      )
    })
    .join('\n')
}

/** Nhãn status line khi ở vùng báo mềm (0.7.4): cửa sổ và phần còn lại. */
export function withQuotaNoticeStatus(base: string | undefined, hits: readonly QuotaNoticeHit[], lang: Lang): string | undefined {
  const hit = hits[0]
  if (base === undefined || hit === undefined) return base
  const l = labels(lang)
  return `${base} · ${l.quotaNotice(l.quotaWindowShort[hit.kind], percent(hit.remaining))}`
}

/** Lý do từ chối tool khi đang dừng: luồng chính ghi điểm dừng rồi kết thúc; subagent kết thúc ngay. */
export function quotaDenyText(reasons: readonly QuotaReason[], isUser: boolean, isAgent: boolean, allowPaths: readonly string[] = [], backup = false): string {
  const cause = `[focus-conductor] Tạm dừng: ${pauseCause(reasons, isUser)}.`
  if (isAgent) return `${cause} Subagent không gọi tool nào khác; kết thúc ngay và báo ngắn phần đã làm, phần còn dở.`
  // pauseAllowPaths (0.7.5): luồng chính vẫn ghi được file checkpoint theo quy tắc dừng của prompt. Vòng sửa 2: nêu đường dẫn được
  // ghi trước, rồi mới "Không gọi tool nào khác" (kèm ngoại lệ), để câu cấm không đứng trước ngoại lệ của chính nó.
  const allowed =
    allowPaths.length > 0
      ? ` Được ghi vào các đường dẫn của pauseAllowPaths: ${allowPaths.join(', ')} (bằng Write, Edit, MultiEdit, NotebookEdit hay Bash có mọi đường dẫn đích nằm trong danh sách đó; đọc các đường dẫn đó bằng Read vì Claude Code cần Read trước Edit), ví dụ file checkpoint theo quy tắc dừng của prompt.`
      : ''
  const ban = allowPaths.length > 0 ? 'Không gọi tool nào khác ngoài việc ghi và Read các đường dẫn đó và tool plan.' : 'Không gọi tool nào khác.'
  // 0.8.2 N4: pauseBackup bật (dừng vì hạn mức, luồng chính): commit và push phần đang làm lên nhánh -wip trước khi dừng hẳn.
  const saved = backup
    ? ` Ngoại lệ (pauseBackup): trước khi dừng hẳn, commit phần đang làm và push lên <nhánh hiện tại>-wip, tối đa ${BACKUP_CALLS_MAX} lời gọi Bash, ` +
      'mỗi lời gọi đúng một lệnh: git add -u (hay git add <đường dẫn trong thư mục gốc phiên>), git commit -m "<thông điệp>", ' +
      'rồi git push origin HEAD:<nhánh hiện tại>-wip (không thêm cờ nào). Không phải git repo, không có remote, hay nhánh hiện tại là main hoặc master thì bỏ qua.'
    : ''
  return (
    `${cause}${allowed} ${ban}${saved} Gọi ${PLAN_TOOL_FULL} với action "checkpoint" và note nêu: bước kế tiếp cụ thể, ` +
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
export function resumePendingContext(cp: QuotaCheckpoint, isAfterClear = false): string {
  const goal = cp.brief.goal ? `, mục tiêu: ${cp.brief.goal.length > 120 ? `${cp.brief.goal.slice(0, 119)}…` : cp.brief.goal}` : ''
  return (
    `[focus-conductor] Có điểm dừng chưa tiếp tục (tạo lúc ${resetLabel(new Date(cp.createdAt).toISOString()) || 'không rõ giờ'}${goal}). ` +
    (isAfterClear
      ? 'Hội thoại vừa được xóa (/clear) nên điểm dừng không tự chèn; người dùng muốn làm tiếp thì dùng /conductor resume.'
      : 'Prompt này được xếp là việc khác nên điểm dừng giữ nguyên; người dùng muốn làm tiếp thì nói "tiếp tục" hoặc dùng /conductor resume.')
  )
}

/** Phần trăm cho nhãn band và status line (dấu phẩy thập phân). */
export function quotaPercent(value: number): string {
  return percent(value)
}

/** Status line kèm nhãn hạn mức (đang dừng, hay phần còn lại khi gần ngưỡng); không có nhãn thì giữ nguyên. */
/** Nhãn lỗi router cho status line (0.7.2): nói vì sao mod không đọc được prompt và cách đọc lại. */
export function routerFailLabel(fail: RouterFail, lang: Lang): string {
  const isVi = lang !== 'en'
  const seconds = fail.timeoutMs !== null && fail.timeoutMs > 0 ? ` ${Math.round(fail.timeoutMs / 1000)}s` : ''
  const why =
    fail.kind === 'paused'
      ? isVi ? 'router tạm ngừng' : 'router paused'
      : fail.kind === 'timeout'
        ? isVi ? `router lỗi: hết giờ${seconds}` : `router failed: timed out${seconds}`
        : fail.kind === 'api'
          ? isVi ? 'router lỗi: lỗi API' : 'router failed: API error'
          : fail.kind === 'format'
            ? isVi ? 'router lỗi: sai định dạng' : 'router failed: bad format'
            : isVi ? 'router lỗi' : 'router failed'
  return `${why} · /conductor reroute`
}

/** Status line kèm nhãn lỗi router khi có (0.7.2); undefined (mod tắt) giữ nguyên. */
export function withRouterFailStatus(base: string | undefined, fail: RouterFail | null, lang: Lang): string | undefined {
  return base === undefined || fail === null ? base : `${base} · ${routerFailLabel(fail, lang)}`
}

/** Nhãn turn lỗi cho status line (0.7.3): turn kết thúc vì lỗi API; không nói nguyên nhân (reason "error" gồm mọi lỗi API). */
export function turnFaultLabel(lang: Lang): string {
  return lang === 'en' ? 'turn failed · type to retry' : 'turn lỗi · gõ tiếp để chạy lại'
}

/** Status line kèm nhãn turn lỗi khi có (0.7.3); undefined (mod tắt) giữ nguyên. */
export function withTurnFaultStatus(base: string | undefined, fault: TurnFault | null, lang: Lang): string | undefined {
  return base === undefined || fault === null ? base : `${base} · ${turnFaultLabel(lang)}`
}

/**
 * Prompt tiếp tục mod tự gửi khi netResume bật và có mạng lại (0.7.3): ngắn, chỉ nêu mục tiêu và các bước còn mở lúc turn lỗi,
 * không chứa dữ liệu nào khác của phiên.
 */
export function netResumeText(fault: TurnFault): string {
  const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}...` : text)
  const goal = fault.goal !== null ? ` Mục tiêu: ${clip(fault.goal, 200)}.` : ''
  const steps = fault.openSteps.length > 0 ? ` Bước còn mở: ${fault.openSteps.map(step => clip(step, 80)).join('; ')}.` : ''
  return `Turn trước kết thúc vì lỗi (đã có mạng lại). Tiếp tục công việc đang làm dở từ chỗ dừng.${goal}${steps} Kiểm tra lại phần vừa làm trước khi sửa tiếp.`
}

/** Dòng "Router lỗi gần nhất" của /conductor status (0.7.2); rỗng khi router đã đọc được lại. */
export function routerFailLines(fail: RouterFail | null): string[] {
  if (fail === null) return []
  const limits = [
    fail.ms > 0 ? `đã chờ ${(fail.ms / 1000).toFixed(1)} giây` : '',
    fail.timeoutMs !== null ? `giới hạn ${Math.round(fail.timeoutMs / 1000)} giây` : '',
    fail.maxTokens !== null ? `tối đa ${fail.maxTokens} token` : '',
    fail.outputTokens !== null ? `đã nhận ${fail.outputTokens} token` : '',
  ].filter(Boolean)
  return [`Router lỗi gần nhất: ${fail.reason}${limits.length > 0 ? ` (${limits.join(', ')})` : ''}. Dùng /conductor reroute để router đọc lại prompt.`]
}

/**
 * Gợi ý khai option checkCommands cho người dùng (0.7.3): toast, dòng của pane và của /conductor status dùng chung một câu.
 * Chuỗi gợi ý ở dạng sẽ khớp. Mod chỉ gợi ý, không tự khai, và không gợi ý tiền tố thư mục.
 */
export function checkHintText(commands: readonly string[]): string {
  return `Mod chưa nhận script kiểm đã chạy là lệnh kiểm. Gợi ý khai option checkCommands của mod: ${commands.join(', ')}. Nên chạy lệnh kiểm không qua ống (| tail, | head) hoặc có set -o pipefail, để mã thoát là của chính lệnh kiểm.`
}

/** Mục của prompt tiếp nối không giữ được vì ràng buộc và yêu cầu đã đầy, kể cả phần tràn (0.7.5, vòng rà soát 3). */
/** Câu báo đợt mới (0.8.0 A3), tối đa 160 ký tự, chèn một lần mỗi đợt. */
export function phaseNotice(phase: number, added: number, archived: number): string {
  const kept = archived > 0 ? `; ${archived} việc đã xong của đợt trước đã cất` : ''
  return `[focus-conductor] Đợt ${phase} của mục tiêu: ${added} việc mới${kept}. Checklist giữ các bước còn mở.`.slice(0, 160)
}

export function droppedItemsText(count: number): string {
  return `${count} mục của prompt tiếp nối không giữ được vì ràng buộc và yêu cầu của mục tiêu đã đầy (kể cả phần tràn); nhắc lại các mục đó khi cần, hoặc lập mục tiêu mới`
}

/** Dòng gợi ý của /conductor status (0.7.3): chỉ khi gợi ý thuộc đúng mục tiêu đang mở; rỗng thì không có dòng. */
export function checkHintLines(hint: CheckHint | null, goalId: number | null): string[] {
  return hint !== null && goalId !== null && hint.goalId === goalId && hint.commands.length > 0 ? [checkHintText(hint.commands)] : []
}

/** Nhãn hạn mức của status line; đang dừng thì kèm lệnh chạy tiếp (0.7.6, U3) khi được truyền. */
export function withQuotaStatus(base: string | undefined, badge: QuotaBadge | null, lang: Lang, resume?: string): string | undefined {
  if (base === undefined || badge === null) return base
  const l = labels(lang)
  return `${base} · ${badge.paused ? `${l.quotaPaused}${resume ? ` · ${resume}` : ''}` : l.quotaLeft(percent(badge.left ?? 0))}`
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
    // 0.8.2 N4: kết quả sao lưu lên nhánh -wip của lần dừng này.
    if (cp.backup !== undefined) lines.push(`  ${backupLine(cp.backup, 'vi').replace(/^S/, 's')}`)
  }
  return lines
}

/** 0.8.2 N4: dòng sao lưu lên nhánh -wip của điểm dừng, cho /conductor status và mục Hạn mức của pane. */
export function backupLine(backup: CheckpointBackup, lang: Lang): string {
  const l = labels(lang)
  const state =
    backup.status === 'pushed' ? l.quotaBackupPushed(backup.branch, backup.hash ?? '') : backup.status === 'skipped' ? l.quotaBackupSkipped(l.quotaBackupReason[backup.reason]) : l.quotaBackupError(backup.message)
  return `${l.quotaBackup}: ${state}`
}

/** Ghi chú của Claude trong mục Hạn mức của pane: tối đa bấy nhiêu ký tự. */
export const PANE_NOTE_MAX = 160

/** Các dòng chữ của mục Hạn mức trong pane theo ngôn ngữ giao diện. `cause` là câu thay "Không có cảnh báo." khi đang dừng. */
export type QuotaPaneText = { windows: string[]; state: string; isPaused: boolean; cause: string; checkpoint: string[] }

/**
 * Hạn mức trên band (0.7.6, U3): đang dừng thì dòng 1 là "Tạm dừng: <lý do> · làm mới <giờ>" và dòng 2 là "Điểm dừng đã ghi · chạy tiếp:
 * <lệnh>"; chưa dừng mà đang trong vùng báo mềm thì câu báo cho dòng cần chú ý. Chỉ để hiển thị.
 */
export type BandQuota = { paused: boolean; line: string; resume: string; notice: string | null }

export function bandQuota(view: QuotaOverview, notices: readonly QuotaNoticeHit[], lang: Lang): BandQuota {
  const l = labels(lang)
  const isUser = view.state === 'user'
  const paused = view.state === 'quota' || isUser
  const left = (r: QuotaReason) => percent(Math.max(0, Math.round((100 - r.percentUsed) * 10) / 10))
  const cause = isUser ? l.quotaUserCause : view.reasons.length > 0 ? view.reasons.map(r => l.quotaShortReason(l.quotaName[r.kind], left(r))).join('; ') : l.quotaNearlyOut
  const reset = view.reasons.map(r => resetLabel(r.resetsAt)).find(text => text !== '') ?? ''
  const hit = notices[0]
  return {
    paused,
    line: l.pauseLine(cause, reset),
    resume: `${view.checkpoint !== null ? `${l.pauseCheckpointDone} · ` : ''}${l.pauseResume(resumeCommand(isUser))}`,
    notice: !paused && hit !== undefined ? l.quotaNotice(l.quotaWindowShort[hit.kind], percent(hit.remaining)) : null,
  }
}

export function quotaPaneText(view: QuotaOverview, lang: Lang, hasNotice = false): QuotaPaneText {
  const l = labels(lang)
  const windows = view.windows.map(w => `${l.quotaWindow[w.kind]}: ${l.quotaUsage(percent(w.used), percent(Math.max(0, 100 - w.used)), resetLabel(w.resetsAt), percent(w.threshold))}`)
  const reasonText = (r: QuotaReason) =>
    l.quotaReason(l.quotaName[r.kind], percent(Math.max(0, Math.round((100 - r.percentUsed) * 10) / 10)), percent(r.thresholdRemainingPct), resetLabel(r.resetsAt))
  const state = {
    // Báo mềm (0.7.6, U3): chưa dừng mà một cửa sổ đã vào vùng báo thì không ghi "bình thường".
    ok: hasNotice ? l.quotaStateNotice : l.quotaStateOk,
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
    if (cp.backup !== undefined) checkpoint.push(backupLine(cp.backup, lang))
    checkpoint.push(`${l.quotaContinue}: ${isPaused ? resumeCommand(view.state === 'user') : l.quotaContinueSoft}`)
  } else if (isPaused) {
    checkpoint.push(`${l.quotaContinue}: ${resumeCommand(view.state === 'user')}`)
  }
  return { windows, state: `${l.quotaState}: ${state}`, isPaused, cause, checkpoint }
}

// ------------------------------------------------------------ giữ mục tiêu qua lần nén (0.7.4)

/** Trần độ dài chung của khối nối vào instructions khi nén và khối nhắc sau nén. */
export const COMPACT_BLOCK_CHARS = 1500
/** Mỗi bước, mỗi ràng buộc, mỗi yêu cầu cắt còn bấy nhiêu ký tự; tối đa bấy nhiêu bước còn mở. */
const COMPACT_STEP_CHARS = 100
const COMPACT_RULE_CHARS = 100
const COMPACT_REQUIREMENT_CHARS = 120
const COMPACT_OPEN_STEPS = 10
/** Phần của trần dành cho dòng bước còn mở và dòng ràng buộc; dòng yêu cầu chưa phủ lấy phần còn lại. */
const COMPACT_STEPS_ROOM = 550
const COMPACT_RULES_ROOM = 320

function clipItem(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

/**
 * Dòng "Nhãn: a; b; c" thêm từng mục cho tới khi chạm `room` ký tự, kèm "(và N <đơn vị> khác)" khi còn mục chưa ghi
 * (`hidden` là số mục đã bỏ trước khi gọi). Không mục nào vừa thì không có dòng.
 */
function listLine(label: string, unit: string, items: readonly string[], room: number, hidden = 0): string | null {
  let line = ''
  let count = 0
  for (const item of items) {
    const rest = items.length - count - 1 + hidden
    const next = `${count === 0 ? `${label}: ` : `${line}; `}${item}`
    if (`${next}${rest > 0 ? ` (và ${rest} ${unit} khác)` : ''}`.length > room) break
    line = next
    count += 1
  }
  if (count === 0) return null
  const rest = items.length - count + hidden
  return `${line}${rest > 0 ? ` (và ${rest} ${unit} khác)` : ''}`
}

/** Khối dựng từ trạng thái lúc gọi: mục tiêu, (bước đang làm), bước còn mở kèm số, ràng buộc, yêu cầu chưa phủ; tổng không quá trần. */
function compactBlock(head: string, brief: Brief, plan: readonly PlanStep[], isReminder: boolean): string {
  const open = openSteps(plan)
  const stepItem = (step: PlanStep) => clipItem(`${step.id}. ${step.title}`, COMPACT_STEP_CHARS)
  const lines = [head, `Mục tiêu: ${clipItem(brief.goal, 200)}`]
  const current = open.find(step => step.status === 'doing') ?? open[0]
  if (isReminder && current !== undefined) lines.push(`Đang làm: ${stepItem(current)}`)
  const room = () => COMPACT_BLOCK_CHARS - lines.join('\n').length - 1
  const shown = open.slice(0, COMPACT_OPEN_STEPS)
  const sections: Array<[string, string, string[], number, number]> = [
    ['Bước còn mở', 'bước', shown.map(stepItem), COMPACT_STEPS_ROOM, open.length - shown.length],
    ['Ràng buộc', 'ràng buộc', brief.constraints.map(rule => clipItem(rule, COMPACT_RULE_CHARS)), COMPACT_RULES_ROOM, 0],
    ['Yêu cầu chưa có việc nào phủ', 'yêu cầu', uncoveredRequirements(brief).map(item => clipItem(item, COMPACT_REQUIREMENT_CHARS)), COMPACT_BLOCK_CHARS, 0],
  ]
  for (const [label, unit, items, cap, hidden] of sections) {
    const line = items.length > 0 ? listLine(label, unit, items, Math.min(cap, room()), hidden) : null
    if (line !== null) lines.push(line)
  }
  return lines.join('\n')
}

/** Khối nối vào instructions của session.compact (luồng chính): điều bản tóm tắt phải giữ nguyên. */
export function compactKeepText(brief: Brief, plan: readonly PlanStep[]): string {
  return compactBlock('[focus-conductor] Bản tóm tắt phải giữ nguyên các mục sau (mục tiêu và checklist người dùng đang làm):', brief, plan, false)
}

/** Khối nhắc gắn một lần vào kết quả tool kế tiếp của luồng chính sau lần nén, dựng từ trạng thái lúc nhắc. */
export function compactReminderText(brief: Brief, plan: readonly PlanStep[]): string {
  return compactBlock('[focus-conductor] Hội thoại vừa được nén. Làm tiếp đúng mục tiêu và giữ các ràng buộc đã chốt:', brief, plan, true)
}

// ------------------------------------------------------------ lệnh kiểm chưa đạt (0.7.8 vòng sửa 3, W4)

/** Số lượt sửa của một lệnh kiểm chưa đạt trong một mục tiêu: lượt 1 là phần làm dẫn tới lần lỗi đầu, lượt 2 và 3 mỗi lượt nâng một bậc. */
export const RETRY_ROUNDS = 3
/** Trần ký tự: dòng báo lỗi cho luồng chính, câu kèm plan update done, câu dặn khi luồng chính tự sửa file, lý do chặn Stop. */
export const RETRY_NOTICE_CHARS = 300
export const RETRY_DONE_CHARS = 200
export const RETRY_EDIT_CHARS = 200
export const RETRY_REASON_CHARS = 1200
/** Tiền tố description của lần giao sửa lỗi kiểm: mod chạy subagent đó ở mức đã nâng của lượt. */
export const RETRY_PREFIX = 'Sửa lỗi kiểm: '
/** Tên mục báo cáo cuối khi hết lượt mà lệnh kiểm vẫn chưa đạt. */
export const RETRY_REPORT = 'Chưa đạt yêu cầu'

/** Tên hiển thị của một mục: lệnh trong dấu `, hoặc mục tổng "và N lệnh khác chưa đạt". */
export function retryName(item: { command: string; more: readonly string[] }): string {
  return item.more.length > 0 ? `và ${item.more.length} lệnh khác chưa đạt` : `\`${clipMiddle(item.command, RETRY_COMMAND_CHARS)}\``
}

/** Trần ký tự của lệnh kiểm trong câu chặn, tiêu đề bước và note (0.8.0 A6). */
export const RETRY_COMMAND_CHARS = 100

/**
 * Lệnh quá `max` ký tự thì cắt ở giữa (0.8.0 A6): giữ đầu (trình chạy, cờ) và đuôi; đuôi luôn trọn từ cuối cùng của lệnh (tên file script),
 * tối thiểu 50 ký tự, tối đa max - 20 để còn chỗ cho đầu.
 */
export function clipMiddle(command: string, max: number): string {
  if (command.length <= max) return command
  const last = command.length - command.lastIndexOf(' ') - 1
  const tail = Math.min(Math.max(last + 1, 50), max - 20)
  return `${command.slice(0, max - tail - 1).trimEnd()}…${command.slice(command.length - tail)}`
}

/** Người chạy lần lỗi cuối của một mục W4: runner rỗng là luồng chính, còn lại là description của subagent (0.8.0 A6). */
export function retryWho(runner: string, descMax = 60): string {
  return runner === '' ? 'luồng chính' : `subagent "${clipItem(runner, descMax)}"`
}

/** Dòng báo cho luồng chính ngay khi một lệnh kiểm vừa lỗi: một lần mỗi lệnh mỗi lượt. */
/** Đoạn lệnh trong câu ngắn: quá `max` ký tự thì giữ phần đuôi (tên script nằm cuối lệnh). */
function clipTail(command: string, max: number): string {
  return command.length <= max ? command : `…${command.slice(command.length - max + 1)}`
}

/**
 * Lệnh kiểm nối && với lệnh khác và cả lệnh trả mã khác 0 (0.8.0 A11): mod không biết đoạn nào lỗi nên không tính lỗi hay đạt; một câu tối
 * đa 160 ký tự đề nghị chạy riêng lệnh kiểm.
 */
export function chainedCheckNote(command: string): string {
  return `[focus-conductor] ${clipTail(command, 60)} nối && và cả lệnh lỗi, chưa rõ lệnh kiểm đạt hay không: chạy riêng lệnh kiểm.`.slice(0, 160)
}

/**
 * Mục W4 tạo từ lần chạy của subagent (0.8.0 A12): luồng chính nhận một câu tối đa 160 ký tự ở kết quả tool kế tiếp, nêu subagent và lệnh.
 */
export function retryAgentNotice(command: string, description: string): string {
  return `[focus-conductor] Subagent "${clipItem(description, 60)}" chạy ${clipTail(command, 24)} lỗi; Stop chặn tới khi lệnh chạy lại đạt.`.slice(0, 160)
}

export function retryFailNotice(item: { command: string; more: readonly string[]; round: number }): string {
  const text =
    `[focus-conductor] Lệnh kiểm chưa đạt: ${retryName(item)} (lượt ${item.round}/${RETRY_ROUNDS}). Đọc lỗi, sửa nguyên nhân gốc, rồi chạy lại ` +
    'đúng lệnh đó; chưa đóng bước liên quan bằng done hay verified trước khi lệnh đạt.'
  return text.slice(0, RETRY_NOTICE_CHARS)
}

/** Câu kèm kết quả plan update done khi còn lệnh kiểm chưa đạt. */
export function retryDoneNote(count: number): string {
  return `[focus-conductor] Còn ${count} lệnh kiểm chưa đạt của mục tiêu này: đóng bước vẫn được, nhưng cổng kết thúc sẽ chặn cho tới khi lệnh đó đạt.`.slice(0, RETRY_DONE_CHARS)
}

/** Câu dặn khi luồng chính tự sửa file ở lượt 2 hay 3. */
export function retryEditNote(round: number, level: string): string {
  return `[focus-conductor] Lượt ${round}/${RETRY_ROUNDS} của lệnh kiểm chưa đạt cần mức ${level}: giao phần sửa cho subagent general-purpose, description mở đầu "${RETRY_PREFIX}".`.slice(0, RETRY_EDIT_CHARS)
}

/** Một dòng của lý do chặn: lượt mới của một lệnh, hoặc lệnh vừa hết lượt. */
export type RetryLine = { name: string; round: number; level: string; isTop: boolean; error: string; runner: string; at: string }

/**
 * Lý do cổng Stop chặn vì còn lệnh kiểm chưa đạt (0.7.8 vòng sửa 3, W4): mỗi lệnh một dòng (lượt, mức nâng, lỗi đầu), hướng làm của lượt
 * 2 hay 3, và với lệnh vừa hết lượt thì yêu cầu báo cáo cuối có mục "Chưa đạt yêu cầu". Không quá RETRY_REASON_CHARS ký tự: lỗi cắt dần.
 */
export function retryStopReason(advanced: readonly RetryLine[], exhausted: readonly RetryLine[], marked = 0, waiting: readonly RetryLine[] = []): string {
  const build = (cut: number, nameMax = 0, descMax = 60) => {
    const err = (line: RetryLine) => `, chạy bởi ${retryWho(line.runner, descMax)}${line.at !== '' ? ` lúc ${line.at}` : ''}${cut > 0 && line.error !== '' ? `; lỗi: ${clipItem(line.error, cut)}` : ''}`
    const nm = (line: RetryLine) => (nameMax > 0 ? clipMiddle(line.name, nameMax) : line.name)
    const parts = ['[focus-conductor] Còn lệnh kiểm chưa đạt, chưa kết thúc được.']
    for (const line of advanced) {
      const top = line.isTop ? ' (đã ở mức cao nhất chính sách cho phép)' : ''
      parts.push(`- ${nm(line)}: lượt ${line.round}/${RETRY_ROUNDS}, mức ${line.level}${top}${err(line)}`)
    }
    // Chưa chạy lại sau lần chặn trước (0.8.0 A2): lượt giữ nguyên, đòi chạy lại đúng lệnh.
    for (const line of waiting) {
      const top = line.isTop ? ' (đã ở mức cao nhất chính sách cho phép)' : ''
      parts.push(`- ${nm(line)}: lượt ${line.round}/${RETRY_ROUNDS}, mức ${line.level}${top}, chưa chạy lại; sửa rồi chạy lại đúng lệnh này, lượt chỉ tăng khi lần chạy lại vẫn lỗi${err(line)}`)
    }
    if (advanced.some(line => line.round === 2)) {
      parts.push(
        `Lượt 2: cách làm vừa rồi chưa được. Nêu một giả thuyết khác về nguyên nhân, giao phần sửa cho subagent general-purpose với description mở đầu "${RETRY_PREFIX}" và để trống model (mod chạy nó ở mức đã nâng), rồi chạy lại đúng lệnh kiểm.`,
      )
    }
    if (advanced.some(line => line.round === 3)) {
      parts.push(`Lượt 3: làm như lượt 2 ở mức nâng thêm một bậc; prompt của subagent nêu lỗi và các cách đã thử ở lượt 1 và 2.`)
    }
    if (exhausted.length > 0) {
      for (const line of exhausted) parts.push(`- ${nm(line)}: hết ${RETRY_ROUNDS} lượt vẫn chưa đạt${line.isTop ? ' (đã ở mức cao nhất chính sách cho phép)' : ''}${err(line)}`)
      parts.push(
        `${marked > 0 ? `Mod đã ghi ${marked} bước blocked; lần chạy đạt của đúng lệnh đó sẽ tự gỡ. ` : ''}Câu trả lời cuối phải có mục "${RETRY_REPORT}", mỗi lệnh một dòng: việc hay bước liên quan, lệnh kiểm, lỗi cuối, ba lượt đã thử (mức và cách làm từng lượt), điều chủ cần quyết định hay cung cấp.`,
      )
    }
    return parts.join('\n')
  }
  // Quá trần: lỗi cắt dần, rồi tên lệnh và description của subagent rút dần; người chạy và giờ chạy ở lại tới cùng.
  for (const [cut, nameMax, descMax] of [[160, 0, 60], [120, 0, 60], [60, 0, 60], [0, 0, 60], [0, 70, 40], [0, 50, 24], [0, 40, 12]] as const) {
    const text = build(cut, nameMax, descMax)
    if (text.length <= RETRY_REASON_CHARS) return text
  }
  return build(0, 40, 12).slice(0, RETRY_REASON_CHARS)
}

/** Trần ký tự của lý do chặn khi đã sửa mà chưa kiểm (0.7.9 Y6). */
const NO_CHECK_CHARS = 600

/** Lý do chặn một lần khi mục tiêu đã sửa file mà chưa chạy lần kiểm nào sau thay đổi cuối (0.7.9 Y6). */
export function noCheckReason(command: string): string {
  return (
    `[focus-conductor] Mục tiêu đã sửa file nhưng chưa chạy lần kiểm nào sau thay đổi cuối. Chạy \`${clipItem(command, 200)}\`, ` +
    'rồi kết thúc nếu đạt, hoặc sửa tiếp theo kết quả. Mod chỉ chặn một lần cho mỗi mục tiêu.'
  ).slice(0, NO_CHECK_CHARS)
}

/** Tên mục báo cáo cuối của lần thử skill (0.8.2 N3). */
export const SKILL_TRIAL_REPORT = 'Thử skill'
/** Trần ký tự lý do chặn của cổng thử skill (0.8.2 N3). */
const SKILL_TRIAL_CHARS = 600

/**
 * Lý do chặn một lần khi đã sửa file skill mà chưa thử sau lần sửa cuối (0.8.2 N3): hai prompt mẫu (một ca phải kích hoạt, một ca dễ nhầm
 * không được kích hoạt), ghi mong đợi trước, giao subagent general-purpose "Thử skill: <tên>", so kết quả, mục báo cáo "Thử skill".
 */
export function skillTrialReason(name: string, path: string): string {
  const skill = clipItem(name, 30)
  return (
    `[focus-conductor] Đã sửa skill \`${skill}\` (${clipItem(path, 40)}), chưa thử sau lần sửa cuối. Lấy hai prompt mẫu từ yêu cầu: ` +
    'một ca skill phải kích hoạt, một ca dễ nhầm skill không được kích hoạt; ghi kết quả mong đợi từng ca trước khi chạy. ' +
    `Giao subagent general-purpose, description \`Thử skill: ${skill}\`, đọc skill từ đường dẫn đã sửa và làm theo trên từng prompt. ` +
    `So kết quả với mong đợi. Báo cáo cuối có mục "${SKILL_TRIAL_REPORT}": prompt, mong đợi, thực tế, đạt hay chưa; chưa đạt thì sửa tiếp, không báo xong. ` +
    'Mod chặn một lần mỗi mục tiêu.'
  ).slice(0, SKILL_TRIAL_CHARS)
}

/** Tên mục báo cáo cuối khi chủ mod đã miễn lệnh kiểm (0.7.9 Y5). */
export const WAIVE_REPORT = 'Lệnh kiểm được miễn'
/** Trần ký tự của câu đòi mục "Lệnh kiểm được miễn". */
const WAIVE_ASK_CHARS = 600

/** Lý do chặn một lần khi có lệnh miễn mới (0.7.9 Y5): liệt kê lệnh, lý do, yêu cầu mục báo cáo; tối đa WAIVE_ASK_CHARS ký tự. */
export function waiveAskText(items: readonly { command: string; reason: string }[]): string {
  const head = '[focus-conductor] Chủ mod đã miễn lệnh kiểm chưa đạt:'
  const tail = `Câu trả lời cuối phải có mục "${WAIVE_REPORT}", mỗi lệnh một dòng: lệnh, lý do miễn.`
  const rows = items.map(item => `- \`${clipItem(item.command, 80)}\`: ${clipItem(item.reason, 120)}`)
  return [head, ...rows, tail].join('\n').slice(0, WAIVE_ASK_CHARS)
}

/** Ghép lý do của phần lệnh kiểm chưa đạt với lý do của cổng checklist, trong trần RETRY_REASON_CHARS. */
export function joinStopReasons(retry: string, other: string): string {
  const room = RETRY_REASON_CHARS - retry.length - 1
  return room <= 0 ? retry.slice(0, RETRY_REASON_CHARS) : `${retry}\n${other.slice(0, room)}`
}

/** Note mod ghi vào bước blocked khi hết lượt: lệnh, lỗi cuối, mức của ba lượt. */
export function retryStepNote(item: { command: string; more: readonly string[]; lastError: string; levels: readonly string[]; runner: string; ranAt: string }): string {
  const error = item.lastError !== '' ? `; lỗi cuối: ${clipItem(item.lastError, RETRY_ERROR_CHARS)}` : ''
  const who = `; chạy lần lỗi cuối bởi ${retryWho(item.runner)}${item.ranAt !== '' ? ` lúc ${item.ranAt}` : ''}`
  return `Mod ghi: ${item.more.length > 0 ? retryName(item) : clipMiddle(item.command, RETRY_COMMAND_CHARS)} chưa đạt sau ${RETRY_ROUNDS} lượt${who}${error}; mức: ${item.levels.join(', ')}`
}

/** Trần ký tự đoạn lỗi cuối của một mục W4 (0.8.0 A6). */
export const RETRY_ERROR_CHARS = 160

/**
 * Dòng lỗi của output một lần chạy kiểm: dòng đầu có dấu hiệu lỗi. Không dòng nào có dấu hiệu thì lấy dòng không rỗng cuối của output (0.8.0
 * A6), kèm ghi chú "không có dòng lỗi"; mã thoát chỉ biết là khác 0 khi tool báo lỗi (isError), không bịa số. Tối đa RETRY_ERROR_CHARS ký tự.
 */
export function firstErrorLine(output: string | undefined, isError = false): string {
  const lines = (output ?? '').split('\n').map(line => line.trim()).filter(Boolean)
  const hit = lines.find(line => /error|fail|lỗi|✗|×|assert/i.test(line))
  if (hit !== undefined) return hit.slice(0, RETRY_ERROR_CHARS)
  const last = lines.at(-1)
  if (last === undefined) return ''
  const note = ` (không có dòng lỗi${isError ? ', mã thoát khác 0' : ''})`
  return `${clipItem(last, RETRY_ERROR_CHARS - note.length)}${note}`
}

/** Trần đoạn dặn vai điều phối (0.8.4 C5). */
export const CONDUCTOR_CHARS = 480

/** Đoạn dặn vai điều phối (0.8.4 C5): chèn một lần mỗi mục tiêu cùng khối brief khi luồng chính điều phối. */
export function conductorContext(): string {
  return (
    '[focus-conductor] Điều phối: luồng chính là vai điều phối, chạy fable/medium. Lập kế hoạch, rồi giao từng việc bằng Agent đúng loại ' +
    'agent, model, effort đã phân, description mở đầu bằng "Việc N". Mỗi lời giao tự đứng được: mục tiêu, phạm vi file, ràng buộc, tiêu ' +
    'chí xong và lệnh kiểm. Không tự sửa file, không tự chạy lệnh kiểm: chỉnh nhỏ gom vào một lời giao, lệnh kiểm giao một subagent chạy ' +
    'và báo tóm tắt. Đọc kết quả, đối chiếu yêu cầu trước khi đóng bước.'
  )
}

/** Trần lời từ chối và dòng nhắc của vai điều phối (0.8.6). */
export const CONDUCT_DENY_CHARS = 300

/** Lời từ chối khi luồng chính đang điều phối tự chạy lệnh kiểm (0.8.6 R2). */
export function conductCheckDenyText(): string {
  return (
    '[focus-conductor] Luồng chính đang giữ vai điều phối: vai điều phối không tự chạy lệnh kiểm. Giao một subagent chạy lệnh này và báo ' +
    'tóm tắt đạt hay lỗi, kèm dòng lỗi. Không giao được thì người dùng gõ /conductor solo.'
  )
}

/** Lời từ chối khi luồng chính đang điều phối tự sửa file (0.8.6 R1). */
export function conductWriteDenyText(): string {
  return (
    '[focus-conductor] Luồng chính đang giữ vai điều phối: vai điều phối không tự sửa file. Giao việc này bằng Agent theo phân việc, gom ' +
    'các chỉnh nhỏ vào một lời giao. Không giao được thì người dùng gõ /conductor solo.'
  )
}

/** Trần câu nhắc lại vai điều phối (0.8.4 V1). */
export const CONDUCTOR_KEEP_CHARS = 200

/** Câu nhắc lại vai điều phối (0.8.4 V1): nối vào lời nhắc sau nén và ngữ cảnh chạy tiếp khi luồng chính đang điều phối. */
export function conductorKeepText(): string {
  return '[focus-conductor] Vẫn là vai điều phối chạy fable/medium: không tự sửa file, không tự chạy kiểm; giao bằng Agent theo phân việc, lời giao tự đứng được; đối chiếu kết quả trước khi đóng bước.'
}
