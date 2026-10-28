// Gợi ý ví dụ cho option checkCommands (0.5.6): khi verified bị hạ vì lệnh kiểm tra không nhận ra, thông báo nêu một
// lệnh script riêng của dự án mà Claude đã chạy trong mục tiêu. Hàm thuần; không đổi cổng verified.

import type { EvidenceLog } from './evidence'
import { normalizePython } from './verify'

const INTERPRETER = /^(?:python3?(?:\.\d+)?|node|bun|deno|ruby|perl|bash|sh)$/
const SCRIPT_FILE = /\.(?:py|js|mjs|cjs|ts|rb|pl|sh)$/
// Tên script có vẻ là bước kiểm: đứng đầu tên hoặc sau _, -, . (kiem_tra, db-audit, verify_counts).
const CHECK_NAME = /(?:^|[_.-])(?:kiem|check|verify|validate|test|audit|reconcile)/i
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const MAX_LENGTH = 80
const MAX_SUGGESTIONS = 2

/** Một lệnh script đã chạy: chuỗi gợi ý, trình thông dịch và thư mục của script (null khi không có hay script tự chạy). */
type Script = { text: string; runner: string | null; dir: string | null }

/**
 * Từ một đoạn lệnh: trình thông dịch cộng đường dẫn script, hoặc đường dẫn script đứng đầu; không có thì null. Python được
 * chuẩn hóa như lúc khớp lệnh riêng (bỏ thư mục của trình thông dịch và cờ không giá trị, 0.7.3), nên chuỗi gợi ý là
 * chuỗi sẽ khớp: `/usr/bin/python3 -B tests/a.py` gợi ý `python3 tests/a.py`.
 */
function scriptCommand(segment: string): Script | null {
  const tokens = segment.trim().split(/\s+/).filter(Boolean)
  while (tokens.length > 0 && ASSIGNMENT.test(tokens[0] ?? '')) tokens.shift()
  const words = normalizePython(tokens)
  const head = words[0]
  if (head === undefined) return null
  if (INTERPRETER.test(head)) {
    const script = words.slice(1).find(token => !token.startsWith('-'))
    if (script === undefined || !SCRIPT_FILE.test(script)) return null
    const slash = script.lastIndexOf('/')
    return { text: `${head} ${script}`, runner: head, dir: slash >= 0 ? script.slice(0, slash + 1) : null }
  }
  return head.includes('/') && SCRIPT_FILE.test(head) ? { text: head, runner: null, dir: null } : null
}

function isUsable(text: string): boolean {
  return text.length <= MAX_LENGTH && !text.includes(',') && !/[\r\n]/.test(text)
}

type Found = { text: string; rank: number; seq: number }

/**
 * Tối đa hai lệnh script đã chạy thành công trong mục tiêu mà mod không nhận là lệnh kiểm tra, làm ví dụ cho checkCommands.
 * Chỉ script có tên kiểu kiểm (0.7.5: script ghi dữ liệu như ghi-du-lieu.py không bao giờ được gợi ý); lệnh chạy gần nhất
 * trước. Từ hai script khác nhau của cùng một trình thông dịch trong cùng một thư mục thì gợi ý tiền tố thư mục
 * (`python3 tests/`) thay cho từng script (0.7.3), chỉ khi mọi script đã chạy trong thư mục đó đều có tên kiểu kiểm (0.7.5).
 */
export function suggestCheckCommands(log: EvidenceLog): string[] {
  const seen = new Set<string>()
  const scripts: Array<Script & Found> = []
  for (const entry of log.commands) {
    if (entry.check !== null || !entry.ok) continue
    for (const segment of entry.command.split(/&&|\|\||;|\||\n/)) {
      const script = scriptCommand(segment)
      if (script === null || !isUsable(script.text) || seen.has(script.text)) continue
      seen.add(script.text)
      const name = script.text.split(/\s+/).pop()?.split('/').pop() ?? ''
      scripts.push({ ...script, rank: CHECK_NAME.test(name) ? 0 : 1, seq: entry.seq })
    }
  }
  const groups = new Map<string, Array<Script & Found>>()
  for (const script of scripts) {
    if (script.runner === null || script.dir === null) continue
    const key = `${script.runner} ${script.dir}`
    groups.set(key, [...(groups.get(key) ?? []), script])
  }
  const found: Found[] = []
  const covered = new Set<string>()
  for (const [key, items] of groups) {
    // Tiền tố thư mục tin mọi script dưới nó: chỉ khi mọi script đã chạy trong thư mục đều có tên kiểu kiểm (0.7.5).
    if (items.length < 2 || items.some(item => item.rank !== 0)) continue
    found.push({ text: key, rank: Math.min(...items.map(item => item.rank)), seq: Math.max(...items.map(item => item.seq)) })
    for (const item of items) covered.add(item.text)
  }
  for (const script of scripts) if (!covered.has(script.text) && script.rank === 0) found.push(script)
  return found
    .sort((a, b) => a.rank - b.rank || b.seq - a.seq)
    .slice(0, MAX_SUGGESTIONS)
    .map(item => item.text)
}
