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
/** Chữ phủ định đứng ngay trước một dấu hiệu đạt: "chưa đạt", "không OK", "not ok" không phải đạt. */
const NEGATED = '(?<![\\p{L}\\p{N}])(?:chưa|chẳng|không|đừng|not|no|never)\\s*'
/**
 * Dấu hiệu lỗi: KHÔNG ĐẠT, KHÔNG KHỚP, CHƯA ĐẠT, CHƯA KHỚP, KHÔNG HỢP LỆ, LỖI, SAI, THIẾU, LỆCH (gồm CHÊNH LỆCH), FAIL, ERROR, MISMATCH
 * (lỗi thắng dấu hiệu đạt). Thêm ở vòng sửa 2 của 0.7.5: chưa đạt, chưa khớp, thiếu, lệch, chênh lệch, không hợp lệ, mismatch, error.
 */
const CUSTOM_FAILED = new RegExp(
  `${EDGE_START}(?:không\\s+đạt|không\\s+khớp|không\\s+hợp\\s+lệ|chưa\\s+(?:đạt|khớp|ok)|not\\s+ok|lỗi|sai|thiếu|lệch|mismatch(?:es|ed)?|errors?|fail(?:ed|ures?)?)${EDGE_END}`,
  'iu',
)
/** Dấu ✗ và ✘ đứng riêng không có ranh giới chữ. */
const CROSS_MARK = /[\u2717\u2718]/u
/** Dấu hiệu đạt rõ: ĐẠT, KHỚP, OK, PASS, passed, 0 lỗi, 0 failed; không nằm sau chữ phủ định. */
const CUSTOM_PASSED = new RegExp(`${EDGE_START}(?<!${NEGATED})(?:đạt|khớp|ok|pass(?:ed)?|passing|0\\s+lỗi|0\\s+failed|0\\s+errors?)${EDGE_END}`, 'iu')
/** Số lỗi bằng 0 ("0 lỗi", "FAIL: 0", "Thiếu: 0") không phải dấu hiệu lỗi: bỏ trước khi tìm dấu hiệu lỗi. */
const FAILURE_WORDS = 'lỗi|sai|thiếu|lệch|mismatch(?:es)?|fail(?:ed|ures?)?|errors?'
const ZERO_FAILURES = new RegExp(
  `${EDGE_START}0\\s+(?:${FAILURE_WORDS})${EDGE_END}|${EDGE_START}(?:${FAILURE_WORDS})\\s*[:=]\\s*0${EDGE_END}`,
  'giu',
)
/** Tỷ lệ "N/M" (không nằm trong đường dẫn hay ngày nhiều đoạn): N nhỏ hơn M là còn thiếu. */
const RATIO = /(?<![\d/.,])(\d+)\s*\/\s*(\d+)(?![\d/])/gu

/** Output của lệnh kiểm riêng có dấu hiệu lỗi (0.7.5): dấu hiệu chung của trình chạy, hay dấu hiệu tiếng Việt. */
function customFailed(output: string): boolean {
  const text = output.normalize('NFC')
  if (COMPLETE_FAIL.some(pattern => pattern.test(text))) return true
  const cleaned = text.replace(ZERO_FAILURES, ' ')
  if (CUSTOM_FAILED.test(cleaned) || CROSS_MARK.test(cleaned)) return true
  return [...cleaned.matchAll(RATIO)].some(match => Number(match[1]) < Number(match[2]))
}

/**
 * Output của lệnh kiểm riêng qua ống không pipefail đạt: dòng không rỗng cuối cùng có dấu hiệu đạt rõ đứng riêng (không sau chữ
 * phủ định) và toàn bộ phần đầu ra còn thấy không có dấu hiệu lỗi (0.7.5, siết ở vòng sửa 2).
 */
export function customPassed(output: string): boolean {
  if (customFailed(output)) return false
  const last = output.normalize('NFC').split('\n').map(line => line.trim()).filter(line => line !== '').at(-1)
  return last !== undefined && CUSTOM_PASSED.test(last)
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
