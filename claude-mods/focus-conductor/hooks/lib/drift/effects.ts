// Hiệu ứng của một tool call: có chạy lệnh kiểm tra không, loại kiểm tra, có ghi file không.
// Chuyển nguyên văn từ hooks/lib/drift.ts (tách theo tầng, không đổi hành vi); hooks/lib/drift.ts là barrel.

import { FILE_TOOLS, filePathOf, isPlanFile, str } from './tool'
import type { ToolObservation } from './tool'
import { classifyBash } from './classify'
import type { BashClass, CheckEffect, WriteEffect } from './classify'
import type { CheckKind } from './verify'

/** Lệnh Bash có chạy một lệnh kiểm tra (theo phân loại giữ cú pháp, không tính chuỗi trong nháy). */
export function isVerification(observation: ToolObservation): boolean {
  return observation.tool === 'Bash' && classifyBash(str(observation.input['command'])).effects.some(e => e.kind === 'check')
}

/** Loại kiểm tra của một lệnh: test (chạy hành vi), static (type-check, lint, build, validate), hoặc null. */
export function checkKindOf(command: string): CheckKind | null {
  const checks = classifyBash(command).effects.filter((e): e is CheckEffect => e.kind === 'check')
  if (checks.length === 0) return null
  return checks.some(e => e.check === 'test') ? 'test' : 'static'
}

/**
 * Tool call có (hoặc có thể đã) ghi file. Bash theo phân loại chung `classifyBash`: ghi xác định (chuyển hướng, lệnh ghi
 * đã biết) luôn là thay đổi, kể cả khi engine báo chỉ đọc; ghi có thể (lệnh lạ, script) bị bỏ khi engine báo chỉ đọc.
 * Dùng chung cho kiểm tra trước khi chạy (strictDelegation block), theo dõi sau khi chạy, phạm vi và dấu vết.
 */
export function isMutation(observation: ToolObservation): boolean {
  if (FILE_TOOLS.has(observation.tool)) return !isPlanFile(filePathOf(observation))
  if (observation.tool !== 'Bash') return false
  return writeEffects(classifyBash(str(observation.input['command'])), observation.isReadOnly).length > 0
}

/**
 * Các hiệu ứng ghi còn tính được sau khi xét thông tin chỉ đọc của engine. Hiệu ứng chỉ ghi file kế hoạch
 * (`.claude/plans/*.md`, mọi đích đọc được và không có đích lạ) không phải thay đổi mã, như với Edit và Write.
 */
export function writeEffects(classified: BashClass, isReadOnly: boolean): WriteEffect[] {
  return classified.effects.filter(
    (e): e is WriteEffect =>
      e.kind === 'write' && (e.level === 'definite' || !isReadOnly) && !(e.paths.length > 0 && !e.isUnknown && e.paths.every(isPlanFile)),
  )
}
