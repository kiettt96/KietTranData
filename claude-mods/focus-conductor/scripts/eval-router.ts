// Eval router thật trên golden-set (không chạy trong CI): gửi đúng request của mod tới model router qua
// `claude -p` (không tool, không hook, không MCP), chấm câu trả lời theo tests/golden/check.ts và in bảng.
// Chỉ đọc và điều phối, không thực thi prompt nào.
//
//   bun scripts/eval-router.ts [--model sonnet] [--only id1,id2] [--record]
//
// --record ghi câu trả lời vào tests/golden/replies.ts (dữ liệu replay của golden.test.ts).
// Mỗi lần gọi chạy với CLAUDE_CONFIG_DIR riêng (thư mục tạm), để plugin và mod đang bật trên máy (kể cả chính
// focus-conductor) không điều phối lại request của router. Cột "served" là model thật sự trả lời (modelUsage);
// khác model yêu cầu thì ca đó bị đánh dấu.

import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { routerRequest } from '../hooks/lib/router'
import { CASES, OPEN } from '../tests/golden/cases'
import { check } from '../tests/golden/check'

const args = process.argv.slice(2)
const flag = (name: string) => {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : undefined
}
const MODEL = flag('--model') ?? 'sonnet'
const ONLY = flag('--only')?.split(',')
const RECORD = args.includes('--record')
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

async function one(c: (typeof CASES)[number]) {
  const request = routerRequest({ text: c.text, prev: c.prev ?? null, ran: c.ran ?? null, policy: OPEN, model: MODEL })
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
  return { c, text, fails, ms, usd, served }
}

// Phiên bản Claude Code chạy eval, ghi kèm kết quả để số liệu gắn với đúng môi trường.
const version = (await run('', ['--version'])).out.trim()
console.log(`Claude Code ${version || '?'}, router ${MODEL}, ${new Date().toISOString()}`)

const picked = CASES.filter(c => !ONLY || ONLY.includes(c.id))
const results: Awaited<ReturnType<typeof one>>[] = []
for (let i = 0; i < picked.length; i += 4) results.push(...(await Promise.all(picked.slice(i, i + 4).map(one))))

for (const r of results) {
  const head = `${r.fails.length === 0 ? 'ĐẠT ' : 'LỆCH'} ${r.c.id.padEnd(12)} ${(r.ms / 1000).toFixed(1).padStart(5)}s $${r.usd.toFixed(4)} served=${r.served}`
  console.log(r.fails.length === 0 ? head : `${head}\n     ${r.fails.join('\n     ')}`)
}
const passed = results.filter(r => r.fails.length === 0).length
console.log(`\n${passed}/${results.length} ca đạt (router ${MODEL})`)

if (RECORD) {
  let current: Record<string, string> = {}
  try {
    const mod = (await import(REPLIES)) as { REPLIES: Record<string, string> }
    current = { ...mod.REPLIES }
  } catch {
    current = {}
  }
  for (const r of results) current[r.c.id] = r.text
  const body = Object.entries(current)
    .map(([id, text]) => `  ${JSON.stringify(id)}: ${JSON.stringify(text)},`)
    .join('\n')
  writeFileSync(
    REPLIES,
    `// Câu trả lời router thật đã ghi cho golden-set (scripts/eval-router.ts --record), replay offline trong golden.test.ts.\n// Ghi lại khi đổi prompt router; xem cột "served" của lần chạy để biết model nào đã trả lời.\n\nexport const REPLIES: Record<string, string> = {\n${body}\n}\n`,
  )
  console.log(`Đã ghi ${results.length} câu trả lời vào ${REPLIES}`)
}
