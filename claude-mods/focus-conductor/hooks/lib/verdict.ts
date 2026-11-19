// Mẫu báo cáo theo vai và dòng kết luận của subagent (0.9.0 C4). Hàm thuần: dòng mod nối vào lời giao subagent có vai, và đọc dòng kết luận
// đứng đầu câu trả lời của subagent đó. Hook ở parts/agents.ts (nối khi spawn) và parts/consistency.ts (đọc khi subagent trả lời xong).

import type { Role } from '../../types'
import { dropNegated } from './drift/output'

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
 * Họ từ kết luận bằng tiếng Anh (vòng 2 G1, G1b, L2), danh sách đóng. Phủ định đứng ngay trước một từ họ đạt, cách bằng khoảng trắng hay
 * gạch nối, cho kết luận chưa đạt; xét trước họ đạt.
 */
const PASS_FORMS = ['passing', 'passes', 'passed', 'pass']
const FAIL_FORMS = ['failure', 'failing', 'failed', 'fails', 'fail']
const NEGATIONS = ['does not', 'did not', 'cannot', "can't", "doesn't", "didn't", 'not']
const NEGATED = NEGATIONS.flatMap(n => PASS_FORMS.flatMap(p => [`${n} ${p}`, `${n}-${p}`]))

/**
 * Từ kết luận (0.9.0 D2, C6), không phân biệt hoa thường. "ĐẠT HẾT", "ALL PASS" chỉ là kết luận của bước kiểm (isCheckOnly).
 */
const WORDS: ReadonlyArray<readonly [string, Verdict, boolean]> = [
  ['chưa sẵn sàng', 'not-ready', false],
  ['not ready', 'not-ready', false],
  ...NEGATED.map(word => [word, 'fail', false] as const),
  ['chưa đạt', 'fail', false],
  ['không đạt', 'fail', false],
  ...FAIL_FORMS.map(word => [word, 'fail', false] as const),
  ['sẵn sàng', 'ready', false],
  ['ready', 'ready', false],
  ['đạt kèm lỗi nhẹ', 'pass', false],
  ['đạt hết', 'pass', true],
  ['all pass', 'pass', true],
  ['đạt', 'pass', false],
  ...PASS_FORMS.map(word => [word, 'pass', false] as const),
]

/** Một dòng kết luận đọc được: từ kết luận, số đếm N/M nếu có, cờ chỉ-của-bước-kiểm, dòng chỉ có từ kết luận; hay dòng chưa có kết luận. */
type VerdictLine = { verdict: Verdict; count?: string; isCheckOnly: boolean; isBare: boolean } | { unclear: true }

/** Mức lỗi cao. Mức thấp ("nhẹ", "nhỏ", "vặt", "minor") không bao giờ làm đổi kết luận. */
const HIGH_WORDS = 'nặng|lớn|vừa|nghiêm\\s+trọng|chặn|major|critical|blockers?|blocked|blocking'
/**
 * Mức lỗi cao bị phủ định bằng số đếm 0 hay "none" (vòng 2 M3): "0 critical", "none critical", "Critical: 0", "Lớn: không", "major: none";
 * các dạng "không", "không có", "không còn", "no" do `dropNegated` bỏ.
 */
const ZERO_HIGH = new RegExp(`(?:^|[^\\p{L}\\d])(?:0|none)\\s+(?:${HIGH_WORDS})(?:[^\\p{L}]|$)|(?:^|[^\\p{L}])(?:${HIGH_WORDS})\\s*:\\s*(?:0|không|none|no)(?![\\p{L}\\d])`, 'gu')
function dropZeroHigh(text: string): string {
  return text.replace(ZERO_HIGH, ' ')
}
/**
 * Mức lỗi cao trong câu đầu sau từ đạt (vòng 2 M3). Chữ "vừa" (quyết định của chủ mod 19/11/2026) chỉ là mức lỗi khi đứng ngay sau "lỗi"
 * hay "mức", ngay sau một số đếm ("2 vừa"), hay là nhãn trước dấu hai chấm ("Vừa: 1"); "vừa kiểm xong" không phải mức lỗi.
 */
const HIGH = new RegExp(`(?:^|[^\\p{L}])(?:${HIGH_WORDS.replace('vừa|', '')})(?:[^\\p{L}]|$)`, 'u')
const HIGH_VUA = /(?:(?:^|[^\p{L}])(?:lỗi|mức)\s+vừa|\d\s*vừa|(?:^|[^\p{L}])vừa\s*:)(?:[^\p{L}]|$)/u
/** Đạt từng phần: chưa có kết luận. */
const PARTIAL = /(?:^|[^\p{L}])(?:phần lớn|một phần|mostly|partially)(?:[^\p{L}]|$)/u

/**
 * Đọc một dòng (sau phiên thật D4, thay luật đóng 18/11): bỏ ký hiệu markdown, dấu đầu dòng, nhãn "Kết luận:" hay "Verdict:"; dòng mở đầu
 * bằng một từ kết luận (cụm chưa đạt xét trước) là dòng kết luận, và chỉ xét câu đầu của nó (tới dấu chấm, chấm phẩy hay hết dòng); các câu
 * sau là bình luận. Từ chưa đạt: chưa đạt. Từ đạt: đạt, trừ khi câu có mức lỗi cao không bị phủ định (chưa đạt; vòng 2 M3 bỏ điều kiện từ tương phản), hay có
 * "phần lớn", "một phần", "mostly", "partially" (chưa có kết luận). Phủ định nhận như lỗi trong output lệnh kiểm (`dropNegated`).
 */
function lineVerdict(raw: string): VerdictLine | null {
  // Chuẩn hóa ký tự (vòng 2 M2): nháy cong thành nháy thẳng, các loại gạch nối thành `-`, khoảng trắng đặc biệt thành khoảng trắng thường.
  let text = raw.normalize('NFC').replace(/[\u200b-\u200d\ufeff]/gu, '').replace(/[\u2018\u2019\u201b\u2032]/gu, "'").replace(/[\u2010-\u2015\u2212]/gu, '-').replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/gu, ' ').replace(/[*_`]+/gu, '').replace(/\s+/gu, ' ').trim()
  text = text.replace(/^(?:[#>]+\s*|[-+•]\s+|\d+[.)]\s+)+/u, '').trim()
  text = text.replace(/^(?:kết luận|verdict)\s*:\s*/iu, '').trim().toLowerCase()
  for (const [word, verdict, isCheckOnly] of WORDS) {
    if (!text.startsWith(word) || /^\p{L}/u.test(text.slice(word.length))) continue
    const after = text.slice(word.length)
    const count = /^\s*(\d+\s*\/\s*\d+)/u.exec(after)?.[1]
    const sentence = (/^(.*?)(?:[.;](?:\s|$)|;|$)/u.exec(after.replace(/^\s*\d+\s*\/\s*\d+/u, ''))?.[1] ?? '').trim()
    const isBare = sentence.replace(/[\s,.;:!()–—-]+/gu, '') === ''
    const counted = count !== undefined ? { count: count.replace(/\s+/g, '') } : {}
    if (verdict === 'fail' || verdict === 'not-ready') return { verdict, ...counted, isCheckOnly, isBare }
    if (PARTIAL.test(sentence)) return { unclear: true }
    const open = dropNegated(sentence, HIGH_WORDS)
    if (HIGH.test(dropZeroHigh(open)) || HIGH_VUA.test(dropZeroHigh(open))) return { verdict: verdict === 'pass' ? 'fail' : 'not-ready', ...counted, isCheckOnly: false, isBare }
    return { verdict, ...counted, isCheckOnly, isBare }
  }
  return null
}

const isReadiness = (verdict: Verdict) => verdict === 'ready' || verdict === 'not-ready'
const isNegative = (verdict: Verdict) => verdict === 'fail' || verdict === 'not-ready'

/**
 * Kết luận của câu trả lời subagent (sau phiên thật D4): dòng kết luận đầu tiên quyết; có một dòng chỉ là từ đạt và một dòng chỉ là từ chưa
 * đạt cùng loại thì là chưa đạt. Không có dòng kết luận nào thì null.
 */
export function verdictOf(answer: string): { verdict: Verdict; count?: string; isCheckOnly?: true } | null {
  const lines = answer.split('\n').map(lineVerdict).filter((v): v is { verdict: Verdict; count?: string; isCheckOnly: boolean; isBare: boolean } => v !== null && !('unclear' in v))
  const first = lines[0]
  if (first === undefined) return null
  const sameKind = (v: { verdict: Verdict }) => isReadiness(v.verdict) === isReadiness(first.verdict)
  const bareNegative = lines.find(v => v.isBare && isNegative(v.verdict) && sameKind(v))
  const barePositive = lines.some(v => v.isBare && !isNegative(v.verdict) && sameKind(v))
  const chosen = isNegative(first.verdict) ? first : bareNegative !== undefined && barePositive ? bareNegative : first
  return { verdict: chosen.verdict, ...(chosen.count !== undefined ? { count: chosen.count } : {}), ...(chosen.isCheckOnly ? { isCheckOnly: true as const } : {}) }
}

/** Câu trả lời có dòng mở đầu bằng từ kết luận nhưng chưa có kết luận (đạt từng phần), và không có dòng kết luận nào khác. */
export function isUnclearVerdict(answer: string): boolean {
  const lines = answer.split('\n').map(lineVerdict).filter(v => v !== null)
  return lines.length > 0 && lines.every(v => v !== null && 'unclear' in v)
}

/** Câu trả lời không có dòng nào mở đầu bằng từ kết luận (sau phiên thật D4, mục 1f). */
export function hasNoVerdictLine(answer: string): boolean {
  return answer.split('\n').every(line => lineVerdict(line) === null)
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
