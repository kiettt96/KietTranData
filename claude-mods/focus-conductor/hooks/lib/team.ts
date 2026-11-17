// Đội hình theo cỡ việc do mod áp (0.9.0 C, thay C3 của router): router chỉ đọc prompt; mod quyết khi nào bật các bước đóng (kiểm, duyệt,
// sẵn sàng), chèn một đoạn dặn một lần mỗi mục tiêu và tính trạng thái từng bước đóng cho pane và cổng đóng mục tiêu. Hàm thuần.

import type { Brief, ClosingStep, PlanStep } from '../../types'
import { isSoftPath } from './drift/soft'
import { stepCheckOf } from './drift/stepcheck'
import { hasDeclaredCheckFor } from './drift/verify'
import type { EvidenceLog } from './drift/evidence'

/** Số file không nhẹ khác nhau được sửa thì bật đội hình dù router chấm độ sâu thấp (0.9.0 C1). Đặt một chỗ, ghi trong DESIGN. */
export const TEAM_FILES = 3
/** Trần ký tự của đoạn dặn bước đóng (0.9.0 C2). */
export const CLOSING_NOTE_CHARS = 300

/** Số file không nhẹ khác nhau trong sổ thay đổi (sổ đã bỏ tệp trạng thái và nơi ghi phụ của B1); tài liệu, ghi chú là nhẹ. */
export function hardFileCount(paths: readonly string[]): number {
  return new Set(paths.filter(path => !isSoftPath(path))).size
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
export type ClosingVerdict = { verdict: 'pass' | 'fail' | 'ready' | 'not-ready' | null; isClean: boolean; seq: number }

/**
 * Trạng thái các bước đóng (0.9.0 C3): kiểm (khi có lệnh kiểm biết được), duyệt, và sẵn sàng với mục tiêu hard. Kiểm đạt khi có lần kiểm
 * đạt sau thay đổi không nhẹ cuối; duyệt đạt khi có kết luận đạt của subagent không ghi file sau thay đổi đó, chưa đạt khi kết luận gần
 * nhất là chưa đạt; sẵn sàng tương tự, sau lần duyệt đạt.
 */
export function closingSteps(opts: { hasCheck: boolean; isHard: boolean; checked: boolean; checkFailed: boolean; lastHard: number; verdicts: readonly ClosingVerdict[] }): ClosingStep[] {
  const fresh = opts.verdicts.filter(v => v.isClean && v.seq > opts.lastHard)
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
