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

/**
 * Từ kết luận (0.9.0 D2, C6), không phân biệt hoa thường. "ĐẠT HẾT", "ALL PASS" chỉ là kết luận của bước kiểm (isCheckOnly).
 */
const WORDS: ReadonlyArray<readonly [string, Verdict, boolean]> = [
  ['chưa sẵn sàng', 'not-ready', false],
  ['not ready', 'not-ready', false],
  ['chưa đạt', 'fail', false],
  ['không đạt', 'fail', false],
  ['fail', 'fail', false],
  ['sẵn sàng', 'ready', false],
  ['ready', 'ready', false],
  ['đạt kèm lỗi nhẹ', 'pass', false],
  ['đạt hết', 'pass', true],
  ['all pass', 'pass', true],
  ['đạt', 'pass', false],
  ['pass', 'pass', false],
]

/** Một dòng kết luận đọc được: từ kết luận, số đếm N/M nếu có, và cờ chỉ-của-bước-kiểm. */
type VerdictLine = { verdict: Verdict; count?: string; isCheckOnly: boolean }

/** Phần sau từ kết luận làm đạt thành chưa đạt (0.9.0, C2 đo dấu file, mục 6): "nhưng", "but", hay nhắc lỗi nặng, lớn, vừa, nghiêm trọng. */
const NEGATING = /(?:^|[^\p{L}])(?:nhưng|but|major|critical|nghiêm trọng)(?:[^\p{L}]|$)|lỗi\s+(?:nặng|lớn|vừa)(?:[^\p{L}]|$)/u

/**
 * Đọc một dòng (0.9.0, C2 đo dấu file, mục 6): bỏ ký hiệu markdown, dấu đầu dòng, nhãn "Kết luận:" hay "Verdict:"; dòng mở đầu bằng một từ
 * kết luận (cụm chưa đạt xét trước) là dòng kết luận. Phần còn lại có "nhưng", "but" hay nhắc lỗi nặng, lớn, vừa, nghiêm trọng, major,
 * critical thì đạt thành chưa đạt, sẵn sàng thành chưa sẵn sàng; phần còn lại rỗng hay chỉ nói lỗi nhẹ thì giữ.
 */
function lineVerdict(raw: string): VerdictLine | null {
  let text = raw.normalize('NFC').replace(/[\u200b-\u200d\ufeff]/gu, '').replace(/[*_`]+/gu, '').replace(/\s+/gu, ' ').trim()
  text = text.replace(/^(?:[#>]+\s*|[-+•]\s+|\d+[.)]\s+)+/u, '').trim()
  text = text.replace(/^(?:kết luận|verdict)\s*:\s*/iu, '').trim().toLowerCase()
  for (const [word, verdict, isCheckOnly] of WORDS) {
    if (!text.startsWith(word) || /^\p{L}/u.test(text.slice(word.length))) continue
    const rest = text.slice(word.length)
    const count = /^\s*(\d+\s*\/\s*\d+)/u.exec(rest)?.[1]?.replace(/\s+/g, '')
    const isNegated = NEGATING.test(rest)
    const final: Verdict = isNegated && verdict === 'pass' ? 'fail' : isNegated && verdict === 'ready' ? 'not-ready' : verdict
    return { verdict: final, ...(count !== undefined ? { count } : {}), isCheckOnly: isCheckOnly && !isNegated }
  }
  return null
}

/** Kết luận của câu trả lời subagent (0.9.0, C2 đo dấu file, mục 6): dòng kết luận đầu tiên quyết; không có dòng nào thì null. */
export function verdictOf(answer: string): { verdict: Verdict; count?: string; isCheckOnly?: true } | null {
  for (const line of answer.split('\n')) {
    const found = lineVerdict(line)
    if (found !== null) return { verdict: found.verdict, ...(found.count !== undefined ? { count: found.count } : {}), ...(found.isCheckOnly ? { isCheckOnly: true as const } : {}) }
  }
  return null
}

/** Trần ký tự của bảng báo cáo chèn khi đóng bước cuối (0.9.0 C8). */
export const REPORT_TABLE_CHARS = 600

/** Một lần chạy trong sổ kết luận của mục tiêu, đủ cho bảng báo cáo (0.9.0 C8). */
export type ReportRun = { role: Role; verdict: Verdict | null; count?: string; family: string; taskIndex?: number; description: string }

const ROLE_NAMES: Record<Role, string> = { design: 'thiết kế', review: 'duyệt', build: 'làm', search: 'tra', audit: 'kiểm' }
const VERDICT_TEXT: Record<Verdict, string> = { pass: 'ĐẠT', fail: 'CHƯA ĐẠT', ready: 'SẴN SÀNG', 'not-ready': 'CHƯA SẴN SÀNG' }
const REPORT_HEAD = '[focus-conductor] Bảng việc của mục tiêu (dùng cho báo cáo cuối):'

function verdictText(run: ReportRun): string {
  if (run.verdict === null) return run.role === 'build' || run.role === 'search' ? 'không có dòng kết luận' : 'chưa rõ kết luận'
  return run.count !== undefined ? `${VERDICT_TEXT[run.verdict]} ${run.count}` : VERDICT_TEXT[run.verdict]
}

function runLabel(run: ReportRun): string {
  if (run.taskIndex !== undefined) return `Việc ${run.taskIndex}`
  const text = run.description.replace(/\s+/g, ' ').trim()
  return text.length > 60 ? `${text.slice(0, 59)}…` : text
}

/**
 * Bảng báo cáo khi đóng bước cuối (0.9.0 C8): mỗi việc một dòng gồm vai, model đã chạy, kết luận; một việc chạy nhiều lần thì giữ lần cuối.
 * Quá REPORT_TABLE_CHARS ký tự thì gộp theo vai (số việc, các model, đếm kết luận). Sổ rỗng thì chuỗi rỗng.
 */
export function reportTable(runs: readonly ReportRun[]): string {
  const last = new Map<string, ReportRun>()
  for (const run of runs) {
    const key = run.taskIndex !== undefined ? `#${run.taskIndex}` : run.description
    last.delete(key)
    last.set(key, run)
  }
  const kept = [...last.values()]
  if (kept.length === 0) return ''
  const rows = kept.map(run => `- ${runLabel(run)}: vai ${ROLE_NAMES[run.role]}, ${run.family}, ${verdictText(run)}`)
  const full = [REPORT_HEAD, ...rows].join('\n')
  if (full.length <= REPORT_TABLE_CHARS) return full
  const groups = new Map<Role, ReportRun[]>()
  for (const run of kept) groups.set(run.role, [...(groups.get(run.role) ?? []), run])
  const grouped = [...groups].map(([role, list]) => {
    const families = [...new Set(list.map(run => run.family))].join(', ')
    const counts = new Map<string, number>()
    for (const run of list) counts.set(verdictText(run).replace(/ \d+\/\d+$/, ''), (counts.get(verdictText(run).replace(/ \d+\/\d+$/, '')) ?? 0) + 1)
    const tally = [...counts].map(([text, count]) => `${count} ${text}`).join(', ')
    return `- vai ${ROLE_NAMES[role]}: ${list.length} việc, ${families}; ${tally}`
  })
  return [REPORT_HEAD, ...grouped].join('\n').slice(0, REPORT_TABLE_CHARS)
}
