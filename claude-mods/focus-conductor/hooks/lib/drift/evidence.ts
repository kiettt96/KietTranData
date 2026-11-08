// Dấu vết thực thi của một mục tiêu: các lệnh đã chạy kèm kết quả thật, các lần ghi và file đã đụng tới.
// Chuyển nguyên văn từ hooks/lib/drift.ts (tách theo tầng, không đổi hành vi); hooks/lib/drift.ts là barrel.

import type { CheckKind } from './verify'
import { customKey, isCheckTool } from './verify'
import { FILE_TOOLS, filePathOf, isPlanFile, str } from './tool'
import type { ToolObservation } from './tool'
import { classifyBash } from './classify'
import type { BashEffect } from './classify'
import { writeEffects } from './effects'
import { isHardEffect, isSoftPath } from './soft'
import { checkEffectPassed, outputFailed, ranNothing, runnerOf } from './output'

// ------------------------------------------------------------ đối chiếu evidence

/**
 * Một lệnh Bash đã chạy trong mục tiêu: kết quả thật (ok: kiểm tra đạt, hoặc lệnh không lỗi khi không phải kiểm tra),
 * loại kiểm tra, thứ tự và tác giả ("main" hoặc id subagent).
 */
export type EvidenceEntry = {
  command: string
  /** Chỉ lệnh kiểm tra: danh tính (argv) và đoạn nguyên văn, để đối chiếu evidence và giải thích. */
  argv?: string[]
  raw?: string
  ok: boolean
  check: CheckKind | null
  seq: number
  author: string
  /** Lần kiểm qua tool MCP khai trong checkTools (0.7.9 Y4): chỉ lần gọi đạt cùng tool, cùng đầu vào mới phủ. */
  mcp?: true
  /** Lệnh kiểm nối && với lệnh khác, cả lệnh trả mã khác 0 (0.8.0 A11): kết quả chưa rõ, không lỗi cũng không đạt. */
  chained?: true
}

/**
 * Dấu vết thực thi của một mục tiêu, để đối chiếu evidence khi Claude ghi "verified": các lệnh Bash (kể cả lệnh lỗi),
 * file đã đụng tới, số thay đổi và thứ tự của thay đổi cuối cùng.
 */
export type EvidenceLog = {
  goalId: number
  seq: number
  /** Thứ tự của thay đổi thành công cuối cùng; -1 khi mục tiêu chưa có thay đổi. */
  lastMutation: number
  mutations: number
  /** Thay đổi chắc chắn vào file không nhẹ (0.8.0 A5), dùng cho cổng Y6: số lượng và thứ tự của lần cuối (-1 khi chưa có). */
  hard: number
  lastHard: number
  commands: EvidenceEntry[]
  /** Các lần ghi theo thứ tự và tác giả, để biết lần kiểm tra của một subagent phủ thay đổi của ai. */
  writes: Array<{ seq: number; author: string }>
  paths: string[]
}

/**
 * Trần của nhật ký lệnh (0.7.5): hai vùng có trần riêng trong cùng danh sách theo seq, lần chạy kiểm (check khác null) và
 * lệnh khác (kể cả lệnh chỉ đọc mà luật verified của việc chỉ tra cứu dựa vào). Vùng nào vượt trần thì bỏ mục cũ nhất của
 * chính vùng đó, nên trăm lệnh đọc không đẩy mất lần kiểm đạt và ngược lại.
 */
const EVIDENCE_CHECKS = 100
const EVIDENCE_OTHERS = 100
const EVIDENCE_PATHS = 200
const EVIDENCE_WRITES = 300

export function newEvidenceLog(goalId: number): EvidenceLog {
  return { goalId, seq: 0, lastMutation: -1, mutations: 0, hard: 0, lastHard: -1, commands: [], writes: [], paths: [] }
}

/**
 * Ghi một tool call vào dấu vết của mục tiêu theo đúng thứ tự hiệu ứng: lệnh kiểm tra kèm kết quả thật, các lần ghi
 * (kể cả trong lệnh Bash lỗi), và đường dẫn file. `author` là "main" hoặc id subagent.
 */
export function noteEvidence(log: EvidenceLog, observation: ToolObservation, author = 'main'): void {
  const onWrite = (isHard: boolean) => {
    log.seq += 1
    log.lastMutation = log.seq
    log.mutations += 1
    if (isHard) {
      log.hard += 1
      log.lastHard = log.seq
    }
    log.writes.push({ seq: log.seq, author })
    if (log.writes.length > EVIDENCE_WRITES) log.writes.shift()
  }
  const command = str(observation.input['command']).trim()
  if (observation.tool === 'Bash' && command !== '') {
    const classified = classifyBash(command, observation.cwd)
    const counted = new Set<BashEffect>(writeEffects(classified, observation.isReadOnly))
    let hasCheck = false
    for (const effect of classified.effects) {
      if (effect.kind === 'write') {
        if (counted.has(effect)) onWrite(isHardEffect(effect))
        continue
      }
      hasCheck = true
      log.seq += 1
      // Lệnh khai giải được đường dẫn (0.8.0 A1): lưu dạng đã giải, để chữ ký, coversFailure và danh tính so cùng một dạng.
      const resolved = effect.resolved
      log.commands.push({
        command: (resolved ?? effect.segment).slice(0, 500),
        argv: resolved !== undefined ? [...effect.argv.filter(token => /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)), ...resolved.split(/\s+/)] : effect.argv,
        raw: effect.raw.slice(0, 500),
        ok: checkEffectPassed(effect, observation),
        check: effect.check,
        seq: log.seq,
        author,
        ...(effect.exit === 'chained' && observation.isError ? { chained: true as const } : {}),
      })
    }
    if (!hasCheck) {
      log.seq += 1
      log.commands.push({ command: command.slice(0, 500), ok: !observation.isError, check: null, seq: log.seq, author })
    }
    trimCommands(log)
  } else if (isCheckTool(observation.tool)) {
    log.seq += 1
    log.commands.push({ command: checkToolCommand(observation.tool, observation.input), ok: checkToolPassed(observation), check: 'test', seq: log.seq, author, mcp: true })
    trimCommands(log)
  } else if (FILE_TOOLS.has(observation.tool) && !observation.isError && !isPlanFile(filePathOf(observation))) {
    onWrite(!isSoftPath(filePathOf(observation)))
  } else {
    log.seq += 1
  }
  if (observation.isError) return
  for (const key of ['file_path', 'notebook_path', 'path']) {
    const path = str(observation.input[key]).trim()
    if (path === '' || log.paths.includes(path)) continue
    log.paths.push(path)
    if (log.paths.length > EVIDENCE_PATHS) log.paths.shift()
  }
}

/** Bỏ mục cũ nhất của vùng vượt trần (lần chạy kiểm hay lệnh khác), giữ thứ tự seq của phần còn lại. */
function trimCommands(log: EvidenceLog): void {
  for (const [isCheck, limit] of [[true, EVIDENCE_CHECKS], [false, EVIDENCE_OTHERS]] as const) {
    let extra = log.commands.filter(c => (c.check !== null) === isCheck).length - limit
    while (extra > 0) {
      log.commands.splice(log.commands.findIndex(c => (c.check !== null) === isCheck), 1)
      extra -= 1
    }
  }
}

/**
 * Lần chạy TEST (hành vi, không phải kiểm tĩnh) đạt sau thay đổi cuối của mục tiêu và phủ mọi thay đổi (0.7.0): cơ sở để mod tự
 * nâng bước done thành verified. Mục tiêu chưa có sửa file (chỉ tra cứu) thì không có: lệnh test khi đó không chứng minh điều gì.
 */
export function freshTestRun(log: EvidenceLog): EvidenceEntry | undefined {
  if (log.mutations === 0) return undefined
  return [...log.commands].reverse().find(c => c.check === 'test' && c.ok && c.seq > log.lastMutation && covers(c, log))
}

/**
 * Lần kiểm tra này có phủ mọi thay đổi trước nó không: kiểm tra của luồng chính phủ tất cả; kiểm tra của subagent chỉ
 * phủ khi mọi thay đổi kể từ lần kiểm tra đạt gần nhất của luồng chính đều do chính subagent đó làm.
 */
export function covers(entry: EvidenceEntry, log: EvidenceLog): boolean {
  if (entry.author === 'main') return true
  const lastMain = log.commands
    .filter(c => c.author === 'main' && c.check !== null && c.ok && c.seq < entry.seq)
    .reduce((max, c) => Math.max(max, c.seq), -1)
  return log.writes.every(w => w.seq <= lastMain || w.seq > entry.seq || w.author === entry.author)
}

// ------------------------------------------------------------ lệnh kiểm chưa đạt (0.7.8 vòng sửa 3, W4)

/** Một lần chạy kiểm để so phủ: loại kiểm và lệnh đã chuẩn hóa. */
export type CheckRun = { check: CheckKind; command: string }

/** Lệnh của một lần chạy kiểm đã chuẩn hóa: danh tính argv nếu có, không thì đoạn lệnh, gộp khoảng trắng. */
export function checkCommand(entry: EvidenceEntry): string {
  return (entry.argv !== undefined && entry.argv.length > 0 ? entry.argv.join(' ') : entry.command).replace(/\s+/g, ' ').trim()
}

/** Chữ ký của lệnh kiểm: loại kiểm và lệnh đã chuẩn hóa. */
export function checkSignature(run: CheckRun): string {
  return `${run.check}:${customKey(run.command) ?? run.command}`
}

/** Khóa engine đặt vào đầu vào của mọi tool call (tên tool, id của tool_use, agent gọi): không thuộc đầu vào của lần kiểm. */
const RESERVED_INPUT = new Set(['tool', 'tool_use_id', 'agentId'])

/** JSON với khóa đối tượng sắp xếp, ở mọi tầng. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** Lệnh của một lần kiểm qua tool MCP (0.7.9 Y4): tên tool cộng đầu vào đã chuẩn hóa (JSON sắp xếp khóa, cắt 200 ký tự). */
export function checkToolCommand(tool: string, input: Record<string, unknown>): string {
  const args = Object.fromEntries(Object.entries(input).filter(([key, value]) => !RESERVED_INPUT.has(key) && value !== undefined))
  return `${tool} ${stableJson(args).slice(0, 200)}`
}

/** Lần kiểm qua tool MCP đạt: không isError; output dạng chữ thì còn phải không rỗng, không có dấu hiệu lỗi, không phải "không chạy gì". */
export function checkToolPassed(observation: ToolObservation): boolean {
  if (observation.isError) return false
  const output = observation.output
  if (output === undefined) return true
  return output.trim() !== '' && !outputFailed(output) && !ranNothing(output)
}

/** Lần chạy kiểm này là lỗi thật: không đạt và lệnh lỗi, output có dấu hiệu lỗi, output rỗng, hay không có phép kiểm nào chạy. */
export function isFailedRun(entry: EvidenceEntry, observation: ToolObservation): boolean {
  if (entry.ok || entry.check === null) return false
  if (entry.chained === true) return false
  if (entry.mcp === true) return true
  const output = observation.output ?? ''
  return observation.isError || outputFailed(observation.output) || output.trim() === '' || ranNothing(output)
}

/** Cờ lọc làm lượt chạy chỉ chạy một phần (tên test, mẫu, marker). */
const FILTER_FLAGS = new Set(['-t', '--testnamepattern', '-k', '--filter', '-run', '--grep', '-m'])

/** Cờ nhận một giá trị (tệp cấu hình, thư mục, số, tên reporter): token đứng ngay sau không phải tệp test nên không làm lệnh hẹp. */
const VALUE_FLAGS = new Set([
  '--config', '-c', '-p', '--project', '--manifest-path', '--timeout', '--reporter', '--workers', '-j', '--maxworkers',
  '--rootdir', '--cwd', '--tsconfig', '--env',
])

/**
 * Lệnh kiểm hẹp: có cờ lọc (`-m` của `python -m pytest` không tính), hoặc đối số trỏ tới tệp cụ thể (có phần mở rộng) hay tên test dạng tệp::tên. Subcommand của trình chạy và
 * thư mục (., ./..., tests/, src/) không làm lệnh thành hẹp. Giá trị của cờ nhận giá trị (VALUE_FLAGS) và token số cũng không làm lệnh hẹp.
 */
export function isNarrow(command: string): boolean {
  const tokens = command
    .toLowerCase()
    .replace(/\bpython3? -m pytest\b/, 'pytest')
    .split(/\s+/)
  return tokens.some((token, i) => {
    const flag = token.split('=')[0] ?? ''
    if (FILTER_FLAGS.has(flag)) return true
    if (token.startsWith('-')) return false
    if (VALUE_FLAGS.has(tokens[i - 1] ?? '')) return false
    if (/^\d+(\.\d+)?$/.test(token)) return false
    return token.includes('::') || /[^./]\.[a-z0-9]{1,5}$/.test(token)
  })
}

/** Công cụ kiểm tĩnh nhận theo tên (0.7.9 Y1): hai lệnh cùng công cụ so phủ theo luật lệnh rộng, như trình chạy có parser. */
const STATIC_TOOLS = new Set(['tsc', 'eslint', 'mypy', 'ruff', 'pyright', 'biome'])

/** Token bọc đứng trước công cụ kiểm tĩnh (npx, bunx, pnpm exec, yarn, uv run, poetry run, bundle exec), kể cả cờ của npx. */
const STATIC_WRAPPERS = new Set(['npx', 'bunx', 'pnpm', 'yarn', 'exec', 'uv', 'poetry', 'bundle', 'run'])

/** Tên công cụ của một token: phần sau dấu / cuối (`./node_modules/.bin/tsc` là tsc), chữ thường. */
function toolName(token: string): string {
  return token.toLowerCase().split('/').pop() ?? ''
}

/** Vị trí của công cụ kiểm tĩnh trong lệnh: các token trước nó đều là token bọc hay cờ; không có thì -1. */
function staticAt(tokens: readonly string[]): number {
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? ''
    if (STATIC_TOOLS.has(toolName(token))) return i
    if (!STATIC_WRAPPERS.has(token.toLowerCase()) && !token.startsWith('-')) return -1
  }
  return -1
}

/**
 * Khóa so của công cụ kiểm tĩnh (0.7.9 Y1, vòng 2 V1): tiền tố bọc cộng tên công cụ, chữ thường (`npx tsc`, `pnpm exec tsc`, `tsc`),
 * giữ tiền tố như hợp đồng danh tính của lệnh kiểm; không phải công cụ trong STATIC_TOOLS thì null.
 */
function staticTool(command: string): string | null {
  const tokens = command.trim().split(/\s+/)
  const at = staticAt(tokens)
  return at < 0 ? null : tokens.slice(0, at + 1).join(' ').toLowerCase()
}

/** Lệnh của lần kiểm qua tool MCP: bắt đầu bằng tên tool `mcp__...` rồi một khoảng trắng và đầu vào JSON. */
function isMcpRun(run: CheckRun): boolean {
  return /^mcp__\S+ [{[]/.test(run.command)
}

/** Trình chạy của lệnh kiểm để so phủ: trình chạy có parser, công cụ kiểm tĩnh theo tên, không thì cả lệnh (chỉ lệnh trùng mới phủ nhau). */
function runnerKey(command: string): string {
  return runnerOf(command) ?? staticTool(command) ?? `=${command}`
}

/** Cờ chỉ in thông tin của công cụ kiểm tĩnh (vòng 2 V1): lần đạt có cờ này không kiểm gì, nên không phủ lần lỗi nào. */
const STATIC_INFO_FLAGS = new Set(['--version', '-v', '-V', '--help', '-h', '--showConfig', '--print-config', '--init', '--listFiles', '--list-files'])

/** Công cụ kiểm tĩnh có subcommand đổi việc kiểm (`ruff check` khác `ruff format`, `biome lint` khác `biome format`, `biome check`). */
const STATIC_SUBCOMMANDS = new Set(['ruff', 'biome'])

/** Cờ nhận phạm vi của công cụ kiểm tĩnh (tsc -p, --project). */
const PROJECT_FLAGS = new Set(['-p', '--project'])

/** Lệnh có một cờ trong `flags` (so phân biệt hoa thường, nhận cả dạng `--cờ=giá trị`). */
function hasFlag(tokens: readonly string[], flags: ReadonlySet<string>): boolean {
  return tokens.some(token => token.startsWith('-') && flags.has(token.split('=')[0] ?? ''))
}

/** Đường dẫn để so phạm vi: bỏ đuôi `::tên`, `/...` và `/`, bỏ `./` đầu; gốc (`.`, `./`) là chuỗi rỗng. */
function scopePath(token: string): string {
  const path = token.replace(/::.*$/, '').replace(/\/\.\.\.$/, '').replace(/\/+$/, '').replace(/^(?:\.\/)+/, '')
  return path === '.' ? '' : path
}

/**
 * Các đường dẫn của lần đạt chứa mọi đường dẫn của lần lỗi (vòng 2 V1, V2): lần đạt không có đường dẫn phủ hết; lần lỗi không có đường dẫn
 * là gốc. So theo ranh giới thư mục.
 */
function pathsCover(pass: readonly string[], fail: readonly string[]): boolean {
  if (pass.length === 0) return true
  return (fail.length === 0 ? [''] : fail).every(f => pass.some(p => p === '' || f === p || f.startsWith(`${p}/`)))
}

/** Cờ trung tính của công cụ kiểm tĩnh (vòng 2 V1d): đổi cách in hay bộ nhớ đệm hay bật điều đã có trong lệnh, không đổi phép kiểm. */
const STATIC_NEUTRAL_FLAGS = new Set(['--pretty', '--color', '--no-color', '--format', '-f', '--cache', '--cache-location', '--noemit', '--quiet'])

/** Cờ trung tính nhận một giá trị đứng sau (`--format json`, `-f json`, `--cache-location dir`); `--pretty false` được bỏ qua như token true hay false. */
const STATIC_NEUTRAL_VALUED = new Set(['--format', '-f', '--cache-location'])

/** Cờ không trung tính nhận một giá trị đứng sau, ngoài VALUE_FLAGS: giá trị là một phần của cờ (`--max-warnings 1000` khác `--max-warnings 0`). */
const STATIC_VALUE_FLAGS = new Set(['--max-warnings', '--ext', '--rule', '--parser', '--plugin', '--ignore-path', '--ignore-pattern', '--output-file', '--stdin-filename'])

/**
 * Các phần để so phủ của một lệnh kiểm tĩnh (vòng 2 V1, V1d): cờ chỉ in (`flags`), tập cờ phép kiểm (`checks`: cờ không trung tính, không phải
 * -p hay --project, kèm giá trị, đã sắp xếp), subcommand (chỉ ruff và biome), phạm vi -p hay --project (vắng, `.`, `tsconfig.json` là một),
 * và các đường dẫn (bỏ cờ, giá trị của cờ nhận giá trị, token số, true và false).
 */
function staticParts(command: string): { flags: string[]; checks: string[]; sub: string; project: string; paths: string[] } {
  const tokens = command.trim().split(/\s+/)
  const at = staticAt(tokens)
  const rest = tokens.slice(at + 1)
  const sub = STATIC_SUBCOMMANDS.has(toolName(tokens[at] ?? '')) && !(rest[0] ?? '-').startsWith('-') ? (rest.shift() ?? '') : ''
  let project = ''
  const paths: string[] = []
  const checks: string[] = []
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i] ?? ''
    const flag = (token.split('=')[0] ?? '').toLowerCase()
    const hasValue = token.includes('=')
    if (PROJECT_FLAGS.has(flag)) {
      project = hasValue ? token.slice(token.indexOf('=') + 1) : (rest[++i] ?? '')
      continue
    }
    if (token.startsWith('-')) {
      if (STATIC_NEUTRAL_FLAGS.has(flag)) {
        if (STATIC_NEUTRAL_VALUED.has(flag) && !hasValue) i += 1
        continue
      }
      const next = rest[i + 1] ?? ''
      const takesValue = !hasValue && (VALUE_FLAGS.has(flag) || STATIC_VALUE_FLAGS.has(flag) || /^\d+(\.\d+)?$/.test(next))
      checks.push(takesValue ? `${token} ${next}` : token)
      if (takesValue) i += 1
      continue
    }
    if (/^\d+(\.\d+)?$/.test(token) || token === 'true' || token === 'false') continue
    paths.push(scopePath(token))
  }
  const scope = scopePath(project)
  return { flags: rest.filter(t => t.startsWith('-')), checks: checks.sort(), sub, project: scope === 'tsconfig.json' ? '' : scope, paths }
}

/**
 * Cờ làm lần chạy test không chạy đủ (vòng 2 V2): chỉ in (phiên bản, trợ giúp, cấu hình), chỉ liệt kê hay thu thập (--collect-only,
 * --listTests, -list của go test), chạy thử (--no-run, --dry-run), chạy lại một phần (--lf, --last-failed, --sw, --stepwise, -o và
 * --onlyChanged của jest, --changed, --findRelatedTests) hay bỏ bớt (--deselect, --ignore). Nhận cả dạng `--cờ=giá trị`.
 */
const RUNNER_PARTIAL_FLAGS = new Set([
  '--version', '-V', '--help', '-h', '--collect-only', '--co', '--listTests', '--list', '-list', '--showConfig', '--fixtures', '--markers',
  '--lf', '--last-failed', '--sw', '--stepwise', '-o', '--onlyChanged', '--changed', '--findRelatedTests', '--deselect', '--ignore',
  '--no-run', '--dry-run',
  '--testPathIgnorePatterns', '--exclude', '-short', '--passWithNoTests',
])

/** Cờ nhận một giá trị của trình chạy test (thêm vào VALUE_FLAGS của isNarrow): giá trị đi kèm không phải đường dẫn. */
const RUNNER_VALUE_FLAGS = new Set([...VALUE_FLAGS, '--deselect', '--ignore', '--testpathignorepatterns', '--exclude'])

/** Subcommand của trình chạy đứng ngay sau tên (vitest run, bun test, go test, cargo test): không phải đường dẫn. */
const RUNNER_SUBCOMMANDS = new Map<string, Set<string>>([
  ['vitest', new Set(['run', 'watch', 'dev', 'bench'])],
  ['bun', new Set(['test'])],
  ['go', new Set(['test'])],
  ['cargo', new Set(['test'])],
])

/**
 * Cờ và đường dẫn của một lệnh chạy test (vòng 2 V2), theo cách runnerOf nhận trình chạy: bỏ `npx`, tên trình chạy (và `-m pytest` của
 * python), subcommand, cờ và giá trị của cờ nhận giá trị, token số. Lệnh không phải trình chạy có parser thì không có đường dẫn nào.
 */
function runnerParts(command: string): { flags: string[]; paths: string[] } {
  const tokens = command.trim().split(/\s+/)
  while (tokens.length > 0 && (tokens[0]?.toLowerCase() === 'npx' || (tokens[0] ?? '').startsWith('-'))) tokens.shift()
  const name = (tokens.shift() ?? '').toLowerCase()
  if ((name === 'python' || name === 'python3') && tokens[0] === '-m') tokens.splice(0, 2)
  if (RUNNER_SUBCOMMANDS.get(name)?.has((tokens[0] ?? '').toLowerCase()) === true) tokens.shift()
  const flags: string[] = []
  const paths: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? ''
    if (token.startsWith('-')) {
      flags.push(token)
      if (RUNNER_VALUE_FLAGS.has((token.split('=')[0] ?? '').toLowerCase()) && !token.includes('=')) i += 1
      continue
    }
    if (/^\d+(\.\d+)?$/.test(token)) continue
    paths.push(scopePath(token))
  }
  return { flags, paths }
}

/**
 * Lần chạy đạt `pass` phủ lần lỗi `fail` (0.7.8 vòng sửa 3, W4): cùng loại kiểm, cùng trình chạy, và cùng lệnh đã chuẩn hóa hoặc lệnh
 * đạt không hẹp (không cờ lọc, không trỏ tệp hay tên test cụ thể). Chạy đạt một tệp test nhỏ không phủ lần lỗi của cả bộ test.
 * Công cụ kiểm tĩnh (vòng 2 V1): lần đạt còn phải thật sự kiểm (không cờ chỉ in thông tin), cùng subcommand và cùng phạm vi.
 */
export function coversFailure(pass: CheckRun, fail: CheckRun): boolean {
  // Lần kiểm qua tool MCP (0.7.9 Y4): chỉ cùng tool, cùng đầu vào đã chuẩn hóa mới phủ; không áp isNarrow.
  if (isMcpRun(pass) || isMcpRun(fail)) return pass.check === fail.check && pass.command === fail.command
  // Lệnh khai (0.8.0 A1): so theo dạng chuẩn sau khi giải đường dẫn và chuẩn hóa python; như trước, chỉ trùng lệnh mới phủ.
  const passKey = customKey(pass.command)
  const failKey = customKey(fail.command)
  if (passKey !== null || failKey !== null) return pass.check === fail.check && passKey === failKey
  if (pass.check !== fail.check || runnerKey(pass.command) !== runnerKey(fail.command)) return false
  if (pass.command === fail.command) return true
  if (isNarrow(pass.command)) return false
  if (staticTool(pass.command) !== null) {
    const p = staticParts(pass.command)
    const f = staticParts(fail.command)
    if (hasFlag(p.flags, STATIC_INFO_FLAGS)) return false
    if (p.sub !== f.sub) return false
    if (p.checks.join('\n') !== f.checks.join('\n')) return false
    return p.project === f.project && pathsCover(p.paths, f.paths)
  }
  const p = runnerParts(pass.command)
  const f = runnerParts(fail.command)
  if (hasFlag(p.flags, RUNNER_PARTIAL_FLAGS)) return false
  return pathsCover(p.paths, f.paths)
}
