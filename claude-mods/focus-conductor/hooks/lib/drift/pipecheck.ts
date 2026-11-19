// Lệnh kiểm chạy qua ống che mã thoát (sau phiên thật D4, mục 2): luật không nhận bằng chứng giữ nguyên, mod chỉ nhận ra để nhắc.

import { classifyBash } from './classify'
import { runKey } from './stepcheck'

/** Có `set -o pipefail` (hay `-o pipefail` trong cờ của set) trước đó trong lệnh. */
const PIPEFAIL = /(?:^|[\s;&(])set\s+-[a-zA-Z]*o\s+pipefail\b/

/**
 * Phần tầng shell ngoài cùng của lệnh (kiểm độc lập vòng 2 lỗi 2): bỏ dần các nhóm `( ... )`, `$( ... )`, `{ ... }`, backtick trong cùng;
 * còn ngoặc lẻ (đọc không trọn) thì chuỗi rỗng, nên `set -o pipefail` trong nhóm không làm mất dòng nhắc đi qua ống.
 */
function topLevel(command: string): string {
  let text = command
  for (let round = 0; round < 50; round++) {
    const next = text.replace(/\$?\([^()]*\)/g, ' ').replace(/\{[^{}]*\}/g, ' ').replace(/`[^`]*`/g, ' ')
    if (next === text) break
    text = next
  }
  return /[()`]/.test(text) ? '' : text
}

/** Ngay sau `text` trong `command` là một ống (không phải `||`). */
function isPipedAt(command: string, text: string): boolean {
  let at = command.indexOf(text)
  while (at >= 0) {
    // Chuyển hướng như `2>&1` đứng giữa lệnh và ống vẫn là ống (vòng 2 M10).
    if (/^(?:\s*\d*>&\d+)*\s*\|(?!\|)/.test(command.slice(at + text.length))) return true
    at = command.indexOf(text, at + 1)
  }
  return false
}

/**
 * Lệnh kiểm mod nhận ra (trình test, lệnh trong checkCommands) hay trùng lệnh ở check của một bước, đi qua ống vào lệnh lọc mà không có
 * pipefail: trả lệnh đó, không thì null.
 */
export function pipedCheck(command: string, cwd: string | undefined, stepChecks: readonly string[]): string | null {
  if (!command.includes('|') || PIPEFAIL.test(topLevel(command))) return null
  for (const effect of classifyBash(command, cwd).effects) {
    if (effect.kind !== 'check' || effect.pipefail === true) continue
    if ((effect.exit === 'filtered' || effect.exit === 'hidden') && isPipedAt(command, effect.segment)) return effect.segment
  }
  for (const check of stepChecks) {
    const key = runKey(check)
    if (key !== '' && isPipedAt(command, check)) return check
  }
  return null
}
