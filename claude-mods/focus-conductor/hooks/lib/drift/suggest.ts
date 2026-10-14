// Gợi ý ví dụ cho option checkCommands (0.5.6): khi verified bị hạ vì lệnh kiểm tra không nhận ra, thông báo nêu một
// lệnh script riêng của dự án mà Claude đã chạy trong mục tiêu. Hàm thuần; không đổi cổng verified.

import type { EvidenceLog } from './evidence'

const INTERPRETER = /^(?:python3?(?:\.\d+)?|node|bun|deno|ruby|perl|bash|sh)$/
const SCRIPT_FILE = /\.(?:py|js|mjs|cjs|ts|rb|pl|sh)$/
// Tên script có vẻ là bước kiểm: đứng đầu tên hoặc sau _, -, . (kiem_tra, db-audit, verify_counts).
const CHECK_NAME = /(?:^|[_.-])(?:kiem|check|verify|validate|test|audit|reconcile)/i
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const MAX_LENGTH = 80
const MAX_SUGGESTIONS = 2

/** Từ một đoạn lệnh: trình thông dịch cộng đường dẫn script, hoặc đường dẫn script đứng đầu; không có thì null. */
function scriptCommand(segment: string): string | null {
  const tokens = segment.trim().split(/\s+/).filter(Boolean)
  while (tokens.length > 0 && ASSIGNMENT.test(tokens[0] ?? '')) tokens.shift()
  const head = tokens[0]
  if (head === undefined) return null
  if (INTERPRETER.test(head)) {
    const script = tokens.slice(1).find(token => !token.startsWith('-'))
    return script !== undefined && SCRIPT_FILE.test(script) ? `${head} ${script}` : null
  }
  return head.includes('/') && SCRIPT_FILE.test(head) ? head : null
}

function isUsable(text: string): boolean {
  return text.length <= MAX_LENGTH && !text.includes(',') && !/[\r\n]/.test(text)
}

/**
 * Tối đa hai lệnh script đã chạy thành công trong mục tiêu mà mod không nhận là lệnh kiểm tra, làm ví dụ cho checkCommands.
 * Tên khớp mẫu kiểm xếp trước; cùng mức thì lệnh chạy gần nhất trước. Tên chỉ dùng để xếp thứ tự, không để tin cậy.
 */
export function suggestCheckCommands(log: EvidenceLog): string[] {
  const seen = new Set<string>()
  const found: Array<{ text: string; rank: number; seq: number }> = []
  for (const entry of log.commands) {
    if (entry.check !== null || !entry.ok) continue
    for (const segment of entry.command.split(/&&|\|\||;|\||\n/)) {
      const text = scriptCommand(segment)
      if (text === null || !isUsable(text) || seen.has(text)) continue
      seen.add(text)
      const name = text.split(/\s+/).pop()?.split('/').pop() ?? ''
      found.push({ text, rank: CHECK_NAME.test(name) ? 0 : 1, seq: entry.seq })
    }
  }
  return found
    .sort((a, b) => a.rank - b.rank || b.seq - a.seq)
    .slice(0, MAX_SUGGESTIONS)
    .map(item => item.text)
}
