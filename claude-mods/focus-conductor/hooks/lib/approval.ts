// Duyệt kế hoạch trước khi sửa file (0.8.2 N2): ai thuộc diện duyệt, tool nào bị chặn khi chưa duyệt, và các câu mod chèn cho Claude.
// Thuần: không gọi $; hook ở parts/session.ts (prompt.submit, tool.call, classic.PostToolUse), parts/consistency.ts (rà ở Stop) và
// parts/command.ts (/conductor approve) áp chúng.

import type { PluginOptions } from 'claude-code'
import type { Brief, PlanStep } from '../../types'
import { classifyBash, filePathOf, isSkillPath, openSteps } from './drift'
import { isSidePath, normalizePath } from './drift/scope'
import type { SideLists } from './drift/scope'
import { backupTokens } from './quota'
import type { PlanReview } from './router'

/** Số lượt rà kế hoạch mặc định và khoảng kẹp của option planReviewRounds (0.8.2 N2). */
export const REVIEW_ROUNDS = 2
export const REVIEW_ROUNDS_MIN = 1
export const REVIEW_ROUNDS_MAX = 3

/** Option planApproval: off là tắt, mọi giá trị khác (kể cả vắng) là auto. */
export function approvalModeOf(options: PluginOptions): 'auto' | 'off' {
  return options['planApproval'] === 'off' ? 'off' : 'auto'
}

/** Option planReviewRounds: số nguyên kẹp từ 1 đến 3; vắng hay sai là 2. */
export function reviewRoundsOf(options: PluginOptions): number {
  const raw = Number(options['planReviewRounds'])
  if (options['planReviewRounds'] === undefined || options['planReviewRounds'] === '' || !Number.isFinite(raw)) return REVIEW_ROUNDS
  return Math.min(REVIEW_ROUNDS_MAX, Math.max(REVIEW_ROUNDS_MIN, Math.round(raw)))
}

/**
 * Mục tiêu thuộc diện duyệt kế hoạch: planApproval auto, độ sâu substantial hay hard, loại edit hay mixed, không phải đối chiếu, không
 * phải mục tiêu tối thiểu, router không đặt skipApproval.
 */
export function needsApproval(brief: Brief, mode: 'auto' | 'off', skipApproval: boolean): boolean {
  return mode === 'auto' && (brief.depth === 'substantial' || brief.depth === 'hard') && (brief.kind === 'edit' || brief.kind === 'mixed') && !brief.isReference && brief.isBare !== true && !skipApproval
}

/** Đích được ghi khi chưa duyệt: file kế hoạch của plan mode (.claude/plans/) và thư mục riêng của mod (.focus-conductor/). */
const EXEMPT = /(?:^|[\\/])(?:\.claude[\\/]plans|\.focus-conductor)[\\/]/

/** Đích được miễn so sau khi gộp . và .. (0.8.3 R2): đích còn bắt đầu bằng .. sau khi gộp thì không được miễn. */
export function isExemptPath(path: string): boolean {
  const normalized = normalizePath(path)
  return !normalized.startsWith('..') && EXEMPT.test(normalized)
}

/** Nhóm và hành động chỉ đọc của gh được qua khi chưa duyệt (0.8.3 R4). */
const GH_READ_GROUPS = new Set(['pr', 'issue', 'run', 'repo', 'release', 'workflow'])
const GH_READ_ACTIONS = new Set(['view', 'list', 'diff', 'checks', 'status'])
/** Cờ làm gh api ghi (đổi method hay gửi trường, tệp): có một trong các cờ này thì không phải lệnh tra cứu. */
const GH_API_WRITE_FLAGS = ['-X', '--method', '-f', '-F', '--field', '--raw-field', '--input']
/** Thư mục tạm: lệnh chỉ ghi dưới các thư mục này được qua khi chưa duyệt (0.8.3 R4). */
const TEMP_DIRS = ['/tmp/', '/private/tmp/', '/var/folders/']

function isTempPath(path: string): boolean {
  const normalized = normalizePath(path)
  return TEMP_DIRS.some(dir => normalized.startsWith(dir))
}

function isGhRead(tokens: readonly string[]): boolean {
  const [, group, action] = tokens
  if (group === 'api') {
    const args = tokens.slice(2)
    return args.some(arg => !arg.startsWith('-')) && !args.some(arg => GH_API_WRITE_FLAGS.some(flag => arg === flag || arg.startsWith(flag.startsWith('--') ? `${flag}=` : flag)))
  }
  return group !== undefined && action !== undefined && GH_READ_GROUPS.has(group) && GH_READ_ACTIONS.has(action)
}

/**
 * Lệnh Bash an toàn khi đang lập kế hoạch (0.8.3 R4): lệnh tra cứu gh chỉ đọc (`gh pr|issue|run|repo|release|workflow
 * view|list|diff|checks|status`, `gh api <đường dẫn>` không có cờ ghi), tách token bằng bộ tách chặt của sao lưu nên không có ký tự shell
 * đặc biệt ngoài nháy; hay lệnh mà mọi tác động ghi `classifyBash` đọc được đều có đích rõ dưới /tmp/, /private/tmp/, /var/folders/.
 * Chỉ dùng cho cổng duyệt; tracker, Y6, W4 và sổ file đã đổi giữ nguyên cách đọc lệnh.
 */
export function isPlanningSafeBash(command: string): boolean {
  const tokens = backupTokens(command.trim())
  if (tokens !== null && tokens[0] === 'gh') return isGhRead(tokens)
  const writes = classifyBash(command).effects.filter(effect => effect.kind === 'write' && effect.isHistory !== true)
  return writes.length > 0 && writes.every(effect => effect.kind === 'write' && !effect.isUnknown && effect.paths.length > 0 && effect.paths.every(isTempPath))
}

/** Tool sửa file bị chặn khi chưa duyệt. */
const EDITORS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
/** Subagent chỉ đọc được giao khi chưa duyệt. */
const READ_ONLY_AGENTS = new Set(['Explore', 'Plan'])

/** Trần lý do từ chối (0.8.2 N2). */
export const DENY_CHARS = 200

const DENY_EDIT = '[focus-conductor] Kế hoạch chưa được duyệt: chưa sửa file. Lập checklist bằng tool plan, trình kế hoạch rồi kết thúc turn để người dùng duyệt.'
const DENY_AGENT = '[focus-conductor] Kế hoạch chưa được duyệt: chỉ giao subagent Explore hay Plan. Trình kế hoạch rồi kết thúc turn để người dùng duyệt.'

/**
 * Lý do từ chối một tool của luồng chính khi kế hoạch chưa được duyệt, hoặc null khi tool được qua. Edit, Write, NotebookEdit và lệnh
 * Bash có ghi file bị từ chối, trừ khi mọi đích đọc được và đều dưới thư mục được miễn; Agent chỉ qua với subagent_type Explore hay Plan.
 * Read, Grep, Glob, tool plan của mod và các tool chỉ đọc khác luôn qua.
 */
/** Tệp trạng thái của mục tiêu (0.9.0 B3) kèm thư mục gốc và thư mục làm việc để neo đường dẫn tương đối. */
export type StateFrame = { lists: SideLists | null; root?: string | null; cwd?: string | null }

export function approvalDenial(tool: string, input: Record<string, unknown>, frame: StateFrame | null = null): string | null {
  // Tệp trạng thái của lượt (0.9.0 B3) ghi được khi chưa duyệt, như thư mục được miễn; nơi ghi phụ thì không.
  const allowed = (path: string) => isExemptPath(path) || (frame !== null && isSidePath(path, frame.lists, frame.root, frame.cwd, 'state'))
  if (EDITORS.has(tool)) {
    const path = filePathOf({ tool, input, isError: false, isReadOnly: false })
    return path !== '' && allowed(path) ? null : DENY_EDIT
  }
  if (tool === 'Bash') {
    if (typeof input['command'] === 'string' && isPlanningSafeBash(input['command'])) return null
    const writes = classifyBash(typeof input['command'] === 'string' ? input['command'] : '').effects.filter(effect => effect.kind === 'write' && effect.isHistory !== true)
    if (writes.length === 0) return null
    const isExempt = writes.every(effect => effect.kind === 'write' && !effect.isUnknown && effect.paths.length > 0 && effect.paths.every(allowed))
    return isExempt ? null : DENY_EDIT
  }
  if (tool === 'Agent') return READ_ONLY_AGENTS.has(String(input['subagent_type'] ?? '')) ? null : DENY_AGENT
  return null
}

/** Hạn mức thêm của đoạn dặn lập kế hoạch (0.9.0): B3 nêu tệp trạng thái, B6 nêu bước thử skill, B10 nêu dạng check của bước. */
export const PLANNING_STATE_CHARS = 120
export const PLANNING_SKILL_CHARS = 120
export const PLANNING_CHECK_CHARS = 160
/** Trần đoạn dặn lập kế hoạch (0.8.2 N2; 0.9.0 cộng ba hạn mức trên). */
export const PLANNING_CHARS = 600 + PLANNING_STATE_CHARS + PLANNING_SKILL_CHARS + PLANNING_CHECK_CHARS

/** Câu nêu tệp trạng thái ghi được khi chưa duyệt (0.9.0 B3): tên tệp, nối dấu phẩy, không quá PLANNING_STATE_CHARS ký tự; rỗng khi không có. */
export function planningStateLine(stateFiles: readonly string[] | undefined): string {
  const names = [...new Set((stateFiles ?? []).map(path => path.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() ?? '').filter(Boolean))]
  if (names.length === 0) return ''
  const build = (n: number) => ` Được ghi tệp trạng thái: ${names.slice(0, n).join(', ')}${n < names.length ? ', ...' : ''}.`
  let n = names.length
  while (n > 1 && build(n).length > PLANNING_STATE_CHARS) n -= 1
  return build(n).slice(0, PLANNING_STATE_CHARS)
}

/** Vế dặn bước thử skill (0.9.0 B6), không quá PLANNING_SKILL_CHARS ký tự: chỉ khi phạm vi của mục tiêu chạm file skill. */
export const PLANNING_SKILL_LINE = ' Phạm vi chạm file skill: checklist cần một bước thử skill, giao Agent có description mở đầu "Thử skill: ".'

/**
 * Dạng check của bước (0.9.0 B10): vế của đoạn dặn lập kế hoạch và dòng kèm kết quả plan set (một lần mỗi mục tiêu); tổng hai câu không quá
 * PLANNING_CHECK_CHARS ký tự mỗi mục tiêu.
 */
export const PLANNING_CHECK_LINE = ' Check của bước ghi dạng `lệnh` => kết quả mong đợi để mod tự đối chiếu lần chạy.'
export const PLAN_SET_CHECK_LINE = '[focus-conductor] Check dạng `lệnh` => kết quả được mod đối chiếu với lần chạy.'

/** Đoạn dặn lập kế hoạch khi mục tiêu đang planning và không còn câu hỏi chờ; brief có tệp trạng thái (0.9.0 B3) hay phạm vi chạm file skill (B6) thì nêu thêm. */
export function planningContext(brief: Pick<Brief, 'stateFiles' | 'scopePaths'> | null = null): string {
  return (
    '[focus-conductor] Việc lớn: lập kế hoạch và chờ duyệt trước khi sửa file. Lập checklist bằng tool plan (action set), mỗi bước có check; ' +
    'đối chiếu đủ mọi yêu cầu của mục tiêu và nêu rõ phần nào không làm. Chưa sửa file: Edit, Write và lệnh ghi file bị từ chối tới khi ' +
    'người dùng duyệt (chỉ ghi được dưới .claude/plans/).' +
    planningStateLine(brief?.stateFiles) +
    ((brief?.scopePaths ?? []).some(isSkillPath) ? PLANNING_SKILL_LINE : '') +
    PLANNING_CHECK_LINE +
    ' Kết thúc turn bằng bản kế hoạch để người dùng duyệt.'
  )
}

/** Khối dặn hỏi làm rõ một lần (0.8.2 N2): các câu router trả, hỏi gộp bằng AskUserQuestion rồi dừng turn. */
export function askContext(questions: readonly string[]): string {
  return [
    '[focus-conductor] Việc lớn có chỗ chưa rõ làm đổi kết quả. Hỏi người dùng MỘT lần bằng tool AskUserQuestion, gộp các câu dưới đây, rồi dừng turn; chưa lập kế hoạch, chưa sửa file.',
    ...questions.map((q, i) => `${i + 1}. ${q}`),
  ].join('\n')
}

/** Dòng báo kế hoạch đã duyệt (0.8.2 N2). */
export function approvedContext(plan: readonly PlanStep[]): string {
  const next = openSteps(plan)[0]
  return `[focus-conductor] Kế hoạch đã duyệt, thực thi theo checklist${next !== undefined ? ` từ bước ${next.id}` : ''}.`
}

/** Trần lý do chặn của lượt rà kế hoạch (0.8.2 N2). */
export const REVIEW_CHARS = 1000

function clipTo(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

/**
 * Lý do chặn Stop sau một lượt rà còn chỗ cần sửa: yêu cầu chưa bước nào phủ, bước ngoài yêu cầu, vấn đề router nêu. `isFinal` là lượt
 * rà cuối: dặn ghi các chỗ còn sót vào bản trình. Tối đa REVIEW_CHARS ký tự.
 */
export function reviewReason(review: PlanReview, requirements: readonly string[], steps: readonly PlanStep[], round: number, max: number, isFinal: boolean): string {
  const head = `[focus-conductor] Rà kế hoạch lượt ${round}/${max}: còn chỗ cần sửa trước khi trình duyệt.`
  const parts: string[] = []
  const missing = review.missing.map(n => `${n}. ${clipTo(requirements[n - 1] ?? '', 80)}`.trim())
  if (missing.length > 0) parts.push(`Yêu cầu chưa bước nào phủ: ${missing.join('; ')}.`)
  const extra = review.extra.map(n => `${n}. ${clipTo(steps[n - 1]?.title ?? '', 80)}`.trim())
  if (extra.length > 0) parts.push(`Bước ngoài yêu cầu: ${extra.join('; ')}.`)
  if (review.issues.length > 0) parts.push(`Vấn đề: ${review.issues.join('; ')}.`)
  const tail = isFinal
    ? 'Đây là lượt rà cuối: sửa checklist nếu kịp, rồi ghi các chỗ còn sót này vào bản trình kế hoạch để người dùng thấy, và kết thúc turn.'
    : 'Sửa checklist bằng tool plan (thêm bước phủ yêu cầu, bỏ hay ghi rõ bước ngoài yêu cầu), rồi kết thúc turn bằng bản kế hoạch.'
  const body = clipTo(parts.join(' '), REVIEW_CHARS - head.length - tail.length - 2)
  return [head, body, tail].filter(Boolean).join(' ')
}

/** Có chỗ cần sửa sau lượt rà. */
export function hasFixes(review: PlanReview): boolean {
  return review.missing.length > 0 || review.extra.length > 0 || review.issues.length > 0
}
