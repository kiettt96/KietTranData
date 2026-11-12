// Nhãn cố định của band và pane theo option uiLanguage (vi mặc định, en). Nội dung động (mục tiêu, lý do của
// router, cảnh báo, nhật ký, sổ chi phí) giữ nguyên ngôn ngữ của nó: router trả lời theo ngôn ngữ của prompt.

import type { StepStatus, WarningKind } from '../../types'
import { hasTitleCode } from '../lib/route'
import { conductorShown } from '../lib/conductor'
import type { Phase } from './style'

export type Lang = 'vi' | 'en'

export function langOf(value: unknown): Lang {
  return value === 'en' ? 'en' : 'vi'
}

/** Số phút làm tròn (0.7.6, W4): 150 giây là 3 phút, để thời gian ghi gần với thực tế hơn khi chưa vẽ lại. */
const roundedMinutes = (ms: number) => Math.round(ms / 60_000)

/** Giờ máy HH:MM của một mốc thời gian (0.7.6, W4), cho "từ <giờ bắt đầu>". */
export function clockOf(at: number): string {
  const d = new Date(at)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(d.getHours())}:${two(d.getMinutes())}`
}

/** Phần trong ngoặc của dòng tóm tắt bước đã đóng (0.7.6, U7): chỉ các số khác 0, rỗng thì không có ngoặc. */
const closedParts = (parts: string[]) => (parts.some(Boolean) ? ` (${parts.filter(Boolean).join(', ')})` : '')

const VI = {
  suggest: 'đề xuất',
  mode: 'chế độ',
  details: 'Chi tiết',
  hide: 'Ẩn',
  plannedSteps: (n: number) => `${n} bước dự kiến`,
  retryExhausted: (command: string) => `Chưa đạt sau 3 lượt: ${command}`,
  behaviorHead: (n: number) => `Sự cố hành vi của mod: ${n} loại`,
  behaviorLine: (kind: string, message: string, count: number, first: string, last: string) => `${kind} · ${message} · ${count} lần · lần đầu ${first} · lần cuối ${last}`,
  retryCleared: (command: string, step: number) => `Đã gỡ chặn: ${command} chạy lại đạt, bước ${step} về trạng thái cũ`,
  retryPassedAt: (clock: string) => `đã đạt lúc ${clock}`,
  waived: (command: string) => `đã miễn: \`${command}\``,
  // Kế hoạch đã trình chờ người dùng duyệt (0.8.2 N2): mục cần chú ý và nhãn status line.
  planAwaiting: 'Chờ duyệt kế hoạch',
  planAwaitingShort: 'chờ duyệt kế hoạch',
  // Đã sửa file skill mà chưa thử sau lần sửa cuối (0.8.2 N3): mục cần chú ý.
  skillUntried: 'Skill chưa thử',
  phase: { idle: 'chưa bắt đầu', start: 'mới bắt đầu', active: 'đang thực hiện', almost: 'sắp xong', done: 'hoàn thành' } as Record<Phase, string>,
  allClosed: 'Đã xong mọi bước',
  completedGoal: (goal: string) => `Hoàn thành: ${goal}`,
  modeLabel: 'Chế độ',
  noGoal: 'Chưa có mục tiêu. Gửi một prompt, hoặc dùng /conductor goal kèm mô tả mục tiêu.',
  notRead: 'router chưa đọc',
  constraints: 'Ràng buộc',
  noConstraints: 'Không nhận ra ràng buộc rõ ràng.',
  quality: 'Tiêu chí chất lượng',
  noQuality: 'Không nhận ra tiêu chí riêng.',
  plannedTag: '(dự kiến)',
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
  // 0.8.2 N4: sao lưu lên nhánh -wip lúc dừng vì hạn mức.
  quotaBackup: 'Sao lưu',
  quotaBackupPushed: (branch: string, hash: string) => `đã push lên ${branch}${hash ? ` (${hash.slice(0, 12)})` : ''}`,
  quotaBackupSkipped: (reason: string) => `bỏ qua (${reason})`,
  quotaBackupError: (message: string) => `lỗi: ${message}`,
  quotaBackupReason: { 'no-repo': 'không phải git repo', 'no-remote': 'không có remote' } as Record<'no-repo' | 'no-remote', string>,
  quotaContinue: 'Chạy tiếp',
  quotaContinueSoft: 'nói "tiếp tục" hoặc dùng /conductor resume',
  quotaPausedNow: 'Đang tạm dừng',
  mirrorShort: 'danh sách việc',
  taskSection: 'Tiến độ từng việc',
  phaseArchived: (n: number) => `${n} việc của đợt trước`,
  taskMain: 'Việc chính',
  taskNumber: (n: number) => `Việc ${n}`,
  taskOwn: 'Claude tự giao',
  forksMerged: (n: number) => `${n} phiên con đã gom`,
  forkCost: (n: number) => `Nhóm subagent gồm ${n} phiên con`,
  taskState: { pending: 'chờ giao', idle: 'chưa bắt đầu', running: 'đang chạy', done: 'xong', failed: 'lỗi, chưa giao lại', cut: 'bị cắt vì tạm dừng' } as Record<'pending' | 'idle' | 'running' | 'done' | 'failed' | 'cut', string>,
  taskDoing: 'đang làm',
  noStep: 'chưa gắn bước',
  taskTools: (n: number) => `${n} tool`,
  taskBatches: (done: number, total: number, running: number) => `${done}/${total} lô xong${running > 0 ? `, ${running} đang chạy` : ''}`,
  taskElapsed: (ms: number) => (ms < 60_000 ? '<1 phút' : `${roundedMinutes(ms)} phút`),
  taskMore: (k: number) => `+${k} việc`,
  stepsClosed: (n: number, verified = 0, skipped = 0) => `${n} bước đã đóng${closedParts([verified > 0 ? `${verified} đã kiểm chứng` : '', skipped > 0 ? `${skipped} bỏ qua` : ''])}`,
  stepsOpenMore: (n: number) => `+${n} bước mở`,
  checklist: 'Danh sách bước',
  agentChip: (done: number, total: number) => `subagent ${done}/${total} xong`,
  attentionFailed: (n: number) => `${n} lô lỗi chưa giao lại`,
  agentsRunning: (n: number) => `${n} subagent đang chạy`,
  agentBatchChip: (running: number, failed: number) => [running > 0 ? `${running} đang chạy` : '', failed > 0 ? `${failed} lỗi` : ''].filter(Boolean).join(' · '),
  goalElapsed: (ms: number) => (ms < 60_000 ? '<1 phút' : roundedMinutes(ms) < 60 ? `${roundedMinutes(ms)} phút` : `${Math.floor(roundedMinutes(ms) / 60)} giờ ${roundedMinutes(ms) % 60} phút`),
  runningSince: (at: number) => `từ ${clockOf(at)}`,
  mirrorSource: 'Theo danh sách việc của Claude Code (chỉ để theo dõi, không chặn kết thúc)',
  costCalls: 'lượt',
  groupMain: 'luồng chính',
  groupAgent: 'subagent',
  /** Fable điều phối (0.8.4 C8): nhãn vai trên chip model của band, và dòng Điều phối ở pane và /conductor status. */
  conductorRole: 'điều phối',
  conductorOn: 'Điều phối: fable/medium, đang điều phối',
  conductorPaused: (fallback: string) => `Điều phối: Fable tạm ngừng, router dùng ${fallback}`,
  conductorOff: (reason: string) => `Điều phối: tắt (${reason})`,
  conductExempt: (reason: 'solo' | 'agent') => `đang miễn (${reason === 'solo' ? 'lệnh solo' : 'Agent bị từ chối'})`,
  conductCounts: { deniedWrites: 'từ chối sửa file', deniedChecks: 'từ chối chạy kiểm', selfWrites: 'tự sửa file', selfChecks: 'tự chạy kiểm', reads: 'đọc' },
  conductorReason: {
    option: 'option conductor là off',
    mode: 'chế độ điều phối không phải auto',
    headless: 'phiên không tương tác',
    blocked: 'họ fable đang bị chặn vì không phản hồi',
    paused: 'router Fable tạm ngừng',
    session: 'sessionModel giữ model của phiên',
    small: 'mục tiêu hiện tại không phải việc lớn',
    none: 'chưa đọc prompt nào',
  } as Record<string, string>,
  /** Router Fable tạm ngừng (0.8.4 C6): nhãn status line và /conductor status. */
  fablePaused: 'Fable tạm ngừng',
  groupRouter: 'router',
  total: 'tổng',
  spawned: (n: number) => `${n} subagent đã giao trong mục tiêu này`,
  delegations: 'Việc giao subagent',
  delegationState: { pending: 'chờ giao', running: 'đang chạy', done: 'xong', failed: 'lỗi, chưa giao lại' } as Record<'pending' | 'running' | 'done' | 'failed', string>,
  log: 'Nhật ký điều phối',
  main: 'chính',
  estimatedNote: '~ ước tính lúc giao, chưa có số đo',
  skipped: ' (không áp dụng)',
  warnings: 'Cảnh báo khác',
  attention: 'Cần chú ý',
  attentionMore: (n: number) => `+${n} mục khác`,
  turnsSuffix: (n: number) => `(${n} turn)`,
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
  retryExhausted: command => `Not passing after 3 rounds: ${command}`,
  behaviorHead: n => `Mod behavior incidents: ${n} kinds`,
  behaviorLine: (kind, message, count, first, last) => `${kind} · ${message} · ${count} times · first ${first} · last ${last}`,
  retryCleared: (command, step) => `Unblocked: ${command} passed on a rerun, step ${step} restored`,
  retryPassedAt: clock => `passed at ${clock}`,
  waived: command => `waived: \`${command}\``,
  planAwaiting: 'Plan awaiting approval',
  planAwaitingShort: 'plan awaiting approval',
  skillUntried: 'Skill not trialled',
  phase: { idle: 'not started', start: 'just started', active: 'in progress', almost: 'almost done', done: 'completed' },
  allClosed: 'All steps closed',
  completedGoal: goal => `Completed: ${goal}`,
  modeLabel: 'Mode',
  noGoal: 'No goal yet. Send a prompt, or use /conductor goal with a description.',
  notRead: 'not read by the router',
  constraints: 'Constraints',
  noConstraints: 'No explicit constraints found.',
  quality: 'Quality criteria',
  noQuality: 'No specific criteria found.',
  plannedTag: '(planned)',
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
  quotaBackup: 'Backup',
  quotaBackupPushed: (branch, hash) => `pushed to ${branch}${hash ? ` (${hash.slice(0, 12)})` : ''}`,
  quotaBackupSkipped: reason => `skipped (${reason})`,
  quotaBackupError: message => `failed: ${message}`,
  quotaBackupReason: { 'no-repo': 'not a git repository', 'no-remote': 'no remote' },
  quotaContinue: 'Continue with',
  quotaContinueSoft: 'say "continue" or use /conductor resume',
  quotaPausedNow: 'Paused',
  mirrorShort: 'task list',
  taskSection: 'Progress by task',
  phaseArchived: n => `${n} ${n === 1 ? 'task' : 'tasks'} from earlier phases`,
  taskMain: 'Main work',
  taskNumber: n => `Task ${n}`,
  taskOwn: 'Delegated by Claude',
  forksMerged: n => `${n} ${n === 1 ? 'fork' : 'forks'} merged`,
  forkCost: n => `Subagent group includes ${n} ${n === 1 ? 'fork' : 'forks'}`,
  taskState: { pending: 'not delegated yet', idle: 'not started', running: 'running', done: 'done', failed: 'failed, not re-delegated', cut: 'cut by pause' },
  taskDoing: 'in progress',
  noStep: 'no step',
  taskTools: n => `${n} ${n === 1 ? 'tool' : 'tools'}`,
  taskBatches: (done, total, running) => `${done}/${total} runs done${running > 0 ? `, ${running} running` : ''}`,
  taskElapsed: ms => (ms < 60_000 ? '<1 min' : `${roundedMinutes(ms)} min`),
  taskMore: k => `+${k} ${k === 1 ? 'task' : 'tasks'}`,
  stepsClosed: (n, verified = 0, skipped = 0) => `${n} ${n === 1 ? 'step' : 'steps'} closed${closedParts([verified > 0 ? `${verified} verified` : '', skipped > 0 ? `${skipped} skipped` : ''])}`,
  stepsOpenMore: n => `+${n} open ${n === 1 ? 'step' : 'steps'}`,
  checklist: 'Checklist',
  agentChip: (done, total) => `${done}/${total} subagent done`,
  attentionFailed: n => `${n} failed ${n === 1 ? 'run' : 'runs'} not re-delegated`,
  agentsRunning: n => `${n} ${n === 1 ? 'subagent' : 'subagents'} running`,
  agentBatchChip: (running, failed) => [running > 0 ? `${running} running` : '', failed > 0 ? `${failed} failed` : ''].filter(Boolean).join(' · '),
  goalElapsed: ms => (ms < 60_000 ? '<1 min' : roundedMinutes(ms) < 60 ? `${roundedMinutes(ms)} min` : `${Math.floor(roundedMinutes(ms) / 60)} h ${roundedMinutes(ms) % 60} min`),
  runningSince: at => `since ${clockOf(at)}`,
  mirrorSource: "From Claude Code's task list (tracking only, never blocks stopping)",
  costCalls: 'calls',
  groupMain: 'main',
  groupAgent: 'subagent',
  conductorRole: 'conductor',
  conductorOn: 'Conductor: fable/medium, conducting',
  conductorPaused: (fallback: string) => `Conductor: Fable paused, router on ${fallback}`,
  conductorOff: (reason: string) => `Conductor: off (${reason})`,
  conductExempt: (reason: 'solo' | 'agent') => `exempt (${reason === 'solo' ? 'solo command' : 'Agent call refused'})`,
  conductCounts: { deniedWrites: 'edits refused', deniedChecks: 'checks refused', selfWrites: 'own edits', selfChecks: 'own checks', reads: 'reads' },
  conductorReason: {
    option: 'conductor option is off',
    mode: 'routing mode is not auto',
    headless: 'non-interactive session',
    blocked: 'fable family blocked after no response',
    paused: 'Fable router paused',
    session: 'sessionModel keeps the session model',
    small: 'the current goal is not large',
    none: 'no prompt read yet',
  } as Record<string, string>,
  fablePaused: 'Fable paused',
  groupRouter: 'router',
  total: 'total',
  spawned: n => `${n} subagents spawned in this goal`,
  delegations: 'Delegated tasks',
  delegationState: { pending: 'not delegated yet', running: 'running', done: 'done', failed: 'failed, not re-delegated' },
  log: 'Routing log',
  main: 'main',
  estimatedNote: '~ estimated at delegation, not measured yet',
  skipped: ' (not applied)',
  warnings: 'Other warnings',
  attention: 'Needs attention',
  attentionMore: n => `+${n} more`,
  turnsSuffix: n => `(${n} turns)`,
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

/** Dòng cảnh báo đã lưu khi vẽ (0.8.0 A5): câu hiển thị, kèm số turn khi nhiều turn liên tiếp cùng nguyên nhân gộp vào một dòng. */
export function shownEntry(w: { text: string; turns?: number }, lang: Lang): string {
  const text = shownWarning(w.text, lang)
  return w.turns !== undefined && w.turns > 1 ? `${text} ${labels(lang).turnsSuffix(w.turns)}` : text
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
export function taskLabel(l: typeof VI, row: { kind: 'main' | 'direct' | 'agent'; index?: number; title: string; fork?: { task: number; part?: string; merged?: number } }): string {
  // Phiên con của việc tách (0.7.9 F1): "Việc 3a: <phần>", hay một dòng "Việc 3: k phiên con đã gom" khi đã gom.
  if (row.fork !== undefined) return row.fork.merged !== undefined ? `${l.taskNumber(row.fork.task)}: ${l.forksMerged(row.fork.merged)}` : `${l.taskNumber(row.fork.task)}${row.fork.part ?? ''}: ${row.title}`
  if (row.index !== undefined && hasTitleCode(row.title)) return row.title
  const head = row.kind === 'main' ? l.taskMain : row.index !== undefined ? l.taskNumber(row.index) : l.taskOwn
  return `${head}: ${row.title}`
}

/**
 * Phần nối sau dòng Điều phối của /conductor status khi luồng chính đang điều phối (0.8.6): trạng thái miễn kèm lý do, rồi số đo của mục
 * tiêu (số bằng 0 bỏ khỏi dòng). Pane và band không dùng phần này.
 */
export function conductStatusSuffix(state: { solo: boolean; agentDenied: boolean; deniedWrites: number; deniedChecks: number; selfWrites: number; selfChecks: number; reads: number }, lang: Lang): string {
  const l = labels(lang)
  const exempt = state.solo ? l.conductExempt('solo') : state.agentDenied ? l.conductExempt('agent') : ''
  const keys = ['deniedWrites', 'deniedChecks', 'selfWrites', 'selfChecks', 'reads'] as const
  const counts = keys.filter(key => state[key] > 0).map(key => `${l.conductCounts[key]} ${state[key]}`)
  const parts = [exempt, ...counts].filter(Boolean)
  return parts.length > 0 ? `; ${parts.join(', ')}` : ''
}

/** Dòng Điều phối của pane và /conductor status (0.8.4 C8), theo trạng thái điều phối trong Core. */
export function conductorLine(core: Parameters<typeof conductorShown>[0], fallback: string, lang: Lang): string {
  const l = labels(lang)
  const shown = conductorShown(core)
  if (shown.state === 'on') return l.conductorOn
  if (shown.state === 'paused') return l.conductorPaused(fallback)
  return l.conductorOff(l.conductorReason[shown.reason] ?? shown.reason)
}
