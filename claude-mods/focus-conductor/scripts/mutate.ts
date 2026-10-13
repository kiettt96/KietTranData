// Chạy đột biến (mutation testing) trên mã của mod: với từng mẫu trong scripts/mutants.ts, thay đúng một chỗ trong tệp nguồn,
// chạy `claude plugin test .` và báo KILLED (test đỏ hoặc mod không nạp) hoặc SURVIVED (bộ test không phát hiện).
//
//   bun scripts/mutate.ts --check          chỉ kiểm mỗi mẫu còn khớp đúng một lần, không sửa tệp nào
//   bun scripts/mutate.ts                  chạy toàn bộ mẫu (khoảng 25 đến 40 giây mỗi mẫu)
//   bun scripts/mutate.ts P1 K3 r4-V1      chạy riêng theo id
//   bun scripts/mutate.ts --list           in id và ghi chú của từng mẫu
//
// An toàn: tệp gốc được giữ trong bộ nhớ và sao lưu ra thư mục tạm; mỗi mẫu xong là khôi phục ngay, và khôi phục lần cuối trong
// `finally`, khi Ctrl+C (SIGINT) hoặc SIGTERM. In sha256 của `hooks/` và `tests/` trước và sau để chứng minh không còn dấu vết.
// Nếu tiến trình bị giết cứng (kill -9) giữa chừng, khôi phục bằng `git checkout -- hooks` hoặc từ thư mục sao lưu được in ra.
// Không chạy trong CI. Chạy trên cây làm việc đã commit hoặc đã chốt: mẫu so khớp theo nội dung hiện tại của tệp.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

import { MUTANTS } from './mutants'

const ROOT = join(import.meta.dir, '..')
const args = process.argv.slice(2)
const CHECK = args.includes('--check')
const LIST = args.includes('--list')
const ONLY = args.filter(a => !a.startsWith('--'))

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
const backup = mkdtempSync(join(tmpdir(), 'fc-mutate-'))
originals.forEach((text, file) => writeFileSync(join(backup, file.replace(/[\\/]/g, '__')), text))

function restore(): boolean {
  let clean = true
  originals.forEach((text, file) => {
    writeFileSync(join(ROOT, file), text)
    if (readFileSync(join(ROOT, file), 'utf8') !== text) clean = false
  })
  return clean
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`\n${signal}: khôi phục tệp gốc, restored=${restore()}`)
    process.exit(130)
  })
}

const before = { hooks: digest('hooks'), tests: digest('tests') }
console.log(`hooks sha256 ${before.hooks}`)
console.log(`tests sha256 ${before.tests}`)
console.log(`sao lưu tệp gốc: ${backup}`)
const selected = MUTANTS.filter(mutant => ONLY.length === 0 || ONLY.includes(mutant.id))
console.log(`mutants ${selected.length}/${MUTANTS.length}`)

const summary = { KILLED: 0, SURVIVED: 0, EQUIVALENT: 0, COUNT: 0 }
const survivors: string[] = []
const mismatched: string[] = []
try {
  for (const mutant of selected) {
    const source = originals.get(mutant.file) as string
    const count = occurrences(source, mutant.old)
    if (count !== 1) {
      console.log(`${mutant.id} COUNT ${count}`)
      summary.COUNT += 1
      mismatched.push(mutant.id)
      continue
    }
    if (CHECK) continue
    writeFileSync(join(ROOT, mutant.file), source.replace(mutant.old, () => mutant.new))
    let failed = -1
    let loads = false
    try {
      const run = spawnSync('claude', ['plugin', 'test', '.'], { cwd: ROOT, encoding: 'utf8', timeout: 900_000 })
      const text = `${run.stdout ?? ''}${run.stderr ?? ''}`
      const match = text.match(/\n\s*(\d+) fail/)
      failed = match ? Number(match[1]) : -1
      loads = text.includes('did not load') || failed === -1
    } finally {
      writeFileSync(join(ROOT, mutant.file), source)
    }
    const verdict = failed !== 0 || loads ? 'KILLED' : mutant.equivalent === undefined ? 'SURVIVED' : 'EQUIVALENT'
    summary[verdict] += 1
    if (verdict === 'SURVIVED') survivors.push(mutant.id)
    console.log(`${mutant.id} ${verdict} fail=${failed}`)
  }
} finally {
  const clean = CHECK ? true : restore()
  const after = { hooks: digest('hooks'), tests: digest('tests') }
  console.log(`RESTORED ${clean}`)
  console.log(`hooks sha256 ${after.hooks}${after.hooks === before.hooks ? '' : '  (KHÁC trước khi chạy)'}`)
  console.log(`tests sha256 ${after.tests}${after.tests === before.tests ? '' : '  (KHÁC trước khi chạy)'}`)
  console.log(`SUMMARY ${JSON.stringify(summary)}${survivors.length > 0 ? ` survivors=${survivors.join(',')}` : ''}${mismatched.length > 0 ? ` mismatched=${mismatched.join(',')}` : ''} DONE`)
}
process.exit(summary.SURVIVED + summary.COUNT > 0 ? 1 : 0)
