// Output của lệnh kiểm tra: dấu hiệu lỗi, báo cáo tổng kết đầy đủ theo từng trình chạy, và một lệnh kiểm tra có đạt không.
// Chuyển nguyên văn từ hooks/lib/drift.ts (tách theo tầng, không đổi hành vi); hooks/lib/drift.ts là barrel.

import type { CheckEffect } from './classify'
import type { ToolObservation } from './tool'
import { isCustomCheck } from './verify'

// Dấu hiệu lỗi trong output của các trình chạy test, type-check, lint phổ biến. Chỉ áp cho lệnh kiểm tra.
const CHECK_FAILED = new RegExp(
  [
    '(?:^|\\n)\\s*#\\s*fail\\s+[1-9]', // TAP (node --test)
    '\\b[1-9]\\d*\\s+(?:failed|failing|fail|failures?)\\b', // jest, mocha, bun, vitest, pytest
    '\\bTests?:\\s+[1-9]\\d*\\s+failed', // jest
    '\\berror\\s+TS\\d+', // tsc
    '(?:^|\\n)FAILED\\b|=+\\s*FAILURES\\s*=+', // pytest
    '\\u2716\\s*[1-9]\\d*\\s+problems?', // eslint
    '\\bFound\\s+[1-9]\\d*\\s+errors?\\b', // tsc --pretty, mypy
    'test result:\\s*FAILED', // cargo
    '(?:^|\\n)(?:FAIL|--- FAIL)\\b', // go test, jest
  ].join('|'),
  'i',
)

/** Output của lệnh kiểm tra có dấu hiệu lỗi (dù mã thoát là 0). */
export function outputFailed(output: string | undefined): boolean {
  return output !== undefined && output !== '' && CHECK_FAILED.test(output)
}

/**
 * Khối tổng kết của các trình chạy khác (Node, Go, Cargo có parser riêng), theo output thật (tests/fixtures/runner-output.ts):
 * dòng đạt (số test đạt lớn hơn 0) phải là khối tổng kết CUỐI của output; sau nó chỉ được có dòng trống hoặc dòng phụ
 * của chính trình chạy đó (`trailer`). `requires`: dòng phụ bắt buộc phải có. Không nhận ra định dạng thì không xác nhận.
 */
type Summary = { pass: RegExp; trailer: RegExp[]; requires?: RegExp }
const SUMMARIES: Record<'jest' | 'vitest' | 'mocha' | 'bun' | 'pytest', Summary> = {
  // Jest: "Tests:       12 passed, 12 total", rồi Snapshots, Time, "Ran all test suites."
  jest: { pass: /^Tests:\s+(\d+) passed, \1 total$/, trailer: [/^Snapshots:\s+(?:\d+ passed, )?\d+ total$/, /^Time:\s+[\d.]+ m?s(?:, estimated [\d.]+ m?s)?$/, /^Ran all test suites\b[^\n]*\.$/] },
  // Vitest: "Tests  12 passed (12)", rồi Start at, Duration.
  vitest: { pass: /^Tests\s+(\d+) passed \(\1\)$/, trailer: [/^Start at\s+[\d:]+$/, /^Duration\s+[\d.]+m?s(?: \([^()\n]*\))?$/] },
  // Mocha: "12 passing (3ms)", rồi "1 pending".
  mocha: { pass: /^(\d+) passing \(\d+(?:ms|s|m)\)$/, trailer: [/^\d+ pending$/] },
  // Bun: "12 pass", rồi skip, todo, "0 fail" (bắt buộc), expect() calls, "Ran 12 tests across 1 file. [10.00ms]".
  bun: { pass: /^(\d+) pass$/, trailer: [/^\d+ (?:skip|todo)$/, /^0 fail$/, /^\d+ expect\(\) calls$/, /^Ran \d+ tests? across \d+ files?\. \[[\d.]+m?s\]$/], requires: /^0 fail$/ },
  // Pytest: "=== 12 passed in 0.5s ===" là dòng cuối.
  pytest: { pass: /^=+ (\d+) passed(?:, \d+ (?:skipped|deselected|xfailed|xpassed|warnings?))* in [\d.]+s(?: \([\d:]+\))? =+$/, trailer: [] },
}

/** Output kết thúc bằng khối tổng kết đạt của trình chạy `summary`. */
function summaryPass(output: string, { pass, trailer, requires }: Summary): boolean {
  const lines = output.split('\n').map(line => line.trim())
  const at = lines.findLastIndex(line => pass.test(line))
  if (at < 0 || !(Number(pass.exec(lines[at] ?? '')?.[1]) > 0)) return false
  const after = lines.slice(at + 1).filter(line => line !== '')
  return after.every(line => trailer.some(pattern => pattern.test(line))) && (requires === undefined || after.some(line => requires.test(line)))
}

/** Dấu hiệu lỗi: có bất kỳ dấu hiệu nào thì output không bao giờ là báo cáo đạt. FAILED phân biệt hoa thường ("0 failed" của cargo không phải lỗi). */
const COMPLETE_FAIL: RegExp[] = [
  /\b[1-9]\d*\s+(?:failed|failing|errors?)\b/i,
  /^\s*(?:#|\u2139)\s*fail\s+[1-9]/m, // Node (TAP, spec)
  /\bFAILED\b/,
  /^FAIL\b|--- FAIL|\[build failed\]/m, // go test
  /^\s*panic:/m, // go
  /^\s*error(?:\[E\d+\])?:/m, // cargo, rustc
  /^\s*Bail out!/m, // TAP
  /^\s*(?:Uncaught\s+)?(?:[A-Z]\w*)?Error(?:\s*\[[^\]\n]*\])?:/m, // JavaScript, Python: "Error:", "TypeError:", "AssertionError [ERR_X]:"
  /^\s*Traceback \(most recent call last\)/m, // Python
  /^\s*npm ERR!|\bELIFECYCLE\b|^\s*Command failed\b|\bexited with code [1-9]/m, // npm, trình chạy script
]

/** Bộ đếm trong tổng kết của node --test (TAP: "# tests 3", spec: "ℹ tests 3"), theo đúng thứ tự in. */
const NODE_COUNTER = /^\s*(?:#|\u2139)\s*(tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)\s+(\d+(?:\.\d+)?)\s*$/
const NODE_FIELDS = ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo', 'duration_ms'] as const

/**
 * Báo cáo của node --test (TAP hoặc spec). Khối tổng kết phải là một khối duy nhất, liền mạch, đủ tám dòng theo đúng
 * thứ tự (`tests` đến `duration_ms`), ở cột 0 và kết thúc output; không có dòng bộ đếm nào khác. TAP: ngay trước khối
 * là dòng plan `1..N` (N là số mục cấp ngoài cùng); output đầy đủ thì có `TAP version` và đúng N dòng `ok`/`not ok`
 * cấp ngoài cùng. Spec đầy đủ: số dòng kết quả (`✔`, `﹣`) trừ số suite bằng pass + skipped + todo. Đạt khi fail =
 * cancelled = 0, pass > 0, tests = pass + skipped + todo, không có test lỗi thực (`not ok`, kể cả `# TODO`; `✖`);
 * output bị cắt (tail) mà có todo thì không đạt.
 */
function nodePass(output: string, truncated: boolean): boolean {
  const lines = output.replace(/\s+$/, '').split('\n')
  const block = lines.slice(-NODE_FIELDS.length)
  const prefix = block[0]?.[0]
  if (block.length !== NODE_FIELDS.length || (prefix !== '#' && prefix !== '\u2139')) return false
  const counts = new Map<string, number>()
  for (const [i, line] of block.entries()) {
    const match = NODE_COUNTER.exec(line)
    if (match === null || line[0] !== prefix || match[1] !== NODE_FIELDS[i]) return false
    counts.set(match[1] ?? '', Number(match[2]))
  }
  const before = lines.slice(0, -NODE_FIELDS.length)
  if (before.some(line => NODE_COUNTER.test(line))) return false
  const [tests = 0, suites = 0, pass = 0, fail = 1, cancelled = 1, skipped = 0, todo = 0] = NODE_FIELDS.map(field => counts.get(field))
  if (fail !== 0 || cancelled !== 0 || pass <= 0 || tests !== pass + skipped + todo) return false
  if (/^\s*not ok\b/m.test(output) || output.includes('\u2716')) return false
  if (prefix === '#') {
    const plan = /^1\.\.([1-9]\d*)$/.exec(before[before.length - 1] ?? '')
    if (plan === null) return false
    if (!truncated && (!/^TAP version \d+$/m.test(output) || before.filter(line => /^ok \d+\b/.test(line)).length !== Number(plan[1]))) return false
  } else if (!truncated && before.filter(line => /^\s*[\u2714\ufe63]/.test(line)).length - suites !== pass + skipped + todo) {
    return false
  }
  return !(truncated && todo > 0)
}

/** Dòng gói của go test: đạt ("ok <gói> 0.01s", "(cached)", có thể kèm coverage) và không có file test. */
const GO_OK = /^ok\s+\S+\s+(?:\d+(?:\.\d+)?s|\(cached\))(?:\s+coverage:.*)?\s*$/
const GO_NO_TESTS = /^\?\s+\S+\s+\[no test files\]\s*$/

/** Báo cáo của go test: mọi dòng gói (ok, FAIL, ?) đúng dạng và có ít nhất một gói ok. */
function goPass(output: string): boolean {
  const lines = output.split('\n').filter(line => /^(?:ok|FAIL|\?)(?:\s|$)/.test(line))
  return lines.some(line => GO_OK.test(line)) && lines.every(line => GO_OK.test(line) || GO_NO_TESTS.test(line))
}

/**
 * Báo cáo của cargo test: mỗi binary và doctest đã chạy (dòng `Running`, `Doc-tests`) có đúng một dòng "test result:",
 * mọi dòng đó là ok, 0 failed, và có test đạt.
 */
function cargoPass(output: string): boolean {
  const results = output.match(/^test result:.*$/gm) ?? []
  const targets = output.match(/^\s+(?:Running|Doc-tests)\s/gm) ?? []
  if (results.length === 0 || results.length !== targets.length) return false
  const ok = results.map(line => /^test result: ok\. (\d+) passed; 0 failed;/.exec(line))
  return ok.every(match => match !== null) && ok.some(match => Number(match?.[1]) > 0)
}

/** Trình chạy test có parser báo cáo; script đóng gói (npm, make) và lệnh khác không có. */
export type Runner = 'node' | 'jest' | 'vitest' | 'mocha' | 'bun' | 'pytest' | 'go' | 'cargo'

/**
 * Trình chạy của một đoạn lệnh kiểm tra, theo chính lệnh (không theo output): `node --test`, `jest`, `vitest`, `mocha`,
 * `bun test`, `pytest` (cả `python -m pytest`), `go test`, `cargo test`. Script đóng gói (`npm test`, `npm run X`,
 * `pnpm`/`yarn`/`bun run X`, `make test`) không biết gọi trình chạy nào: null.
 */
export function runnerOf(segment: string): Runner | null {
  const tokens = segment.toLowerCase().trim().split(/\s+/).filter(Boolean)
  while (tokens.length > 0 && (tokens[0] === 'npx' || (tokens[0] ?? '').startsWith('-'))) tokens.shift()
  const [name, sub, third] = tokens
  if (name === 'node') return tokens.includes('--test') ? 'node' : null
  if (name === 'jest' || name === 'vitest' || name === 'mocha' || name === 'pytest') return name
  if (name === 'bun') return sub === 'test' ? 'bun' : null
  if ((name === 'python' || name === 'python3') && sub === '-m' && third === 'pytest') return 'pytest'
  if (name === 'go') return sub === 'test' ? 'go' : null
  if (name === 'cargo') return sub === 'test' ? 'cargo' : null
  return null
}

/**
 * Output là báo cáo tổng kết đầy đủ của một lượt test đạt, theo parser của đúng trình chạy `runner` (lấy từ lệnh, không
 * đoán theo hình dạng output), không có dấu hiệu lỗi nào. `truncated`: output chỉ là phần cuối (qua tail); báo cáo Go
 * và Cargo in theo từng gói hay binary nên phần cuối không bao giờ đủ. Parser loại các ca mơ hồ và false positive đã
 * biết; không chứng minh được tính trung thực của một chương trình từ output của chính nó.
 */
export function completePass(output: string, runner: Runner, options: { truncated?: boolean } = {}): boolean {
  const truncated = options.truncated === true
  if (COMPLETE_FAIL.some(pattern => pattern.test(output))) return false
  if (runner === 'node') return nodePass(output, truncated)
  if (runner === 'go') return !truncated && goPass(output)
  if (runner === 'cargo') return !truncated && cargoPass(output)
  return summaryPass(output, SUMMARIES[runner])
}

// Dấu hiệu của lệnh kiểm riêng (checkCommands) qua ống (0.7.5), kể cả tiếng Việt; ranh giới theo chữ Unicode.
const EDGE_START = '(?:^|[^\\p{L}\\p{N}])'
const EDGE_END = '(?=$|[^\\p{L}\\p{N}])'
/**
 * Dấu hiệu lỗi: KHÔNG ĐẠT, KHÔNG KHỚP, CHƯA ĐẠT, CHƯA KHỚP, KHÔNG HỢP LỆ, LỖI, SAI, THIẾU, LỆCH (gồm CHÊNH LỆCH), FAIL, ERROR, MISMATCH
 * (lỗi thắng dấu hiệu đạt). Thêm ở vòng sửa 2 của 0.7.5: chưa đạt, chưa khớp, thiếu, lệch, chênh lệch, không hợp lệ, mismatch, error.
 * Thêm ở vòng rà soát 3: missing, (do/does) not match, invalid, exception, không đúng, khác biệt.
 * Thêm ở vòng rà soát 4 (S5): trùng, trùng lặp, duplicate, chưa xử lý, vượt ngưỡng, không cân, không tìm thấy, not found, differ, assert,
 * `-> False`, `expected ... got`.
 */
const CUSTOM_FAILED = new RegExp(
  `${EDGE_START}(?:không\\s+đạt|không\\s+khớp|không\\s+hợp\\s+lệ|không\\s+đúng|không\\s+cân|không\\s+tìm\\s+thấy|not\\s+found|khác\\s+biệt|chưa\\s+(?:đạt|khớp|ok|xử\\s+lý)|vượt\\s+ngưỡng|bỏ\\s+sót|số\\s+dư\\s+âm|trùng(?:\\s+lặp)?(?!\\s+khớp)|duplicat(?:e|es|ed)|differ(?:s|ed)?|assert|not\\s+ok|lỗi|sai|thiếu|lệch|mismatch(?:es|ed)?|errors?|fail(?:ed|ures?)?|missing|(?:do|does|did)?\\s*not\\s+match(?:es|ed)?|doesn't\\s+match|invalid|exceptions?)${EDGE_END}`,
  'iu',
)
/** Các dấu chéo U+2717, U+2718, U+2716, U+274C đứng riêng, không có ranh giới chữ. */
const CROSS_MARK = /[\u2717\u2718\u2716\u274C]/u
/** `-> False`, `=> False`, `→ False` (một phép kiểm trả sai) và `expected ... got/actual/received ...` trong cùng dòng (S5). */
const FALSE_RESULT = /(?:->|=>|→)\s*false(?![\p{L}\p{N}])/iu
const EXPECTED_GOT = /(?<![\p{L}\p{N}])expected(?![\p{L}\p{N}])[^\n]*(?<![\p{L}\p{N}])(?:got|actual|received|but\s+was)(?![\p{L}\p{N}])/iu
/**
 * Từ chỉ số lỗi (cả từ ghép trước từ đơn để "sai lệch: 0" là một từ). "cảnh báo", "warn" chỉ là lỗi khi kèm số khác 0 (vòng rà soát 3 và S5).
 */
const FAILURE_WORDS =
  'sai\\s+lệch|chênh\\s+lệch|chưa\\s+xử\\s+lý|vượt\\s+ngưỡng|bỏ\\s+sót|số\\s+dư\\s+âm|hết\\s+hạn|thừa|trùng\\s+lặp|trùng(?!\\s+khớp)|duplicat(?:e|es|ed)|differ(?:s|ed)?|lỗi|sai|thiếu|lệch|mismatch(?:es)?|fail(?:ed|ures?)?|errors?|missing|invalid|exceptions?|cảnh\\s+báo|warn(?:ing)?s?|chênh|null(?:s)?'
/** Số 0 đứng riêng (0, 0.0, 0,00), không phải 0.5 hay 0,3: "Lỗi = 0.5%" không là số lỗi bằng 0 (vòng rà soát 3). */
const ZERO = `0(?:[.,]0+)?(?![.,]?\\d)${EDGE_END}`
/** Số lỗi bằng 0 ("0 lỗi", "FAIL: 0", "Thiếu: 0") không phải dấu hiệu lỗi: bỏ trước khi tìm dấu hiệu lỗi. */
const ZERO_FAILURES = new RegExp(`${EDGE_START}${ZERO}\\s*(?:${FAILURE_WORDS})${EDGE_END}|${EDGE_START}(?:${FAILURE_WORDS})\\s*[:=]\\s*${ZERO}`, 'giu')
/** Đơn vị đếm dữ liệu (T9): dòng, bản ghi, rows, records; thêm kết quả, results ở 0.7.6 V1 ("0 kết quả" là dữ liệu rỗng). */
const DATA_UNIT = '(?:dòng|bản\\s+ghi|kết\\s+quả|rows?|records?|results?)'
/** Số lỗi bằng 0 có đơn vị (T9): "Lỗi: 0 dòng", "Thiếu 0 dòng", "0 dòng lệch" không phải dấu hiệu lỗi, cũng không phải dữ liệu rỗng. */
const ZERO_UNIT_FAILURES = new RegExp(
  `${EDGE_START}(?:${FAILURE_WORDS})\\s*[:=]?\\s*${ZERO}\\s+${DATA_UNIT}${EDGE_END}|${EDGE_START}${ZERO}\\s+${DATA_UNIT}\\s+(?:${FAILURE_WORDS})${EDGE_END}`,
  'giu',
)
/**
 * Số dòng trống hay rỗng bằng 0 (0.7.6 V1): "0 dòng trống", "(0 dòng rỗng)", "trống ở 0 dòng" là số lỗi bằng 0 như "0 lỗi", không phải dữ
 * liệu rỗng.
 */
const ZERO_EMPTY = new RegExp(
  `${EDGE_START}${ZERO}\\s+${DATA_UNIT}\\s+(?:trống|rỗng|empty|blank)${EDGE_END}|${EDGE_START}(?:trống|rỗng|empty|blank)\\s+(?:ở|in|on)\\s+${ZERO}\\s+${DATA_UNIT}${EDGE_END}`,
  'giu',
)
/** Từ chỉ số lỗi theo sau là ":" hay "=" và phần còn lại của dòng: mọi số trong vế đó phải là 0 ("Thiếu: 0 cũ, 12 mới" là lỗi). */
const FAILURE_CLAUSE = new RegExp(`${EDGE_START}(?:${FAILURE_WORDS})\\s*[:=]([^\\n]*)`, 'giu')
/**
 * Từ đếm kèm số (S5): "3 cảnh báo", "Cảnh báo 2 dòng", "WARN 3 rows", "chênh 1.200.000đ", "NULL ở 7 dòng" là lỗi khi số khác 0. Số đứng
 * trước từ, hoặc sau từ (cách tối đa một từ ngắn như "ở").
 */
const COUNTED = '(?:cảnh\\s+báo|warn(?:ing)?s?|chênh|null(?:s)?|thừa|hết\\s+hạn)'
const NUMBER = '\\d[\\d.,]*'
const COUNTED_BEFORE = new RegExp(`${EDGE_START}(${NUMBER})\\s*(?:đ|%)?\\s+${COUNTED}${EDGE_END}`, 'giu')
const COUNTED_AFTER = new RegExp(`${EDGE_START}${COUNTED}(?:\\s+\\p{L}{1,3})?\\s*[:=]?\\s*(${NUMBER})`, 'giu')
/** Tỷ lệ "N/M" (không nằm trong đường dẫn hay ngày nhiều đoạn): N nhỏ hơn M là còn thiếu. */
const RATIO = /(?<![\d/.,])(\d+)\s*\/\s*(\d+)(?![\d/])/gu
/** Tỷ lệ bằng chữ "N trên M", "N of M", "N out of M" (vòng rà soát 3). */
const RATIO_WORDS = new RegExp(`${EDGE_START}(\\d+)\\s+(?:trên|of|out\\s+of)\\s+(\\d+)${EDGE_END}`, 'giu')
/**
 * Phủ định đứng trước từ lỗi (S5, d): "không có lỗi", "không thiếu", "no errors", "không có dòng sai lệch", "không tìm thấy lỗi nào" không
 * phải lỗi; bỏ trước khi tìm dấu hiệu lỗi.
 */
const NEGATED_FAILURE = new RegExp(
  `${EDGE_START}(?:không|chẳng|no|without|zero)\\s+(?:có\\s+|thấy\\s+|phát\\s+hiện\\s+|tìm\\s+thấy\\s+)?(?:(?:dòng|bản\\s+ghi|kết\\s+quả|mã|bất\\s+kỳ|any)\\s+)*(?:nào\\s+)?(?:bị\\s+)?(?:${FAILURE_WORDS}|not\\s+match(?:es|ed)?|khác\\s+biệt|không\\s+đúng)${EDGE_END}`,
  'giu',
)

/** Số khác 0: có chữ số khác 0 (kể cả "1.200.000" và "0,3"). */
function hasNonZero(number: string): boolean {
  return /[1-9]/.test(number)
}

/** Một vế sau từ chỉ số lỗi có số khác 0 (số thập phân như 0.5 cũng khác 0). */
function nonZero(clause: string): boolean {
  return [...clause.matchAll(/\d[\d.,]*/gu)].some(match => hasNonZero(match[0]))
}

/** Output của lệnh kiểm riêng có dấu hiệu lỗi (0.7.5): dấu hiệu chung của trình chạy, hay dấu hiệu tiếng Việt và tiếng Anh. */
function customFailed(output: string): boolean {
  const original = output.normalize('NFC')
  if (COMPLETE_FAIL.some(pattern => pattern.test(original))) return true
  if (FALSE_RESULT.test(original) || EXPECTED_GOT.test(original)) return true
  const text = original.replace(NEGATED_FAILURE, ' ').replace(ZERO_UNIT_FAILURES, ' ')
  if ([...text.matchAll(FAILURE_CLAUSE)].some(match => nonZero(match[1] ?? ''))) return true
  if ([...text.matchAll(COUNTED_BEFORE)].some(match => hasNonZero(match[1] ?? ''))) return true
  if ([...text.matchAll(COUNTED_AFTER)].some(match => hasNonZero(match[1] ?? ''))) return true
  const cleaned = text.replace(ZERO_FAILURES, ' ')
  if (CUSTOM_FAILED.test(cleaned) || CROSS_MARK.test(cleaned)) return true
  return [...cleaned.matchAll(RATIO), ...cleaned.matchAll(RATIO_WORDS)].some(match => Number(match[1]) < Number(match[2]))
}

/**
 * Dòng tổng kết chặt (S5, b): cả dòng chỉ là một dấu hiệu đạt (OK, PASS, PASSED, ALL PASS, ĐẠT, KHỚP, hợp lệ, 0 lỗi), có thể kèm tiền
 * tố nhãn (Kết quả:, Tổng kết, Done, Kiểm xong:, Tổng:) và số N/N đứng trước hoặc sau; không có chữ nào khác.
 */
const SUMMARY_LINE = new RegExp(
  '^\\s*' +
    '(?:(?:kết\\s+quả|ket\\s+qua|result|results|status|tổng\\s+kết|tổng\\s+hợp|tổng|summary|done|xong|kiểm\\s+xong|hoàn\\s+tất|finished)\\s*[:\\-]?\\s*)?' +
    '(?:\\d+\\s*\\/\\s*\\d+\\s*)?' +
    '(?:(?:all|tất\\s+cả)\\s+)?(?:(?:checks?|tests?)\\s+)?' +
    '(?:\\d+\\s+)?' +
    '(?:ok|pass(?:ed)?|passing|đạt|khớp|hợp\\s+lệ|0\\s+lỗi|0\\s+errors?|0\\s+failed|no\\s+errors?)' +
    '(?:\\s*[:\\-(]?\\s*\\d+\\s*\\/\\s*\\d+\\s*\\)?)?' +
    '\\s*[.]?\\s*$',
  'iu',
)

/** Dấu đạt U+2705, U+2713, U+2714 đứng đầu hay cuối dòng tổng kết (T5). */
const PASS_MARK = /^[\u2705\u2713\u2714]\s*|\s*[\u2705\u2713\u2714]$/gu
/** Viền "===" hay "---" hai bên dòng tổng kết (T5). */
const BORDER = /^[=-]{2,}\s*|\s*[=-]{2,}$/g
/** "PASSED in 2.1s", "120 passed in 3.2s" (T5); "0 passed" đã bị ranNothing (T4) chặn trước khi tới đây. */
const PASSED_IN = /^(?:\d+\s+)?passed\s+in\s+\d+(?:[.,]\d+)?\s*m?s$/iu
/** Nhãn ngắn trước dấu hai chấm ("K4: ĐẠT"): tối đa 4 từ, không có chữ phủ định hay chữ chỉ lỗi, bỏ qua (T5). */
const LABEL = /^([^:]{1,60}):\s*(.+)$/u
const LABEL_BLOCKED = /khong|chua|not|fail|skip/

/** Một dòng là dòng tổng kết đạt (S5, T5): bỏ viền, dấu đạt và nhãn ngắn rồi khớp chặt SUMMARY_LINE hay PASSED_IN. */
function isSummaryLine(line: string): boolean {
  const bare = line.replace(BORDER, '').replace(PASS_MARK, '').trim()
  if (PASSED_IN.test(bare)) return true
  if (COUNT_LINE.test(bare)) return /\d+\s+passed/iu.test(bare)
  if (SUMMARY_LINE.test(bare)) return true
  const labelled = LABEL.exec(bare)
  if (labelled === null) return false
  const label = (labelled[1] ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase()
  if (label.trim().split(/\s+/).length > 4 || LABEL_BLOCKED.test(label)) return false
  return isSummaryLine(labelled[2] ?? '')
}

/**
 * Dòng đếm kiểu trình chạy (T9): các mục "N passed", "N skipped", "N deselected", "N xfailed", "N xpassed" nối bằng dấu phẩy, có thể kèm
 * "in Ns", có mục passed ("0 skipped, 120 passed"; "0 passed" đã bị ranNothing chặn); số failed hay error khác 0 đã bị customFailed chặn.
 */
const COUNT_ITEM = '\\d+\\s+(?:passed|skipped|deselected|xfailed|xpassed)'
const COUNT_LINE = new RegExp(`^${COUNT_ITEM}(?:\\s*,\\s*${COUNT_ITEM})*(?:\\s+in\\s+\\d+(?:[.,]\\d+)?\\s*m?s)?$`, 'iu')

/** Dòng không rỗng cuối cùng của output; undefined khi không có. */
function lastLine(output: string): string | undefined {
  return output.normalize('NFC').split('\n').map(line => line.trim()).filter(line => line !== '').at(-1)
}

/**
 * Output của lệnh kiểm riêng qua ống không pipefail đạt (S5): không dòng nào có dấu hiệu lỗi và dòng không rỗng cuối cùng khớp chặt một
 * dòng tổng kết (SUMMARY_LINE).
 */
export function customPassed(output: string): boolean {
  if (customFailed(output)) return false
  const last = lastLine(output)
  return last !== undefined && isSummaryLine(last)
}

/**
 * Output không lỗi nhưng dòng cuối không phải dòng tổng kết (S5): mod nhắc một lần trong phiên dùng `set -o pipefail` hoặc in dòng
 * tổng kết.
 */
export function lacksSummary(output: string): boolean {
  return !customFailed(output) && !customPassed(output)
}

/**
 * Lệnh kiểm chạy mà không kiểm gì (T4, vòng rà soát 5): tỷ lệ N/M với M bằng 0 (0/0, 10/0, 00/00; T9), "Ran 0 tests", "0 passed", "0 tests",
 * "no tests ran" (hay were run, collected, found). Số 0 khớp theo ranh giới số: không có chữ số hay dấu thập phân đứng trước, nên "10/10",
 * "Ran 10", "100 tests" không khớp; số và từ đếm phải cùng dòng (T9: "Lệch: 0⏎PASS" không phải "0 pass").
 */
const RAN_NOTHING =
  /(?<![\d.,])\d+[ \t]*\/[ \t]*0+(?![\d/.,])|(?<![\p{L}\p{N}])ran[ \t]+0[ \t]+tests?(?![\p{L}\p{N}])|(?<![\d.,])0[ \t]+(?:pass(?:ed|es)?|tests?)(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])no[ \t]+tests?[ \t]+(?:ran|run|were[ \t]+run|collected|found)(?![\p{L}\p{N}])/iu
/** Dữ liệu rỗng đếm được (T9): "0 dòng", "0 bản ghi", "0 rows", "0 records" theo ranh giới số, sau khi bỏ số lỗi bằng 0 có đơn vị. */
const ZERO_DATA = new RegExp(`(?<![\\d.,])0[ \\t]+${DATA_UNIT}${EDGE_END}`, 'iu')
/**
 * Cả kết quả hay cả bảng rỗng (T9): "Rỗng:", "Trống:", "Không có dữ liệu" đầu dòng; "Bảng X trống", "dữ liệu rỗng", "kết quả rỗng",
 * "no data", "empty result". Một ô hay một cột trống ("0 ô trống", "Số ô trống: 0") không tính.
 */
const EMPTY_WHOLE = [
  /^[ \t]*(?:rỗng|trống|empty)[ \t]*:/giu,
  /^[ \t]*(?:không[ \t]+có[ \t]+dữ[ \t]+liệu)(?![\p{L}\p{N}])/giu,
  /(?<![\p{L}\p{N}])(?:bảng|table)[ \t]+[^\s:]+(?:[ \t]+[^\s:]+)?[ \t]+(?:is[ \t]+)?(trống|rỗng|empty)(?![\p{L}\p{N}])/giu,
  /(?<![\p{L}\p{N}])(?:dữ[ \t]+liệu|kết[ \t]+quả|results?|output|dataset)[ \t]+(?:is[ \t]+)?(rỗng|trống|empty)(?![\p{L}\p{N}])/giu,
  /(?<![\p{L}\p{N}])(?:no[ \t]+data|empty[ \t]+(?:results?|output|table|dataset))(?![\p{L}\p{N}])/giu,
]
/**
 * Không có bản ghi hay kết quả nào (0.7.6 V1): dữ liệu rỗng, trừ khi theo sau là từ chỉ lỗi ("Không có bản ghi nào bị thiếu" là số lỗi
 * bằng 0).
 */
const NO_ROWS = new RegExp(
  `${EDGE_START}không\\s+có\\s+(?:bản\\s+ghi|kết\\s+quả)\\s+nào${EDGE_END}(?![ \\t]+(?:bị[ \\t]+)?(?:${FAILURE_WORDS})${EDGE_END})`,
  'iu',
)
/** Phủ định hay số 0 trong 3 từ đứng trước dấu hiệu rỗng ("không có ô trống", "0 empty"): không phải dữ liệu rỗng (T9). */
const EMPTY_NEGATED = /(?:^|[^\p{L}\p{N}])(?:không|no|0)(?![\p{L}\p{N}])/iu

/**
 * Một dấu hiệu rỗng của dòng là thật (T9): không có phủ định hay số 0 trong 3 từ đứng trước chữ rỗng (với "Bảng X trống" là 3 từ trước
 * "trống", để "Bảng K4 không trống" không tính), không có ": 0" ngay sau.
 */
function isWholeEmpty(line: string): boolean {
  for (const pattern of EMPTY_WHOLE) {
    for (const match of line.matchAll(pattern)) {
      const at = match.index ?? 0
      const word = match[1] ?? ''
      const before = line.slice(0, at).trim().split(/\s+/).filter(Boolean).slice(-3).join(' ')
      // Phần giữa đầu cụm và chữ rỗng ("Bảng K4 không trống": "Bảng K4 không").
      const inner = match[0].slice(0, match[0].length - word.length)
      const after = line.slice(at + match[0].length)
      if (EMPTY_NEGATED.test(before) || (word !== '' && EMPTY_NEGATED.test(inner)) || /^[ \t]*:[ \t]*0(?![\d.,])/u.test(after)) continue
      return true
    }
  }
  return false
}
/** Số đếm bỏ qua ("120 skipped", "skipped 120", "skipped: 3"): bỏ đi rồi xem output còn số đếm nào khác không. */
const SKIPPED_COUNT = /(?<![\p{L}\p{N}])\d[\d.,]*\s+skip(?:ped|s)?(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])skip(?:ped|s)?\s*[:=]?\s*\d[\d.,]*/giu
const SKIPPED_ANY = new RegExp(SKIPPED_COUNT.source, 'iu')

/** Output của lệnh kiểm cho thấy không có phép kiểm nào chạy: số 0 ở trên, hay số đếm duy nhất là skipped (T4). */
export function ranNothing(output: string): boolean {
  const text = output.normalize('NFC')
  if (RAN_NOTHING.test(text)) return true
  if (ZERO_DATA.test(text.replace(ZERO_UNIT_FAILURES, ' ').replace(ZERO_EMPTY, ' '))) return true
  if (NO_ROWS.test(text)) return true
  if (text.split('\n').some(isWholeEmpty)) return true
  if (!SKIPPED_ANY.test(text)) return false
  return !/[1-9]/.test(text.replace(SKIPPED_COUNT, ' '))
}

/**
 * Một lệnh kiểm tra trong tool call có đạt không. Mã thoát bị che (ống, ;, || đứng sau) thì mã thoát 0 không nói gì
 * về lệnh kiểm tra: chỉ đạt khi output có dấu hiệu đạt rõ và không có dấu hiệu lỗi; không đủ thông tin thì chưa đạt.
 * Lệnh khai trong checkCommands qua tail hay head (0.7.5): có `set -o pipefail` thì mã thoát 0 và không có dấu hiệu lỗi
 * là đạt; không có thì dòng không rỗng cuối cùng phải có dấu hiệu đạt rõ và cả output không có dấu hiệu lỗi (customPassed). head cắt output (đủ số dòng giữ)
 * thì lệnh kiểm có thể đã bị ngắt giữa chừng: không đạt khi không có pipefail.
 */
export function checkEffectPassed(effect: CheckEffect, observation: ToolObservation): boolean {
  if (!effect.trusted || observation.isError || outputFailed(observation.output)) return false
  // Đạt mà không kiểm gì (T4) không đạt, ở mọi đường, cả khi mã thoát 0.
  if (observation.output !== undefined && ranNothing(observation.output)) return false
  if (effect.exit === 'visible') return true
  if (effect.exit !== 'filtered') return false
  const isCustom = isCustomCheck(effect.segment) || (effect.resolved !== undefined && isCustomCheck(effect.resolved))
  if (isCustom && effect.pipefail === true) return !customFailed(observation.output ?? '')
  if (observation.output === undefined) return false
  const isCut = effect.filter === 'head' && observation.output.replace(/\n+$/, '').split('\n').length >= (effect.limit ?? 0)
  if (isCut) return false
  const runner = runnerOf(effect.segment)
  if (runner !== null) return completePass(observation.output, runner, { truncated: effect.filter === 'tail' })
  return isCustom && customPassed(observation.output)
}
