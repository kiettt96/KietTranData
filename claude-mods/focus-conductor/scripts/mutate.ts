// Chạy đột biến (mutation testing) trên mã của mod: với từng mẫu trong scripts/mutants.ts, thay đúng một chỗ trong tệp nguồn,
// chạy `claude plugin test .` và báo KILLED (test đỏ hoặc mod không nạp), SURVIVED (bộ test không phát hiện) hay EQUIVALENT
// (mẫu đã ghi là tương đương và sống sót đúng như dự kiến).
//
//   bun scripts/mutate.ts --check          chỉ kiểm mỗi mẫu còn khớp đúng một lần, không sửa tệp nào
//   bun scripts/mutate.ts                  chạy toàn bộ mẫu
//   bun scripts/mutate.ts P1 K3 r4-V1      chạy riêng theo id
//   bun scripts/mutate.ts --jobs 4         chạy song song bốn bản sao (mặc định 1; trên máy 4 lõi nhanh khoảng gấp đôi)
//   bun scripts/mutate.ts --list           in id và ghi chú của từng mẫu
//
// An toàn: mỗi worker làm việc trên MỘT BẢN SAO của thư mục mod trong thư mục tạm; cây làm việc thật không bao giờ bị sửa, nên
// ngắt giữa chừng (Ctrl+C, giết tiến trình) không để lại tệp bị đột biến nào. Script in sha256 của `hooks/` và `tests/` trước và sau
// để chứng minh điều đó. Mỗi mẫu mất khoảng 30 giây (một lượt `claude plugin test`). Không chạy trong CI.

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'

import { MUTANTS } from './mutants'
import type { Mutant } from './mutants'

const ROOT = join(import.meta.dir, '..')
const args = process.argv.slice(2)
const flag = (name: string) => {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : undefined
}
const CHECK = args.includes('--check')
const LIST = args.includes('--list')
const JOBS = Math.max(1, Math.floor(Number(flag('--jobs') ?? '1')) || 1)
// Đối số vị trí là id; giá trị của --jobs không phải id.
const ONLY = args.filter((arg, at) => !arg.startsWith('--') && args[at - 1] !== '--jobs')

function tree(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...tree(full))
    else out.push(full)
  }
  return out
}

function digest(dir: string): string {
  const hash = createHash('sha256')
  for (const file of tree(join(ROOT, dir))) {
    hash.update(relative(ROOT, file))
    hash.update(readFileSync(file))
  }
  return hash.digest('hex')
}

function occurrences(text: string, needle: string): number {
  let count = 0
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) count += 1
  return count
}

if (LIST) {
  for (const mutant of MUTANTS) console.log(`${mutant.id}\t${mutant.file}\t${mutant.note}`)
  process.exit(0)
}

const unknown = ONLY.filter(id => !MUTANTS.some(mutant => mutant.id === id))
if (unknown.length > 0) {
  console.error(`id không có trong scripts/mutants.ts: ${unknown.join(', ')}`)
  process.exit(2)
}
const duplicated = MUTANTS.map(mutant => mutant.id).filter((id, at, all) => all.indexOf(id) !== at)
if (duplicated.length > 0) {
  console.error(`id trùng trong scripts/mutants.ts: ${duplicated.join(', ')}`)
  process.exit(2)
}

const originals = new Map<string, string>()
for (const mutant of MUTANTS) {
  if (!originals.has(mutant.file)) originals.set(mutant.file, readFileSync(join(ROOT, mutant.file), 'utf8'))
}

const before = { hooks: digest('hooks'), tests: digest('tests') }
console.log(`hooks sha256 ${before.hooks}`)
console.log(`tests sha256 ${before.tests}`)
const selected = MUTANTS.filter(mutant => ONLY.length === 0 || ONLY.includes(mutant.id))
console.log(`mutants ${selected.length}/${MUTANTS.length}, ${CHECK ? 'chỉ kiểm khớp' : `${JOBS} worker`}`)

type Verdict = 'KILLED' | 'SURVIVED' | 'EQUIVALENT'
const summary = { KILLED: 0, SURVIVED: 0, EQUIVALENT: 0, COUNT: 0 }
const survivors: string[] = []
const mismatched: string[] = []

const runnable: Mutant[] = []
for (const mutant of selected) {
  const count = occurrences(originals.get(mutant.file) as string, mutant.old)
  if (count !== 1) {
    console.log(`${mutant.id} COUNT ${count}`)
    summary.COUNT += 1
    mismatched.push(mutant.id)
  } else runnable.push(mutant)
}

/** Chạy `claude plugin test .` trong `cwd`; trả số ca lỗi (-1 nếu không đọc được hay mod không nạp). */
function testIn(cwd: string): Promise<{ failed: number; loads: boolean }> {
  return new Promise(resolve => {
    const child = spawn('claude', ['plugin', 'test', '.'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', chunk => (out += chunk))
    child.stderr.on('data', chunk => (out += chunk))
    const timer = setTimeout(() => child.kill('SIGKILL'), 900_000)
    child.on('close', () => {
      clearTimeout(timer)
      const match = out.match(/\n\s*(\d+) fail/)
      const failed = match ? Number(match[1]) : -1
      resolve({ failed, loads: !(out.includes('did not load') || failed === -1) })
    })
  })
}

const copies: string[] = []
function cleanup(): void {
  for (const dir of copies) rmSync(dir, { recursive: true, force: true })
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    cleanup()
    console.log(`\n${signal}: đã xóa các bản sao tạm; cây làm việc thật không bị sửa`)
    process.exit(130)
  })
}

async function worker(index: number, queue: Mutant[]): Promise<void> {
  // Bản sao riêng (không kèm tệp khai báo do engine sinh; engine tự ghi lại trong bản sao khi nạp mod).
  const dir = mkdtempSync(join(tmpdir(), `fc-mutate-${index}-`))
  copies.push(dir)
  cpSync(ROOT, dir, { recursive: true, filter: source => !source.includes(`${sep}.claude-plugin${sep}types`) })
  for (let mutant = queue.shift(); mutant !== undefined; mutant = queue.shift()) {
    const target = join(dir, mutant.file)
    const source = originals.get(mutant.file) as string
    writeFileSync(target, source.replace(mutant.old, () => mutant.new))
    const { failed, loads } = await testIn(dir)
    writeFileSync(target, source)
    const killed = failed !== 0 || !loads
    const verdict: Verdict = killed ? 'KILLED' : mutant.equivalent === undefined ? 'SURVIVED' : 'EQUIVALENT'
    summary[verdict] += 1
    if (verdict === 'SURVIVED') survivors.push(mutant.id)
    console.log(`${mutant.id} ${verdict} fail=${failed}`)
  }
}

try {
  if (!CHECK) {
    const queue = [...runnable]
    await Promise.all(Array.from({ length: Math.min(JOBS, Math.max(1, queue.length)) }, (_, index) => worker(index, queue)))
  }
} finally {
  cleanup()
  const after = { hooks: digest('hooks'), tests: digest('tests') }
  console.log(`hooks sha256 ${after.hooks}${after.hooks === before.hooks ? '' : '  (KHÁC trước khi chạy)'}`)
  console.log(`tests sha256 ${after.tests}${after.tests === before.tests ? '' : '  (KHÁC trước khi chạy)'}`)
  console.log(`SUMMARY ${JSON.stringify(summary)}${survivors.length > 0 ? ` survivors=${survivors.join(',')}` : ''}${mismatched.length > 0 ? ` mismatched=${mismatched.join(',')}` : ''} DONE`)
}
process.exit(summary.SURVIVED + summary.COUNT > 0 ? 1 : 0)
