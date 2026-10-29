// Gợi ý ví dụ cho option checkCommands (0.5.6): khi verified bị hạ vì lệnh kiểm tra không nhận ra, thông báo nêu một
// lệnh script riêng của dự án mà Claude đã chạy trong mục tiêu. Hàm thuần; không đổi cổng verified.

import type { EvidenceLog } from './evidence'
import { normalizePython } from './verify'

const INTERPRETER = /^(?:python3?(?:\.\d+)?|node|bun|deno|ruby|perl|bash|sh)$/
const SCRIPT_FILE = /\.(?:py|js|mjs|cjs|ts|rb|pl|sh)$/
// Tên script có vẻ là bước kiểm: từ kiểm đứng ĐẦU tên (kiem_tra, check_totals, verify_counts, test_all); từ kiểm nằm giữa tên
// (cap_nhat_kiem_ke, ghi_test_data) không tính, và kiem_ke (kiểm kê, không phải kiểm tra) bị loại (vòng sửa 2 của 0.7.5).
const CHECK_NAME = /^(?:kiem(?![_.-]?ke(?:[_.-]|$))|check|verify|validate|test|audit|reconcile)/i
// Từ ghi dữ liệu trong tên script (R7): script có từ này, đứng đâu trong tên, không phải script kiểm dù tên bắt đầu bằng từ kiểm
// (test_data_gen.py, check_and_fix.py, verify_and_update_db.py). Khớp theo từ trọn vẹn: check_fixtures.py vẫn là script kiểm.
const WRITE_WORDS = new Set(['fix', 'update', 'gen', 'ghi', 'write', 'sua', 'sửa', 'capnhat'])
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const MAX_LENGTH = 80
const MAX_SUGGESTIONS = 2

/** Một lệnh script đã chạy: chuỗi gợi ý. */
type Script = { text: string }

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
    return { text: `${head} ${script}` }
  }
  return head.includes('/') && SCRIPT_FILE.test(head) ? { text: head } : null
}

function isUsable(text: string): boolean {
  return text.length <= MAX_LENGTH && !text.includes(',') && !/[\r\n]/.test(text)
}

type Found = { text: string; seq: number }

/** Tên script có từ ghi dữ liệu (fix, update, gen, ghi, write, sua, cap_nhat) ở bất kỳ chỗ nào trong tên, trừ đuôi tệp. */
function writesData(name: string): boolean {
  const words = name.replace(SCRIPT_FILE, '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  return words.some((word, i) => WRITE_WORDS.has(word) || (word === 'cap' && words[i + 1] === 'nhat'))
}

/**
 * Tối đa hai lệnh script đã chạy thành công trong mục tiêu mà mod không nhận là lệnh kiểm tra, làm ví dụ cho checkCommands.
 * Chỉ script có tên kiểu kiểm với từ kiểm ở đầu tên (0.7.5: script ghi dữ liệu như ghi-du-lieu.py, cap_nhat_kiem_ke.py không bao
 * giờ được gợi ý; R7: tên có fix, update, gen, ghi, write, sua, cap_nhat như check_and_fix.py cũng không); lệnh chạy gần nhất trước. Không bao giờ gợi ý tiền tố thư mục (vòng sửa 2 của 0.7.5): tiền tố tin mọi script
 * dưới thư mục, người dùng tự khai nếu muốn.
 */
export function suggestCheckCommands(log: EvidenceLog): string[] {
  const seen = new Set<string>()
  const found: Found[] = []
  for (const entry of log.commands) {
    if (entry.check !== null || !entry.ok) continue
    for (const segment of entry.command.split(/&&|\|\||;|\||\n/)) {
      const script = scriptCommand(segment)
      if (script === null || !isUsable(script.text) || seen.has(script.text)) continue
      seen.add(script.text)
      const name = script.text.split(/\s+/).pop()?.split('/').pop() ?? ''
      if (CHECK_NAME.test(name) && !writesData(name)) found.push({ text: script.text, seq: entry.seq })
    }
  }
  return found
    .sort((a, b) => b.seq - a.seq)
    .slice(0, MAX_SUGGESTIONS)
    .map(item => item.text)
}
