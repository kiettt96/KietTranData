// Nhãn cố định của band và pane theo option uiLanguage (vi mặc định, en). Nội dung động (mục tiêu, lý do của
// router, cảnh báo, nhật ký, sổ chi phí) giữ nguyên ngôn ngữ của nó: router trả lời theo ngôn ngữ của prompt.

import type { StepStatus, WarningKind } from '../../types'
import { hasTitleCode } from '../lib/route'
import type { Phase } from './style'

export type Lang = 'vi' | 'en'

export function langOf(value: unknown): Lang {
  return value === 'en' ? 'en' : 'vi'
}

/** Phần trong ngoặc của dòng tóm tắt bước đã đóng (0.7.6, U7): chỉ các số khác 0, rỗng thì không có ngoặc. */
const closedParts = (parts: string[]) => (parts.some(Boolean) ? ` (${parts.filter(Boolean).join(', ')})` : '')

const VI = {
  suggest: 'đề xuất',
  mode: 'chế độ',
  details: 'Chi tiết',
  hide: 'Ẩn',
  plannedSteps: (n: number) => `${n} bước dự kiến`,
  phase: { idle: 'chưa bắt đầu', start: 'mới bắt đầu', active: 'đang thực hiện', almost: 'sắp xong', done: 'hoàn thành' } as Record<Phase, string>,
  allClosed: 'Đã xong mọi bước',
  completedGoal: (goal: string) => `Hoàn thành: ${goal}`,
  modeLabel: 'Chế độ',
  noGoal: 'Chưa có mục tiêu. Gửi một prompt, hoặc dùng /conductor goal kèm mô tả mục tiêu.',
  noChecklist: 'Claude chưa chốt checklist.',
  notRead: 'router chưa đọc',
  constraints: 'Ràng buộc',
  noConstraints: 'Không nhận ra ràng buộc rõ ràng.',
  quality: 'Tiêu chí chất lượng',
  noQuality: 'Không nhận ra tiêu chí riêng.',
  planned: 'Việc dự kiến (router)',
  check: 'đạt khi',
  legend: { verified: 'đã kiểm chứng', done: 'xong', doing: 'đang làm', blocked: 'bị chặn', waiting: 'chờ kết quả', todo: 'chờ', skipped: 'bỏ qua' } as Record<StepStatus, string>,
  routing: 'Điều phối',
  running: 'Đang chạy',
  runningRange: (first: number, last: number) => (first === last ? `lô ${first}` : `lô ${first} đến ${last}`),
  runningAgents: (n: number) => `${n} agent`,
  routeShape: (depth: string, volume: string, kind: string) => `độ sâu ${depth} · khối lượng ${volume} · loại ${kind}`,
  forWork: (depth: string, volume: string) => ` cho việc ${depth}, khối lượng ${volume}`,
  notApplied: 'Chưa áp dụng; luồng chính đang dùng model của phiên.',
  cost: 'Chi phí',
  costGoal: 'mục tiêu',
  costSession: 'phiên',
  quotaPaused: 'tạm dừng: hạn mức',
  quotaPausedShort: 'dừng',
  quotaLeft: (percent: string) => `hạn mức còn ${percent}`,
  quotaNotice: (window: string, percent: string) => `báo hạn mức: ${window} còn ${percent}`,
  quotaWindowShort: { five_hour: 'phiên', seven_day: 'tuần' } as Record<'five_hour' | 'seven_day', string>,
  quota: 'Hạn mức',
  quotaWindow: { five_hour: 'phiên (5 giờ)', seven_day: 'tuần' } as Record<'five_hour' | 'seven_day', string>,
  quotaName: { five_hour: 'hạn mức phiên (5 giờ)', seven_day: 'hạn mức tuần' } as Record<'five_hour' | 'seven_day', string>,
  quotaUsage: (used: string, left: string, reset: string, threshold: string) =>
    `đã dùng ${used}, còn ${left}${reset ? `, làm mới ${reset}` : ''}, ngưỡng còn ${threshold}`,
  quotaReason: (name: string, left: string, threshold: string, reset: string) =>
    `${name} chỉ còn ${left} (ngưỡng ${threshold})${reset ? `, làm mới lúc ${reset}` : ''}`,
  quotaState: 'Trạng thái',
  quotaStateOk: 'bình thường',
  quotaStateNotice: 'báo mềm',
  quotaShortReason: (name: string, left: string) => `${name} còn ${left}`,
  pauseLine: (cause: string, reset: string) => `Tạm dừng: ${cause}${reset ? ` · làm mới ${reset}` : ''}`,
  pauseCheckpointDone: 'Điểm dừng đã ghi',
  pauseResume: (command: string) => `chạy tiếp: ${command}`,
  quotaStateQuota: 'tạm dừng (hạn mức)',
  quotaStateUser: 'tạm dừng (người dùng)',
  quotaStateForced: (names: string, until: string) => `ép tiếp ${names} tới ${until}`,
  quotaStateNone: 'không có dữ liệu (engine không báo hạn mức: tài khoản không dùng gói subscription, chưa có lượt đọc đầu, hoặc số đo đã cũ)',
  quotaAnd: ' và ',
  quotaUserCause: 'người dùng yêu cầu tạm dừng (/conductor pause)',
  quotaNearlyOut: 'hạn mức sắp hết',
  quotaReasonLabel: 'Lý do',
  quotaCheckpoint: 'Điểm dừng',
  quotaCheckpointOpen: 'đang mở',
  quotaCheckpointResuming: 'đang tiếp tục',
  quotaCreated: (at: string) => `tạo lúc ${at}`,
  quotaNote: 'Ghi chú của Claude',
  quotaNoNote: 'Claude chưa ghi note',
  quotaContinue: 'Chạy tiếp',
  quotaContinueSoft: 'nói "tiếp tục" hoặc dùng /conductor resume',
  quotaPausedNow: 'Đang tạm dừng',
  mirrorShort: 'danh sách việc',
  taskSection: 'Tiến độ từng việc',
  taskMain: 'Việc chính',
  taskNumber: (n: number) => `Việc ${n}`,
  taskOwn: 'Claude tự giao',
  taskState: { pending: 'chờ giao', idle: 'chưa bắt đầu', running: 'đang chạy', done: 'xong', failed: 'lỗi, chưa giao lại', cut: 'bị cắt vì tạm dừng' } as Record<'pending' | 'idle' | 'running' | 'done' | 'failed' | 'cut', string>,
  taskDoing: 'đang làm',
  taskTools: (n: number) => `${n} tool`,
  taskBatches: (done: number, total: number, running: number) => `${done}/${total} lô xong${running > 0 ? `, ${running} đang chạy` : ''}`,
  taskElapsed: (ms: number) => (ms < 60_000 ? '<1 phút' : `${Math.floor(ms / 60_000)} phút`),
  taskMore: (k: number) => `+${k} việc`,
  stepsClosed: (n: number, verified = 0, skipped = 0) => `${n} bước đã đóng${closedParts([verified > 0 ? `${verified} đã kiểm chứng` : '', skipped > 0 ? `${skipped} bỏ qua` : ''])}`,
  stepsOpenMore: (n: number) => `+${n} bước mở`,
  checklist: 'Danh sách bước',
  agentChip: (done: number, total: number) => `subagent ${done}/${total} xong`,
  attentionFailed: (n: number) => `${n} lô lỗi chưa giao lại`,
  agentsRunning: (n: number) => `${n} subagent đang chạy`,
  agentBatchChip: (running: number, failed: number) => [running > 0 ? `${running} đang chạy` : '', failed > 0 ? `${failed} lỗi` : ''].filter(Boolean).join(' · '),
  goalElapsed: (ms: number) => (ms < 60_000 ? '<1 phút' : ms < 3_600_000 ? `${Math.floor(ms / 60_000)} phút` : `${Math.floor(ms / 3_600_000)} giờ ${Math.floor((ms % 3_600_000) / 60_000)} phút`),
  mirrorSource: 'Theo danh sách việc của Claude Code (chỉ để theo dõi, không chặn kết thúc)',
  costCalls: 'lượt',
  groupMain: 'luồng chính',
  groupAgent: 'subagent',
  groupRouter: 'router',
  total: 'tổng',
  spawned: (n: number) => `${n} subagent đã giao trong mục tiêu này`,
  delegations: 'Việc giao subagent',
  delegationState: { pending: 'chờ giao', running: 'đang chạy', done: 'xong', failed: 'lỗi, chưa giao lại' } as Record<'pending' | 'running' | 'done' | 'failed', string>,
  log: 'Nhật ký điều phối',
  main: 'chính',
  estimatedNote: '~ ước tính lúc giao, chưa có số đo',
  skipped: ' (không áp dụng)',
  warnings: 'Cảnh báo nhất quán',
  noWarnings: 'Không có cảnh báo.',
  checkHint: (list: string, isDir: boolean) =>
    `Mod chưa nhận script kiểm đã chạy là lệnh kiểm. Gợi ý khai option checkCommands của mod: ${list}.${isDir ? ' Tiền tố thư mục tin mọi script dưới thư mục đó: chỉ khai nếu thư mục chỉ chứa script kiểm.' : ''}`,
  warningKind: {
    loop: 'lặp',
    budget: 'ngân sách',
    scope: 'phạm vi',
    'scope-unknown': 'đích chưa rõ',
    unverified: 'chưa kiểm',
    'open-steps': 'bước mở',
    model: 'model',
    cost: 'chi phí',
    drift: 'lạc đề',
    dropped: 'mục bị bỏ',
  } as Record<WarningKind, string>,
  reset: 'Đặt lại mục tiêu',
  resetConfirm: 'Bấm lại để xóa',
  resetArmedToast: 'Bấm "Đặt lại mục tiêu" lần nữa trong 10 giây để xóa.',
  resetExpiredToast: 'Đã hủy yêu cầu đặt lại (quá 10 giây).',
  resetDoneToast: 'Đã đặt lại mục tiêu, checklist, cảnh báo, mục tiêu đã cất, sổ chi phí và danh sách model bị chặn.',
  showBand: 'Hiện band',
  hideBand: 'Ẩn band',
}

const EN: typeof VI = {
  suggest: 'suggest',
  mode: 'mode',
  details: 'Details',
  hide: 'Hide',
  plannedSteps: n => `${n} planned steps`,
  phase: { idle: 'not started', start: 'just started', active: 'in progress', almost: 'almost done', done: 'completed' },
  allClosed: 'All steps closed',
  completedGoal: goal => `Completed: ${goal}`,
  modeLabel: 'Mode',
  noGoal: 'No goal yet. Send a prompt, or use /conductor goal with a description.',
  noChecklist: 'Claude has not set a checklist yet.',
  notRead: 'not read by the router',
  constraints: 'Constraints',
  noConstraints: 'No explicit constraints found.',
  quality: 'Quality criteria',
  noQuality: 'No specific criteria found.',
  planned: 'Planned work (router)',
  check: 'passes when',
  legend: { verified: 'verified', done: 'done', doing: 'in progress', blocked: 'blocked', waiting: 'waiting', todo: 'to do', skipped: 'skipped' },
  routing: 'Routing',
  running: 'Running',
  runningRange: (first, last) => (first === last ? `run ${first}` : `runs ${first} to ${last}`),
  runningAgents: n => `${n} ${n === 1 ? 'agent' : 'agents'}`,
  routeShape: (depth, volume, kind) => `depth ${depth} · volume ${volume} · kind ${kind}`,
  forWork: (depth, volume) => ` for ${depth} work, volume ${volume}`,
  notApplied: 'Not applied; the main thread runs the session model.',
  cost: 'Cost',
  costGoal: 'goal',
  costSession: 'session',
  quotaPaused: 'paused: quota',
  quotaPausedShort: 'paused',
  quotaLeft: (percent: string) => `quota left ${percent}`,
  quotaNotice: (window: string, percent: string) => `quota notice: ${window} ${percent} left`,
  quotaWindowShort: { five_hour: 'session', seven_day: 'week' },
  quota: 'Quota',
  quotaWindow: { five_hour: 'session (5h)', seven_day: 'week' },
  quotaName: { five_hour: 'session quota (5h)', seven_day: 'weekly quota' },
  quotaUsage: (used, left, reset, threshold) => `used ${used}, left ${left}${reset ? `, resets ${reset}` : ''}, threshold ${threshold} left`,
  quotaReason: (name, left, threshold, reset) => `${name} only ${left} left (threshold ${threshold})${reset ? `, resets at ${reset}` : ''}`,
  quotaState: 'State',
  quotaStateOk: 'normal',
  quotaStateNotice: 'soft notice',
  quotaShortReason: (name, left) => `${name} ${left} left`,
  pauseLine: (cause, reset) => `Paused: ${cause}${reset ? ` · resets ${reset}` : ''}`,
  pauseCheckpointDone: 'Checkpoint saved',
  pauseResume: command => `continue with: ${command}`,
  quotaStateQuota: 'paused (quota)',
  quotaStateUser: 'paused (by you)',
  quotaStateForced: (names, until) => `forced past ${names} until ${until}`,
  quotaStateNone: 'no data (the engine reports no quota: not a subscription account, no reading yet, or the reading is stale)',
  quotaAnd: ' and ',
  quotaUserCause: 'you asked to pause (/conductor pause)',
  quotaNearlyOut: 'quota nearly used up',
  quotaReasonLabel: 'Reason',
  quotaCheckpoint: 'Checkpoint',
  quotaCheckpointOpen: 'open',
  quotaCheckpointResuming: 'resuming',
  quotaCreated: at => `created ${at}`,
  quotaNote: "Claude's note",
  quotaNoNote: 'Claude has not written a note yet',
  quotaContinue: 'Continue with',
  quotaContinueSoft: 'say "continue" or use /conductor resume',
  quotaPausedNow: 'Paused',
  mirrorShort: 'task list',
  taskSection: 'Progress by task',
  taskMain: 'Main work',
  taskNumber: n => `Task ${n}`,
  taskOwn: 'Delegated by Claude',
  taskState: { pending: 'not delegated yet', idle: 'not started', running: 'running', done: 'done', failed: 'failed, not re-delegated', cut: 'cut by pause' },
  taskDoing: 'in progress',
  taskTools: n => `${n} ${n === 1 ? 'tool' : 'tools'}`,
  taskBatches: (done, total, running) => `${done}/${total} runs done${running > 0 ? `, ${running} running` : ''}`,
  taskElapsed: ms => (ms < 60_000 ? '<1 min' : `${Math.floor(ms / 60_000)} min`),
  taskMore: k => `+${k} ${k === 1 ? 'task' : 'tasks'}`,
  stepsClosed: (n, verified = 0, skipped = 0) => `${n} ${n === 1 ? 'step' : 'steps'} closed${closedParts([verified > 0 ? `${verified} verified` : '', skipped > 0 ? `${skipped} skipped` : ''])}`,
  stepsOpenMore: n => `+${n} open ${n === 1 ? 'step' : 'steps'}`,
  checklist: 'Checklist',
  agentChip: (done, total) => `${done}/${total} subagent done`,
  attentionFailed: n => `${n} failed ${n === 1 ? 'run' : 'runs'} not re-delegated`,
  agentsRunning: n => `${n} ${n === 1 ? 'subagent' : 'subagents'} running`,
  agentBatchChip: (running, failed) => [running > 0 ? `${running} running` : '', failed > 0 ? `${failed} failed` : ''].filter(Boolean).join(' · '),
  goalElapsed: ms => (ms < 60_000 ? '<1 min' : ms < 3_600_000 ? `${Math.floor(ms / 60_000)} min` : `${Math.floor(ms / 3_600_000)} h ${Math.floor((ms % 3_600_000) / 60_000)} min`),
  mirrorSource: "From Claude Code's task list (tracking only, never blocks stopping)",
  costCalls: 'calls',
  groupMain: 'main',
  groupAgent: 'subagent',
  groupRouter: 'router',
  total: 'total',
  spawned: n => `${n} subagents spawned in this goal`,
  delegations: 'Delegated tasks',
  delegationState: { pending: 'not delegated yet', running: 'running', done: 'done', failed: 'failed, not re-delegated' },
  log: 'Routing log',
  main: 'main',
  estimatedNote: '~ estimated at delegation, not measured yet',
  skipped: ' (not applied)',
  warnings: 'Consistency warnings',
  noWarnings: 'No warnings.',
  checkHint: (list: string, isDir: boolean) =>
    `The mod does not recognize the check script that ran as a check. Suggested checkCommands option: ${list}.${isDir ? ' A directory prefix trusts every script under it: declare it only if the directory holds check scripts only.' : ''}`,
  warningKind: {
    loop: 'loop',
    budget: 'budget',
    scope: 'scope',
    'scope-unknown': 'unclear target',
    unverified: 'unverified',
    'open-steps': 'open steps',
    model: 'model',
    cost: 'cost',
    drift: 'drift',
    dropped: 'dropped items',
  },
  reset: 'Reset goal',
  resetConfirm: 'Press again to clear',
  resetArmedToast: 'Press "Reset goal" again within 10 seconds to clear.',
  resetExpiredToast: 'Reset request cancelled (10 seconds passed).',
  resetDoneToast: 'Reset the goal, checklist, warnings, stashed goals, cost ledger and blocked-model list.',
  showBand: 'Show band',
  hideBand: 'Hide band',
}

export function labels(lang: Lang): typeof VI {
  return lang === 'en' ? EN : VI
}

/** Tên tier bằng tiếng Việt thường trong câu cảnh báo hiển thị (0.7.6, U12). */
const TIER_VI: Record<string, string> = { trivial: 'rất nhẹ', simple: 'đơn giản', moderate: 'vừa', complex: 'phức tạp', deep: 'rất sâu' }
const WORD = (word: string) => new RegExp(`(?<![\\p{L}\\p{N}])${word}(?![\\p{L}\\p{N}])`, 'gu')

/**
 * Câu cảnh báo khi vẽ trên band và pane (0.7.6, U12): giao diện tiếng Việt thì tier, verified, evidence, done viết bằng tiếng Việt thường.
 * Chỉ đổi chữ hiển thị: câu đã lưu, câu gửi router và context chèn cho Claude giữ nguyên.
 */
export function shownWarning(text: string, lang: Lang): string {
  if (lang !== 'vi') return text
  return text
    .replace(/cho việc (trivial|simple|moderate|complex|deep)(?![\p{L}\p{N}])/gu, (_all, tier: string) => `cho việc ${TIER_VI[tier] ?? tier}`)
    .replace(WORD('lưu là done'), 'lưu là xong')
    .replace(WORD('verified'), 'đã kiểm chứng')
    .replace(WORD('evidence'), 'bằng chứng')
}

/**
 * Chip của dòng bước khớp một việc (0.7.6, U1): việc nhiều lô thì model và số lô ("sonnet 97/100 · 3 lỗi"); việc một lần gọi thì model
 * và trạng thái ("sonnet đang chạy"); việc làm trực tiếp thì model và effort ("opus high"). Số tool call và thời gian đi ở phần chi tiết.
 */
export function stepTaskMeta(l: typeof VI, row: { kind: 'main' | 'direct' | 'agent'; pick: { family: string; effort: string } | null; state: 'pending' | 'idle' | 'running' | 'done' | 'failed' | 'cut'; counts?: { done: number; total: number; running: number }; failed?: number }): string {
  const family = row.pick?.family ?? ''
  if (row.counts !== undefined) return [`${family} ${row.counts.done}/${row.counts.total}`.trim(), l.agentBatchChip(row.counts.running, row.failed ?? 0)].filter(Boolean).join(' · ')
  if (row.kind === 'agent') return `${family} ${l.taskState[row.state]}`.trim()
  return row.pick ? `${row.pick.family} ${row.pick.effort}` : ''
}

/**
 * Tên một dòng tiến độ (0.6.1): "Việc chính: ...", "Việc N: ...", hay "Claude tự giao: ...". Dùng chung cho band và pane.
 * Việc có mã (BƯỚC 4, K4.2, Việc 3) hiện chính tiêu đề mang mã đó, không ghép "Việc 5: BƯỚC 4: ..." (vòng sửa 2 của 0.7.5).
 */
export function taskLabel(l: typeof VI, row: { kind: 'main' | 'direct' | 'agent'; index?: number; title: string }): string {
  if (row.index !== undefined && hasTitleCode(row.title)) return row.title
  const head = row.kind === 'main' ? l.taskMain : row.index !== undefined ? l.taskNumber(row.index) : l.taskOwn
  return `${head}: ${row.title}`
}
