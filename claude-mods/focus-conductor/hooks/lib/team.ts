// Đội hình theo cỡ việc do mod áp (0.9.0 C, thay C3 của router): router chỉ đọc prompt; mod quyết khi nào bật các bước đóng (kiểm, duyệt,
// sẵn sàng), chèn một đoạn dặn một lần mỗi mục tiêu và tính trạng thái từng bước đóng cho pane và cổng đóng mục tiêu. Hàm thuần.

import type { Brief, ClosingStep, PlanStep } from '../../types'
import { isSoftPath } from './drift/soft'
import { stepCheckOf } from './drift/stepcheck'
import { hasDeclaredCheckFor, isSelfFixing } from './drift/verify'
import { classifyBash } from './drift/classify'
import { isRoleTemp } from './drift/scope'
import type { EvidenceLog } from './drift/evidence'

/** Số file không nhẹ khác nhau được sửa thì bật đội hình dù router chấm độ sâu thấp (0.9.0 C1). Đặt một chỗ, ghi trong DESIGN. */
export const TEAM_FILES = 3
/** Trần ký tự của đoạn dặn bước đóng (0.9.0 C2). */
export const CLOSING_NOTE_CHARS = 300

/** Số file không nhẹ khác nhau trong sổ thay đổi (sổ đã bỏ tệp trạng thái và nơi ghi phụ của B1); tài liệu, ghi chú là nhẹ. */
export function hardFileCount(paths: readonly string[]): number {
  return new Set(paths.filter(path => !isSoftPath(path) && !isRoleTemp(path))).size
}

/** Lệnh đã biết là ghi file dù bộ phân loại chỉ xếp mức possible (0.9.0 vòng sửa sau kiểm độc lập). */
const KNOWN_WRITERS: readonly RegExp[] = [
  /\b(?:curl|wget)\b[^;&|]*\s(?:-o|-O|--output(?:-document)?)(?:\s|=)/,
  /\bperl\b[^;&|]*\s-[a-zA-Z]*i/,
  /\bfind\b[^;&|]*\s-(?:delete|exec|execdir)\b/,
  /(?:^|[;&|(]\s*|\s)patch\b/,
  /\b(?:node|deno|bun)\s+(?:-e|--eval|-p|--print)\b/,
  /\b(?:python3?|python2)\s+-c\b/,
  /\bruby\s+-e\b/,
  /(?:^|[;&|(]\s*)(?:dd|truncate)\s/,
]

/**
 * Lệnh Bash ghi file ngoài thư mục tạm (0.9.0 C2, D1, vòng sửa sau kiểm độc lập): tác động ghi mức definite ngoài thư mục tạm hay đích chưa
 * xác định, thao tác git trên lịch sử (commit, push, tag...), hay lệnh ghi mức possible mà đã biết là sửa file (--fix, --write, curl -o,
 * perl -pi, find -delete, patch, node -e, python -c). Chạy script (bash x.sh, bash -c) không tính.
 */
export function isBashWrite(command: string, cwd: string | null = null): boolean {
  const effects = classifyBash(command, cwd ?? undefined).effects
  const isDefinite = effects.some(effect => effect.kind === 'write' && effect.level === 'definite' && (effect.isHistory === true || effect.isUnknown || effect.paths.length === 0 || effect.paths.some(path => !isRoleTemp(path))))
  if (isDefinite) return true
  if (!effects.some(effect => effect.kind === 'write' && effect.level === 'possible')) return false
  return isSelfFixing(command.split(/\s+/)) || KNOWN_WRITERS.some(re => re.test(command))
}

/**
 * Điều kiện bật đội hình (0.9.0 C1): option closingReview là auto, mục tiêu loại edit hay mixed, không phải prompt đối chiếu; và router chấm
 * substantial hay hard, hoặc đã có từ TEAM_FILES file không nhẹ khác nhau được sửa. Trả lý do bật hay null.
 */
export function teamCause(closingReview: unknown, brief: Brief | null, changedPaths: readonly string[]): 'depth' | 'files' | null {
  if (brief === null || closingReview === 'off' || brief.isReference) return null
  if (brief.kind !== 'edit' && brief.kind !== 'mixed') return null
  if (brief.depth === 'substantial' || brief.depth === 'hard') return 'depth'
  return hardFileCount(changedPaths) >= TEAM_FILES ? 'files' : null
}

/** Mục tiêu chỉ sửa tài liệu: phạm vi router đọc được, hay sổ thay đổi khi chưa có phạm vi, đều là đường dẫn nhẹ (và không rỗng). */
export function isDocsOnly(brief: Brief, changedPaths: readonly string[]): boolean {
  const paths = brief.scopePaths.length > 0 ? brief.scopePaths : changedPaths
  return paths.length > 0 && paths.every(isSoftPath)
}

/**
 * Có lệnh kiểm biết được (0.9.0 C2): check của một bước có lệnh (trong backtick hay trước " => "), lệnh khai trong checkCommands phủ file
 * đã sửa, hay một lần chạy trình test mod nhận ra trong dấu vết của mục tiêu.
 */
export function hasKnownCheck(plan: readonly PlanStep[], changedPaths: readonly string[], log: EvidenceLog | null): boolean {
  if (plan.some(step => /`[^`]+`| => /.test(step.check ?? '') && stepCheckOf(step.check) !== null)) return true
  if (hasDeclaredCheckFor(changedPaths)) return true
  return log !== null && log.commands.some(c => c.check === 'test')
}

/** Đoạn dặn bước đóng (0.9.0 C2), không quá CLOSING_NOTE_CHARS ký tự: thứ tự, tiền tố phải dùng, các từ kết luận. */
export function closingNote(opts: { hasCheck: boolean; isHard: boolean; isDocs: boolean }): string {
  const steps = [
    ...(opts.hasCheck ? ['Agent "Kiểm: <lệnh>" chạy lệnh kiểm'] : []),
    `"Duyệt: <phạm vi>" rà độc lập, không sửa file${opts.isDocs ? ', gồm đối chiếu số liệu, mẫu, chính tả' : ''}`,
    ...(opts.isHard ? ['"Sẵn sàng: <mục tiêu>" đánh giá sẵn sàng'] : []),
  ]
  const words = opts.isHard ? 'ĐẠT hay CHƯA ĐẠT; SẴN SÀNG hay CHƯA SẴN SÀNG' : 'ĐẠT hay CHƯA ĐẠT'
  return `[focus-conductor] Trước khi kết thúc, theo thứ tự: ${steps.join('; rồi ')}. Câu trả lời mở đầu bằng ${words}.`.slice(0, CLOSING_NOTE_CHARS)
}

/** Một kết luận đã nhận, đủ để tính trạng thái bước đóng. */
/** isReview: kết luận được tính cho bước duyệt và sẵn sàng (0.9.0 C6): không phải lượt kiểm, không phải từ của bước kiểm, model từ sonnet. */
export type ClosingVerdict = { verdict: 'pass' | 'fail' | 'ready' | 'not-ready' | null; isClean: boolean; isReview: boolean; seq: number }

/**
 * Trạng thái các bước đóng (0.9.0 C3): kiểm (khi có lệnh kiểm biết được), duyệt, và sẵn sàng với mục tiêu hard. Kiểm đạt khi có lần kiểm
 * đạt sau thay đổi không nhẹ cuối; duyệt đạt khi có kết luận đạt của subagent không ghi file sau thay đổi đó, chưa đạt khi kết luận gần
 * nhất là chưa đạt; sẵn sàng tương tự, sau lần duyệt đạt.
 */
export function closingSteps(opts: { hasCheck: boolean; isHard: boolean; checked: boolean; checkFailed: boolean; lastHard: number; verdicts: readonly ClosingVerdict[] }): ClosingStep[] {
  const fresh = opts.verdicts.filter(v => v.isClean && v.isReview && v.seq > opts.lastHard)
  const reviews = fresh.filter(v => v.verdict === 'pass' || v.verdict === 'fail')
  const lastReview = reviews[reviews.length - 1]
  const reviewSeq = reviews.filter(v => v.verdict === 'pass').reduce((max, v) => Math.max(max, v.seq), -1)
  const readies = fresh.filter(v => (v.verdict === 'ready' || v.verdict === 'not-ready') && v.seq >= reviewSeq)
  const lastReady = readies[readies.length - 1]
  const steps: ClosingStep[] = []
  if (opts.hasCheck) steps.push({ name: 'check', state: opts.checked ? 'pass' : opts.checkFailed ? 'fail' : 'wait' })
  steps.push({ name: 'review', state: lastReview?.verdict === 'pass' ? 'pass' : lastReview?.verdict === 'fail' ? 'fail' : 'wait' })
  if (opts.isHard) steps.push({ name: 'design', state: reviewSeq < 0 || lastReady === undefined ? 'wait' : lastReady.verdict === 'ready' ? 'pass' : 'fail' })
  return steps
}

/**
 * Tiền tố description theo vai (0.9.0 B2), xét tiền tố dài trước, không phân biệt hoa thường. Tiền tố chỉ quyết vai và model của lời gọi;
 * kết luận của subagent được nhận theo câu trả lời, có tiền tố hay không (0.9.0 D1).
 */
export const ROLE_PREFIXES: ReadonlyArray<readonly [string, 'review' | 'audit' | 'design']> = (
  [
    ['Kiểm độc lập: ', 'review'],
    ['Independent check: ', 'review'],
    ['Duyệt: ', 'review'],
    ['Review: ', 'review'],
    ['Kiểm: ', 'audit'],
    ['Audit: ', 'audit'],
    ['Sẵn sàng: ', 'design'],
    ['Readiness: ', 'design'],
  ] as const
).slice().sort((a, b) => b[0].length - a[0].length)

/** Vai theo tiền tố description (0.9.0 B2), hay undefined. */
export function prefixRole(description: string): 'review' | 'audit' | 'design' | undefined {
  const head = description.normalize('NFC').trimStart().toLowerCase()
  return ROLE_PREFIXES.find(([prefix]) => head.startsWith(prefix.normalize('NFC').toLowerCase()))?.[1]
}
