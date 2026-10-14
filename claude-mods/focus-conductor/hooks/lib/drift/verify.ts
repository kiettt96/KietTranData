// Nhận diện lệnh kiểm tra: bảng trình chạy (tên trần, dạng bọc), kiểm tĩnh, lệnh riêng của dự án (checkCommands) và lệnh tự sửa.
// Chuyển nguyên văn từ hooks/lib/drift.ts (tách theo tầng, không đổi hành vi); hooks/lib/drift.ts là barrel.

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
let customChecks: string[][] = []

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
  customChecks = commands.map(tokens => [...tokens])
}

/** Đoạn lệnh bắt đầu bằng đúng các token của một lệnh riêng (không phân biệt hoa thường, như phía claim của evidence). */
export function isCustomCheck(text: string): boolean {
  const tokens = text.trim().split(/\s+/).map(token => token.toLowerCase())
  return customChecks.some(command => command.length > 0 && command.every((token, at) => tokens[at] === token.toLowerCase()))
}

/** Đoạn lệnh (đã bỏ biến môi trường) là một lệnh kiểm tra, theo bảng trình chạy kèm mod hoặc lệnh riêng của dự án. */
export function isCheckText(text: string): boolean {
  return VERIFY_SEGMENT.test(text) || isCustomCheck(text)
}

// Cờ cho công cụ kiểm tra sửa file ngay trong lúc chạy. `--fix-dry-run` (token khác) chỉ xem trước nên không nằm đây.
const FIX_FLAGS = new Set(['--fix', '--write', '--apply', '--apply-unsafe', '--fix-only'])
const PACKAGE_RUNNERS = new Set(['npm', 'pnpm', 'yarn', 'bun'])

/**
 * Đoạn lệnh vừa kiểm vừa sửa file: cờ tự sửa, `prettier -w`, `ruff format` không kèm `--check` hay `--diff`, script
 * `*:fix` hoặc `format`. Lệnh đó là tác động ghi (mức possible), không phải lệnh kiểm tra. `tokens` là token của đoạn đã
 * che chuỗi trong nháy: cờ nằm trong nháy (`pytest -k '--fix'`) là đối số, không tính.
 */
export function isSelfFixing(tokens: string[]): boolean {
  const words = tokens.filter(token => !token.includes('\u0000'))
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
