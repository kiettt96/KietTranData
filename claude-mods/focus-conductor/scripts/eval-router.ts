// Eval router thật trên golden-set (không chạy trong CI): gửi đúng request của mod tới model router qua
// `claude -p` (không tool, không hook, không MCP), chấm câu trả lời theo tests/golden/check.ts và in bảng.
// Chỉ đọc và điều phối, không thực thi prompt nào.
//
//   bun scripts/eval-router.ts [--model sonnet] [--only id1,id2] [--runs 3] [--record]
//
// --runs N chạy mỗi ca N lần và báo tỷ lệ đạt từng ca (router không tất định, một lần chạy không nói được độ ổn định).
// --record ghi vào tests/golden/replies.ts (dữ liệu replay của golden.test.ts): câu trả lời đạt đầu tiên của mỗi ca, băm của
// request đã gửi, tỷ lệ đạt. Ca không lần nào đạt thì giữ nguyên bản ghi cũ (băm cũ lệch nên golden.test.ts đỏ) và script
// thoát mã 1: phải xem lại kỳ vọng hay prompt router chứ không ghi bản sai.
// Mỗi lần gọi chạy với CLAUDE_CONFIG_DIR riêng (thư mục tạm), để plugin và mod đang bật trên máy (kể cả chính
// focus-conductor) không điều phối lại request của router. Cột "served" là model thật sự trả lời (modelUsage);
// khác model yêu cầu thì ca đó bị đánh dấu.

import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CASES } from '../tests/golden/cases'
import type { GoldenCase } from '../tests/golden/cases'
import { check } from '../tests/golden/check'
import { goldenRequest, requestHash } from '../tests/golden/hash'

const args = process.argv.slice(2)
const flag = (name: string) => {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : undefined
}
const MODEL = flag('--model') ?? 'sonnet'
const ONLY = flag('--only')?.split(',')
const RECORD = args.includes('--record')
const RUNS = Math.max(1, Number(flag('--runs') ?? '1') || 1)
const REPLIES = join(import.meta.dir, '..', 'tests', 'golden', 'replies.ts')
const work = mkdtempSync(join(tmpdir(), 'fc-eval-'))

function run(input: string, argv: string[]): Promise<{ out: string; ms: number }> {
  const started = Date.now()
  return new Promise(resolve => {
    const config = mkdtempSync(join(tmpdir(), 'fc-eval-config-'))
    const child = spawn('claude', argv, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, CLAUDE_CONFIG_DIR: config } })
    let out = ''
    child.stdout.on('data', d => (out += d))
    child.stderr.on('data', d => (out += d))
    child.on('close', () => resolve({ out, ms: Date.now() - started }))
    child.stdin.end(input)
  })
}

async function one(c: GoldenCase, n: number) {
  const request = goldenRequest(c, MODEL)
  const system = (request.system as { text: string }[]).map(b => b.text).join('')
  const file = join(work, `system-${c.id}.txt`)
  writeFileSync(file, system)
  const argv = ['-p', '--no-session-persistence', '--setting-sources', 'project', '--strict-mcp-config', '--tools', '', '--model', MODEL, '--effort', String(request.effort), '--system-prompt-file', file, '--output-format', 'json']
  const { out, ms } = await run(String(request.prompt), argv)
  let text = out
  let served = '?'
  let usd = 0
  try {
    const json = JSON.parse(out) as { result?: string; total_cost_usd?: number; modelUsage?: Record<string, unknown> }
    text = json.result ?? ''
    usd = json.total_cost_usd ?? 0
    served = Object.keys(json.modelUsage ?? {}).join('+') || '?'
  } catch {
    // Không phải JSON của CLI: chấm thẳng đầu ra.
  }
  const fails = check(c, text)
  if (served !== '?' && !served.split('+').every(id => id.includes(MODEL))) fails.push(`model trả lời ${served}, không phải ${MODEL}`)
  return { c, n, text, fails, ms, usd, served }
}

// Phiên bản Claude Code chạy eval, ghi kèm kết quả để số liệu gắn với đúng môi trường.
const version = (await run('', ['--version'])).out.trim()
const startedAt = new Date().toISOString()
console.log(`Claude Code ${version || '?'}, router ${MODEL}, ${RUNS} lần mỗi ca, ${startedAt}`)

const picked = CASES.filter(c => !ONLY || ONLY.includes(c.id))
const jobs = picked.flatMap(c => Array.from({ length: RUNS }, (_, n) => ({ c, n })))
const results: Awaited<ReturnType<typeof one>>[] = []
for (let i = 0; i < jobs.length; i += 4) results.push(...(await Promise.all(jobs.slice(i, i + 4).map(job => one(job.c, job.n)))))

type Summary = { c: GoldenCase; runs: typeof results; passed: number }
const summary: Summary[] = picked.map(c => {
  const runs = results.filter(r => r.c.id === c.id)
  return { c, runs, passed: runs.filter(r => r.fails.length === 0).length }
})
for (const { c, runs, passed } of summary) {
  const ms = runs.reduce((sum, r) => sum + r.ms, 0) / runs.length
  const usd = runs.reduce((sum, r) => sum + r.usd, 0)
  const served = [...new Set(runs.map(r => r.served))].join(',')
  const head = `${passed === runs.length ? 'ĐẠT ' : passed === 0 ? 'LỆCH' : 'CHẬP'} ${c.id.padEnd(14)} ${passed}/${runs.length} ${(ms / 1000).toFixed(1).padStart(5)}s $${usd.toFixed(4)} served=${served}`
  const reasons = [...new Set(runs.flatMap(r => r.fails))]
  console.log(reasons.length === 0 ? head : `${head}\n     ${reasons.join('\n     ')}`)
}
const total = summary.reduce((sum, s) => sum + s.passed, 0)
const attempts = summary.reduce((sum, s) => sum + s.runs.length, 0)
console.log(`\n${summary.filter(s => s.passed === s.runs.length).length}/${summary.length} ca đạt mọi lần; ${total}/${attempts} lượt đạt (router ${MODEL}, tổng $${results.reduce((sum, r) => sum + r.usd, 0).toFixed(4)})`)

if (RECORD) {
  const mod = (await import(REPLIES).catch(() => ({}))) as { REPLIES?: Record<string, string>; HASHES?: Record<string, string>; RUNS?: Record<string, string> }
  const replies = { ...(mod.REPLIES ?? {}) }
  const hashes = { ...(mod.HASHES ?? {}) }
  const rates = { ...(mod.RUNS ?? {}) }
  const never: string[] = []
  for (const { c, runs, passed } of summary) {
    const first = runs.find(r => r.fails.length === 0)
    rates[c.id] = `${passed}/${runs.length}`
    if (first === undefined) {
      never.push(c.id)
      continue
    }
    replies[c.id] = first.text
    hashes[c.id] = await requestHash(c)
  }
  const keep = new Set(CASES.map(c => c.id))
  const section = (name: string, values: Record<string, string>) =>
    `export const ${name}: Record<string, string> = {\n${Object.entries(values)
      .filter(([id]) => keep.has(id))
      .map(([id, text]) => `  ${JSON.stringify(id)}: ${JSON.stringify(text)},`)
      .join('\n')}\n}\n`
  writeFileSync(
    REPLIES,
    `// Câu trả lời router thật đã ghi cho golden-set (scripts/eval-router.ts --record), replay offline trong golden.test.ts.\n` +
      `// Ghi lần cuối: Claude Code ${version || '?'}, router ${MODEL}, ${RUNS} lần mỗi ca, ${startedAt.slice(0, 10)}.\n` +
      `// REPLIES: câu trả lời đạt đầu tiên của mỗi ca. HASHES: SHA-256 của request đã gửi (tests/golden/hash.ts); đổi prompt router hay\n` +
      `// request thì băm lệch và test đỏ cho tới khi ghi lại. RUNS: số lượt đạt trên số lượt chạy của lần ghi đó.\n\n` +
      `${section('REPLIES', replies)}\n${section('HASHES', hashes)}\n${section('RUNS', rates)}`,
  )
  console.log(`Đã ghi ${picked.length - never.length}/${picked.length} ca vào ${REPLIES}`)
  if (never.length > 0) {
    console.log(`KHÔNG GHI được (không lần nào đạt): ${never.join(', ')}. Bản ghi cũ giữ nguyên nên golden.test.ts đỏ cho tới khi xử lý.`)
    process.exit(1)
  }
}
