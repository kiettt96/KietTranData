// Nhận diện lệnh kiểm tra: bảng trình chạy (tên trần, dạng bọc), kiểm tĩnh, lệnh riêng của dự án (checkCommands) và lệnh tự sửa.
// Chuyển từ hooks/lib/drift.ts (tách theo tầng, không đổi hành vi lúc tách; 0.5.5 đổi isSelfFixing để xét token ở dạng shell thật sự chạy); hooks/lib/drift.ts là barrel.

// Lệnh kiểm tra thật sự: bắt đầu một đoạn lệnh bằng một trình chạy test, lint,
// type-check hay build. Không khớp theo chữ rời ("test", "check") ở giữa lệnh,
// kẻo `ls tests/`, `cat test.txt` hay `echo check` bị tính là kiểm tra.
//
// Công cụ chạy bằng tên trần. CHỈ tên trong danh sách này mới được bọc (npx, pnpm exec, uv run...): phần bọc không
// bao giờ tự biến một lệnh thành lệnh kiểm tra, nên `pnpm add x`, `yarn install`, `bunx create-x` vẫn là ghi.
const CHECK_TOOLS = 'tsc|pytest|jest|vitest|mocha|eslint|ruff|mypy|flake8|pyright|biome|stylelint|rspec|phpunit|shellcheck|tox'
const TEST_TOOLS = 'pytest|jest|vitest|mocha|rspec|phpunit|tox'
// Dạng bọc đã biết, danh tính giữ nguyên tiền tố (`pnpm exec tsc -p x` khác `tsc -p x`).
const WRAP =
  '(?:npx\\s+(?:-\\S+\\s+)*|(?:pnpm|yarn)\\s+(?:exec\\s+)?|bunx\\s+|uv\\s+run\\s+|poetry\\s+run\\s+|bundle\\s+exec\\s+|\\./node_modules/\\.bin/)?'
const VERIFY_SEGMENT = new RegExp(
  '^(?:' +
    '(?:npm|pnpm|yarn|bun)\\s+(?:run\\s+)?(?:-\\S+\\s+)*(?:test|tests|lint|typecheck|type-check|build|check|validate|verify|format:check)\\b|' +
    `${WRAP}(?:${CHECK_TOOLS})\\b|` +
    // Kiểm định dạng chỉ là lệnh kiểm khi có cờ chỉ-kiểm; thiếu cờ thì lệnh ghi file.
    `${WRAP}(?:prettier|black)\\b(?=.*\\s--check\\b)|` +
    'cargo\\s+fmt\\b(?=.*--check\\b)|' +
    'terraform\\s+(?:fmt\\b(?=.*\\s-check\\b)|validate\\b)|' +
    'node\\s+--test\\b|' +
    `${WRAP}python3?\\s+-m\\s+(?:pytest|unittest|mypy|ruff)\\b|` +
    'cargo\\s+(?:test|check|clippy|build)\\b|' +
    'go\\s+(?:test|vet|build)\\b|' +
    'make\\s+(?:test|check|lint|build)\\b|' +
    'claude\\s+plugin\\s+(?:test|validate)\\b|' +
    'deno\\s+test\\b|swift\\s+test\\b|' +
    'dotnet\\s+(?:test|build)\\b|' +
    'mvn\\s+(?:test|verify)\\b|' +
    '\\./mvnw\\s+(?:test|verify)\\b|' +
    'gradle\\s+(?:test|check|build)\\b|' +
    '\\./gradlew\\s+(?:test|check)\\b' +
    ')',
)

// Lệnh kiểm tra chạy test (hành vi) chứ không chỉ kiểm tĩnh (type-check, lint, build, validate).
export const TEST_SEGMENT = new RegExp(
  '^(?:' +
    '(?:npm|pnpm|yarn|bun)\\s+(?:run\\s+)?(?:-\\S+\\s+)*(?:test|tests|verify)\\b|' +
    `${WRAP}(?:${TEST_TOOLS})\\b|` +
    'node\\s+--test\\b|' +
    `${WRAP}python3?\\s+-m\\s+(?:pytest|unittest)\\b|` +
    'cargo\\s+test\\b|go\\s+test\\b|make\\s+test\\b|claude\\s+plugin\\s+test\\b|' +
    'deno\\s+test\\b|swift\\s+test\\b|' +
    'dotnet\\s+test\\b|mvn\\s+(?:test|verify)\\b|\\./mvnw\\s+(?:test|verify)\\b|gradle\\s+test\\b|\\./gradlew\\s+test\\b' +
    ')',
)

// Lệnh kiểm tra riêng của dự án (option checkCommands): tiền tố token, tính là kiểm tra chạy hành vi, danh tính nghiêm ngặt.
// Token khai đã chuẩn hóa python (normalizePython) và hạ chữ thường. Token kết thúc bằng "/" là tiền tố thư mục.
let customChecks: string[][] = []

/** Trình thông dịch python theo tên cuối của token đầu: `python`, `python3`, `python3.11` (không phân biệt thư mục). */
const PYTHON_INTERPRETER = /^python(?:3(?:\.\d+)?)?$/
/** Cờ của python không nhận giá trị và không đổi nghĩa lệnh sau nó; `-c`, `-m`, `-W`, `-X` không nằm đây (đổi nghĩa lệnh). */
const PYTHON_PLAIN_FLAGS = new Set(['-B', '-u', '-I', '-E', '-s', '-S', '-O', '-OO', '-q'])
/** Đoạn `..` trong đường dẫn: tiền tố thư mục không được chui ra ngoài thư mục đã khai. */
const PARENT_SEGMENT = /(?:^|\/)\.\.(?:\/|$)/

/**
 * Chuẩn hóa token lệnh khi token đầu là trình thông dịch python (0.7.3): bỏ phần thư mục (`/usr/bin/python3` thành
 * `python3`) và các cờ không nhận giá trị đứng ngay sau nó (`-B`, `-u`...), để `/usr/bin/python3 -B tests/a.py` và
 * `python3 tests/a.py` là một lệnh. Lệnh khác (script tự chạy như `./scripts/check.sh`, `mytool`) giữ nguyên; `python3.11`
 * giữ tên. Phải gọi TRƯỚC khi hạ chữ thường: `-B` và `-b` là hai cờ khác nhau. Dùng chung cho phân loại lệnh, đọc evidence
 * và danh tính lệnh (identity.ts), nên không phía nào nhận mà phía kia từ chối.
 */
export function normalizePython(tokens: string[]): string[] {
  const head = tokens[0]
  if (head === undefined) return tokens
  const name = head.slice(head.lastIndexOf('/') + 1)
  if (!PYTHON_INTERPRETER.test(name)) return tokens
  let at = 1
  while (at < tokens.length && PYTHON_PLAIN_FLAGS.has(tokens[at] ?? '')) at += 1
  return [name, ...tokens.slice(at)]
}

const lowerTokens = (tokens: string[]): string[] => normalizePython(tokens).map(token => token.toLowerCase())

/** Đọc option checkCommands: lệnh phân tách bằng dấu phẩy, mỗi lệnh tách theo khoảng trắng; mục rỗng bị bỏ. */
export function parseCheckCommands(raw: unknown): string[][] {
  if (typeof raw !== 'string') return []
  return raw
    .split(',')
    .map(item => item.trim().split(/\s+/).filter(Boolean))
    .filter(tokens => tokens.length > 0)
}

/** Áp danh sách lệnh kiểm tra riêng cho lần nạp mod này; danh sách rỗng là bỏ hết. */
export function applyCheckCommands(commands: string[][]): void {
  customChecks = commands.map(tokens => lowerTokens(tokens))
}

/** Token khai khớp token thật: so nguyên token, trừ token khai kết thúc bằng "/" (tiền tố thư mục, không chứa `..`). */
function matchesToken(declared: string, actual: string | undefined): boolean {
  if (actual === undefined) return false
  return declared.endsWith('/') ? actual.startsWith(declared) && !PARENT_SEGMENT.test(actual) : actual === declared
}

/** Đoạn lệnh bắt đầu bằng đúng các token của một lệnh riêng (không phân biệt hoa thường, như phía claim của evidence). */
export function isCustomCheck(text: string): boolean {
  const tokens = lowerTokens(text.trim().split(/\s+/).filter(Boolean))
  return customChecks.some(command => command.length > 0 && command.every((token, at) => matchesToken(token, tokens[at])))
}

/**
 * Đoạn lệnh (đã bỏ biến môi trường) là một lệnh kiểm tra, theo bảng trình chạy kèm mod hoặc lệnh riêng của dự án. `text` là
 * bản đã hạ chữ thường cho bảng trình chạy; `original` là bản giữ chữ (mặc định như `text`) cho lệnh riêng, vì chuẩn hóa
 * cờ python phân biệt `-B` và `-b`.
 */
export function isCheckText(text: string, original: string = text): boolean {
  return VERIFY_SEGMENT.test(text) || isCustomCheck(original)
}

// Cờ cho công cụ kiểm tra sửa file ngay trong lúc chạy. `--fix-dry-run` (token khác) chỉ xem trước nên không nằm đây.
const FIX_FLAGS = new Set(['--fix', '--write', '--apply', '--apply-unsafe', '--fix-only'])
const PACKAGE_RUNNERS = new Set(['npm', 'pnpm', 'yarn', 'bun'])
/** Token chỉ gồm một chuỗi trong nháy đã che (xem maskCommand ở classify.ts). */
const WHOLE_QUOTED = /^\u0000\d+\u0000$/

/**
 * Đoạn lệnh vừa kiểm vừa sửa file: cờ tự sửa, `prettier -w`, `ruff format` không kèm `--check` hay `--diff`, script
 * `*:fix` hoặc `format`. Lệnh đó là tác động ghi (mức possible), không phải lệnh kiểm tra. `tokens` là token của đoạn đã
 * che chuỗi trong nháy, `unmask` trả token về dạng shell thật sự chạy (shell bỏ nháy: `eslint "--fix"` là `eslint --fix`).
 * Ngoại lệ: token nháy trọn vẹn đứng ngay sau một tùy chọn không có `=` là giá trị của tùy chọn đó, không phải cờ
 * (`pytest -k '--fix'`), trừ dấu `--` (hết tùy chọn, `npm run lint -- "--fix"` vẫn truyền `--fix`). Mod không biết tùy chọn nào không nhận giá trị nên `eslint --quiet "--fix"` vẫn bị bỏ sót.
 */
export function isSelfFixing(tokens: string[], unmask: (token: string) => string = token => token): boolean {
  const words: string[] = []
  tokens.forEach((token, at) => {
    const before = tokens[at - 1]
    const isOptionValue = WHOLE_QUOTED.test(token) && before !== undefined && before !== '--' && before.startsWith('-') && !before.includes('=')
    if (!isOptionValue) words.push(unmask(token))
  })
  if (words.some(word => FIX_FLAGS.has(word) || word.startsWith('--fix='))) return true
  if (words.includes('prettier') && words.includes('-w')) return true
  const ruff = words.indexOf('ruff')
  if (ruff >= 0 && words[ruff + 1] === 'format') return !words.includes('--check') && !words.includes('--diff')
  const manager = words.findIndex(word => PACKAGE_RUNNERS.has(word))
  if (manager < 0) return false
  const script = words.slice(manager + 1).find(word => !word.startsWith('-') && word !== 'run' && word !== 'run-script')
  return script !== undefined && (/(?:^|:)fix$/.test(script) || script === 'format' || script === 'fmt')
}

export type CheckKind = 'test' | 'static'
