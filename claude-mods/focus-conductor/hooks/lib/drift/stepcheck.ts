// Bằng chứng theo từng bước (0.9.0 B10): lệnh ghi ở trường check của một bước là lệnh kiểm của riêng bước đó. Hàm thuần: đọc lệnh của
// bước, ghi một lần chạy Bash thành bản ghi gọn, và xét bản ghi nào là bằng chứng cho bước nào. Hook ở parts/consistency.ts áp chúng.

import type { PlanStep } from '../../../types'
import { classifyBash } from './classify'
import { isSelfFixing } from './verify'
import { outputFailed, ranNothing, summaryFailed, customFailedOf } from './output'
import { normalizePath } from './scope'

/** Lệnh của bước và kết quả mong đợi (tùy chọn). */
export type StepCheck = { command: string; expected?: string }

/**
 * Lệnh của bước (0.9.0 B10): chuỗi trong cặp backtick đầu tiên; không có backtick thì phần trước " => "; không có cả hai thì cả chuỗi. Kết
 * quả mong đợi: phần sau " => " (sau backtick đóng nếu có). Chuỗi rỗng hay vắng thì null.
 */
export function stepCheckOf(check: string | undefined): StepCheck | null {
  const text = (check ?? '').trim()
  if (text === '') return null
  const arrow = text.indexOf(' => ')
  const quoted = /`([^`]+)`/.exec(text)
  const command = (quoted !== null ? (quoted[1] ?? '') : arrow >= 0 ? text.slice(0, arrow) : text).trim()
  if (command === '') return null
  const after = quoted !== null ? text.slice((quoted.index ?? 0) + quoted[0].length) : text
  const at = after.indexOf(' => ')
  const expected = at >= 0 ? after.slice(at + 4).trim() : ''
  return expected !== '' ? { command, expected } : { command }
}

/** Danh tính để so một lần chạy với lệnh của bước: gộp khoảng trắng. */
export function runKey(command: string): string {
  return command.replace(/\s+/g, ' ').trim()
}

/** Một lần chạy Bash đã ghi gọn: các danh tính (cả lệnh và từng đoạn kiểm), output đã cắt, có đạt không, mốc seq của dấu vết. */
export type StepRun = { keys: string[]; output: string; passed: boolean; seq: number }
/** Số lần chạy giữ lại cho mỗi mục tiêu, và số ký tự output giữ cho mỗi lần. */
export const STEP_RUNS = 30
export const STEP_OUTPUT_CHARS = 4000

/** Thư mục tạm: tác động ghi mức definite dưới các thư mục này không làm lần chạy mất tư cách bằng chứng. */
const TEMP_DIRS = ['/tmp/', '/private/tmp/', '/var/folders/']

/**
 * Một lần chạy Bash có thể là bằng chứng (0.9.0 B10): không lỗi, output không rỗng, không có dấu hiệu lỗi hay dấu hiệu không kiểm gì, lệnh
 * không tự sửa file (--fix, --write...) và không có tác động ghi mức definite ngoài thư mục tạm.
 */
export function stepRunOf(command: string, isError: boolean, output: string | undefined, seq: number): StepRun {
  const text = output ?? ''
  const classified = classifyBash(command)
  const isSelfFix = isSelfFixing(command.split(/\s+/))
  const isHardWrite = classified.effects.some(
    effect => effect.kind === 'write' && effect.level === 'definite' && (effect.isUnknown || effect.paths.length === 0 || effect.paths.some(path => !TEMP_DIRS.some(dir => normalizePath(path).startsWith(dir)))),
  )
  const failed = outputFailed(text) || summaryFailed(text) || customFailedOf(text) || ranNothing(text)
  // Đoạn lệnh kiểm bị che mã thoát hay output (cmd; echo, cmd || true, cmd &) không là bằng chứng cho bước (vòng sửa sau kiểm độc lập).
  const segments = classified.effects.flatMap(effect => (effect.kind === 'check' && effect.exit !== 'hidden' ? [runKey(effect.segment)] : []))
  return {
    keys: [...new Set([runKey(command), ...segments])],
    output: text.slice(0, STEP_OUTPUT_CHARS),
    passed: !isError && text.trim() !== '' && !failed && !isSelfFix && !isHardWrite,
    seq,
  }
}

/**
 * Lần chạy là bằng chứng cho bước (0.9.0 B10): lần chạy mới nhất khớp lệnh của bước phải đạt, chạy sau thay đổi không nhẹ cuối cùng
 * (`lastHard`) và sau lần check của bước được lưu hay đổi (`checkSeq`), và output chứa kết quả mong đợi khi có. Trả lần chạy đó, không thì null.
 */
export function stepEvidence(step: Pick<PlanStep, 'check'>, runs: readonly StepRun[], lastHard: number, checkSeq: number): StepRun | null {
  const check = stepCheckOf(step.check)
  if (check === null) return null
  const key = runKey(check.command)
  const last = [...runs].reverse().find(run => run.keys.includes(key))
  if (last === undefined || !last.passed || last.seq <= lastHard || last.seq <= checkSeq) return null
  if (check.expected !== undefined && !hasExpected(last.output, check.expected)) return null
  return last
}

/** Output chứa kết quả mong đợi đứng riêng (vòng sửa sau kiểm độc lập): trước và sau không phải chữ hay số, nên "1" không khớp "10". */
function hasExpected(output: string, expected: string): boolean {
  const escaped = expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, 'u').test(output)
}

/** Lần chạy khớp lệnh của một bước trong checklist (0.9.0 B10): để bỏ câu "không xác định được file đích" cho lần chạy đó. */
export function matchesStepCheck(command: string, plan: readonly Pick<PlanStep, 'check'>[]): boolean {
  const key = runKey(command)
  return plan.some(step => {
    const check = stepCheckOf(step.check)
    return check !== null && runKey(check.command) === key
  })
}
