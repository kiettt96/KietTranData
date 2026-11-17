// Mẫu báo cáo theo vai và dòng kết luận của subagent (0.9.0 C4). Hàm thuần: dòng mod nối vào lời giao subagent có vai, và đọc dòng kết luận
// đứng đầu câu trả lời của subagent đó. Hook ở parts/agents.ts (nối khi spawn) và parts/consistency.ts (đọc khi subagent trả lời xong).

import type { Role } from '../../types'

/** Kết luận đọc được: đạt hay chưa (audit, review), sẵn sàng hay chưa (design). */
export type Verdict = 'pass' | 'fail' | 'ready' | 'not-ready'

/** Trần ký tự của dòng mẫu báo cáo mod nối vào lời giao (0.9.0 C4). */
export const REPORT_LINE_CHARS = 200

const LINES: Record<'vi' | 'en', Record<Role, string>> = {
  vi: {
    audit: '[focus-conductor] Mở đầu câu trả lời bằng ĐẠT HẾT hay CHƯA ĐẠT kèm số đếm (ví dụ CHƯA ĐẠT 2/13), rồi từng chỗ chưa đạt kèm vị trí. Không sửa file.',
    review: '[focus-conductor] Mở đầu câu trả lời bằng ĐẠT hay CHƯA ĐẠT, rồi từng lỗi theo mức Nghiêm trọng, Lớn, Nhỏ, kèm vị trí và cách sửa.',
    design: '[focus-conductor] Mở đầu câu trả lời bằng SẴN SÀNG hay CHƯA SẴN SÀNG, rồi phương án, rủi ro và tiêu chí đạt.',
    build: '[focus-conductor] Cuối câu trả lời nêu đã đổi gì (tệp, phần) và đã tự kiểm gì (lệnh, kết quả).',
    search: '[focus-conductor] Nêu từng vị trí tìm được kèm bằng chứng (tệp:dòng hay nguồn, trích ngắn).',
  },
  en: {
    audit: '[focus-conductor] Start the reply with ALL PASS or FAIL plus a count (e.g. FAIL 2/13), then each failing point with its location. Do not edit files.',
    review: '[focus-conductor] Start the reply with PASS or FAIL, then each issue by severity Critical, Major, Minor, with location and fix.',
    design: '[focus-conductor] Start the reply with READY or NOT READY, then the approach, risks and acceptance criteria.',
    build: '[focus-conductor] End the reply with what changed (files, parts) and what you checked (commands, results).',
    search: '[focus-conductor] List each location found with evidence (file:line or source, short quote).',
  },
}

/** Dòng mẫu báo cáo của vai (0.9.0 C4), không quá REPORT_LINE_CHARS ký tự. */
export function reportLine(role: Role, lang: 'vi' | 'en'): string {
  return LINES[lang][role].slice(0, REPORT_LINE_CHARS)
}

/** Dòng kết luận theo vai, xét dạng dài trước (CHƯA ĐẠT trước ĐẠT, NOT READY trước READY). */
const PATTERNS: Partial<Record<Role, Array<[RegExp, Verdict]>>> = {
  audit: [
    [/^(?:CHƯA ĐẠT|FAIL)(?![\p{L}])/u, 'fail'],
    [/^(?:ĐẠT HẾT|ALL PASS)(?![\p{L}])/u, 'pass'],
  ],
  review: [
    [/^(?:CHƯA ĐẠT|FAIL)(?![\p{L}])/u, 'fail'],
    [/^(?:ĐẠT|PASS)(?![\p{L}])/u, 'pass'],
  ],
  design: [
    [/^(?:CHƯA SẴN SÀNG|NOT READY)(?![\p{L}])/u, 'not-ready'],
    [/^(?:SẴN SÀNG|READY)(?![\p{L}])/u, 'ready'],
  ],
}

/**
 * Dòng kết luận của câu trả lời subagent (0.9.0 C4): dòng không rỗng đầu tiên, bỏ dấu markdown (#, *, >, khoảng trắng), khớp mẫu của vai.
 * Số đếm dạng N/M ngay sau kết luận đi kèm. Vai không có kết luận (build, search) hay không khớp thì null.
 */
export function verdictOf(role: Role, answer: string): { verdict: Verdict; count?: string } | null {
  const patterns = PATTERNS[role]
  if (patterns === undefined) return null
  const first = answer.normalize('NFC').split('\n').map(line => line.trim()).find(line => line !== '') ?? ''
  const line = first.replace(/^[#>*_\s`]+/u, '').replace(/[*_`]+/gu, '').trim()
  for (const [pattern, verdict] of patterns) {
    const match = pattern.exec(line)
    if (match === null) continue
    const count = /^\s*:?\s*(\d+\s*\/\s*\d+)/u.exec(line.slice(match[0].length))?.[1]?.replace(/\s+/g, '')
    return count !== undefined ? { verdict, count } : { verdict }
  }
  return null
}
