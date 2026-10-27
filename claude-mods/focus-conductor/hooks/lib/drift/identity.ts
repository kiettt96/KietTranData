// Danh tính của một lệnh kiểm tra: chuẩn hóa argv theo trình chạy để so khớp nghiêm ngặt giữa lệnh đã chạy và lệnh được nhắc.
// Chuyển nguyên văn từ hooks/lib/drift.ts (tách theo tầng, không đổi hành vi); hooks/lib/drift.ts là barrel.

import { TAG } from './classify'
import { runnerOf } from './output'
import type { Runner } from './output'
import type { EvidenceEntry } from './evidence'
import { segments } from './readonly'
import { normalizePython } from './verify'

const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun'])
/** Cờ của npx về cài và giải quyết gói, chuẩn hóa alias thật: `-y` là `--yes`; `--no-install` là tên cũ của `--no`. */
const NPX_FLAGS: Record<string, string> = { '-y': '--yes', '--yes': '--yes', '--no': '--no', '--no-install': '--no' }
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
/** Token gán biến môi trường, kể cả dạng có nháy đã đóng gói (`\u0001NAME=giá trị có khoảng trắng\u0001`). */
export const isEnvToken = (token: string) => ENV_ASSIGNMENT.test(token.startsWith(TAG) ? token.slice(1) : token)

/** Tên executable đã biết: chỉ những tên này được hạ chữ thường (viết hoa đầu câu vẫn là cùng lệnh). */
const EXECUTABLES = new Set([
  'npm', 'pnpm', 'yarn', 'bun', 'npx', 'node', 'tsc', 'pytest', 'jest', 'vitest', 'mocha', 'eslint', 'ruff', 'mypy', 'flake8',
  'pyright', 'biome', 'stylelint', 'python', 'python3', 'cargo', 'go', 'make', 'claude', 'dotnet', 'mvn', 'gradle',
])
/** Từ khóa lệnh con theo ngữ pháp từng executable: [vị trí tính từ tên lệnh, các từ khóa]. Tên script, target, đối số giữ chữ. */
const SUBCOMMANDS: Record<string, Array<[number, string[]]>> = {
  npm: [[1, ['run', 'run-script', 'test', 't']]],
  pnpm: [[1, ['run', 'run-script', 'test', 't']]],
  yarn: [[1, ['run', 'run-script', 'test', 't']]],
  bun: [[1, ['run', 'test']]],
  go: [[1, ['test', 'vet', 'build']]],
  cargo: [[1, ['test', 'check', 'clippy', 'build']]],
  claude: [[1, ['plugin']], [2, ['test', 'validate']]],
  dotnet: [[1, ['test', 'build']]],
  mvn: [[1, ['test', 'verify']]],
  gradle: [[1, ['test', 'check', 'build']]],
}
/** Module chạy qua `python -m`, ở vị trí 2. */
const PYTHON_MODULES = ['pytest', 'unittest', 'mypy', 'ruff']

/** Cờ nhận giá trị và chấp nhận cả `--cờ=giá-trị` lẫn `--cờ giá-trị`, theo từng trình chạy. Cờ khác giữ nguyên một token. */
const VALUE_FLAGS: Partial<Record<Runner, string[]>> = {
  node: ['--test-name-pattern', '--test-skip-pattern', '--test-reporter'],
  go: ['-run', '-skip', '-count'],
  pytest: ['-k', '-m', '--tb'],
  vitest: ['--reporter'],
  mocha: ['--reporter'],
}

/**
 * Tùy chọn chỉ đổi cách trình bày output, theo từng trình chạy, khớp tên chính xác: null là cờ không nhận giá trị,
 * 'value' là cờ nhận một giá trị. Mọi cờ khác (kể cả `--test`, `--`, `-run`, `-k`, `--test-name-pattern`, `-count`,
 * cờ lạ) là một phần danh tính lệnh.
 */
const PRESENTATION_FLAGS: Partial<Record<Runner, Record<string, 'value' | null>>> = {
  node: { '--test-reporter': 'value' },
  go: { '-v': null },
  pytest: { '-v': null, '-q': null, '--tb': 'value' },
  vitest: { '--reporter': 'value' },
  mocha: { '--reporter': 'value' },
  jest: { '--verbose': null },
}

const isTagged = (token: string) => token.startsWith(TAG)

/** Hạ chữ thường theo ngữ pháp: tên executable đã biết và từ khóa lệnh con ở đúng vị trí; mọi token khác giữ nguyên. */
function canonicalCase(tokens: string[]): string[] {
  const out = [...tokens]
  const name = (out[0] ?? '').toLowerCase()
  if (isTagged(out[0] ?? '') || !EXECUTABLES.has(name)) return out
  out[0] = name
  const lowerAt = (index: number, keywords: string[]) => {
    const token = (out[index] ?? '').toLowerCase()
    if (!isTagged(out[index] ?? '') && keywords.includes(token)) out[index] = token
  }
  for (const [index, keywords] of SUBCOMMANDS[name] ?? []) lowerAt(index, keywords)
  if ((name === 'python' || name === 'python3') && out[1] === '-m') lowerAt(2, PYTHON_MODULES)
  return out
}

/**
 * Chuẩn hóa dãy token của một lệnh theo trình chạy: tách `--cờ=giá-trị` chỉ với cờ đã biết nhận giá trị, bỏ cờ trình
 * bày của đúng trình chạy đó (kèm giá trị). Sau `--` (và `-args` của go) mọi token giữ nguyên.
 */
function normalizeTokens(tokens: string[], runner: Runner | null): string[] {
  const values = runner === null ? [] : (VALUE_FLAGS[runner] ?? [])
  const flags = runner === null ? {} : (PRESENTATION_FLAGS[runner] ?? {})
  const split: Array<{ token: string; pass: boolean }> = []
  let pass = false
  for (const token of tokens) {
    const eq = token.indexOf('=')
    if (!pass && !isTagged(token) && eq > 0 && values.includes(token.slice(0, eq))) {
      split.push({ token: token.slice(0, eq), pass }, { token: token.slice(eq + 1), pass })
      continue
    }
    split.push({ token, pass })
    if (token === '--' || (runner === 'go' && token === '-args')) pass = true
  }
  const out: string[] = []
  for (let i = 0; i < split.length; i++) {
    const entry = split[i]
    if (entry === undefined) continue
    if (!entry.pass && Object.hasOwn(flags, entry.token)) {
      if (flags[entry.token] === null) continue
      const value = split[i + 1]
      if (value !== undefined && !value.pass) {
        i += 1
        continue
      }
    }
    out.push(entry.token)
  }
  return out
}

/**
 * Chuẩn hóa argv thành tiền tố danh tính (biến môi trường, `npx` cùng cờ npx đã chuẩn hóa alias) và các token lệnh. Dùng chung
 * cho lệnh đã chạy và evidence. `runner` cho trước (evidence dùng trình chạy của lần chạy đang so) thay cho việc suy từ token.
 */
export function normalizeArgv(argv: string[], runner?: Runner | null): { prefix: string[]; words: string[]; runner: Runner | null } {
  let at = 0
  const prefix: string[] = []
  while (at < argv.length && isEnvToken(argv[at] ?? '')) prefix.push(argv[at++] ?? '')
  if (!isTagged(argv[at] ?? '') && (argv[at] ?? '').toLowerCase() === 'npx') {
    prefix.push('npx')
    at += 1
    while (Object.hasOwn(NPX_FLAGS, argv[at] ?? '')) prefix.push(NPX_FLAGS[argv[at++] ?? ''] ?? '')
  }
  const tokens = canonicalCase(normalizePython(argv.slice(at)))
  const resolved = runner === undefined ? runnerOf(tokens.join(' ')) : runner
  return { prefix, words: normalizeTokens(tokens, resolved), runner: resolved }
}

/** Các cách viết tương đương của lệnh quản lý gói: `npm test` và `npm run test` là một; `pnpm`/`yarn X` và `run X` là một. */
function packageForms(words: string[]): string[][] {
  const [name, sub, ...rest] = words
  if (name === undefined) return []
  // `pnpm exec X` và `pnpm dlx X` chạy X, không phải script tên exec hay dlx: không có dạng tương đương `run`.
  if (!PACKAGE_MANAGERS.has(name) || sub === undefined || sub.startsWith('-') || sub === 'exec' || sub === 'dlx') return [words]
  if (sub === 'run' || sub === 'run-script') {
    const [script, ...args] = rest
    if (script === undefined) return [[name, 'run']]
    const runForm = [name, 'run', script, ...args]
    return name === 'bun' || (name === 'npm' && script !== 'test') ? [runForm] : [runForm, [name, script, ...args]]
  }
  if (name === 'bun' || (name === 'npm' && sub !== 'test' && sub !== 't')) return [words]
  const script = sub === 't' ? 'test' : sub
  return [[name, 'run', script, ...rest], [name, script, ...rest]]
}

/** Danh tính của một lệnh (argv): các cách viết tương đương đã chuẩn hóa và trình chạy. */
function identityOf(argv: string[]): { forms: string[][]; runner: Runner | null } {
  const { prefix, words, runner } = normalizeArgv(argv)
  return { forms: packageForms(words).map(form => [...prefix, ...form]), runner }
}

/**
 * Danh tính của một đoạn lệnh (chuỗi, tách theo khoảng trắng): so khớp nghiêm ngặt. Chỉ tên executable và từ khóa lệnh
 * con được hạ chữ thường; đường dẫn, tên script, giá trị bộ lọc, đối số và tên cờ giữ nguyên chữ. Mọi tùy chọn là một
 * phần danh tính trừ cờ trình bày của đúng trình chạy; biến môi trường, `npx` cùng cờ npx là tiền tố danh tính.
 */
export function commandIdentity(segment: string): string[][] {
  return identityOf(segment.trim().split(/\s+/).filter(Boolean)).forms
}

/** Các danh tính của một lần chạy: lệnh kiểm tra dùng argv đã nhận biết cú pháp; lệnh khác tách chuỗi theo đoạn. */
export function entryIdentities(entry: EvidenceEntry): Array<{ forms: string[][]; runner: Runner | null }> {
  if (entry.argv !== undefined) return [identityOf(entry.argv)]
  return segments(entry.command).map(part => identityOf(part.split(/\s+/).filter(Boolean)))
}

/** Khóa gom các lần chạy của cùng một lệnh: cách viết đầu của danh tính, theo từng đoạn. */
export function identityKey(entry: EvidenceEntry): string {
  return entryIdentities(entry).map(identity => (identity.forms[0] ?? []).join(' ')).join(' && ')
}
