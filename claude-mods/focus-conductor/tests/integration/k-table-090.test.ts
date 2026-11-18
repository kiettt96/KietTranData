// 0.9.0 bảng nghiệm thu đóng của cổng duyệt (K1 tới K17, chỉ dẫn của chủ mod 18/11). Mỗi dòng có ít nhất một ca mang mã K trong tên.
// Cổng duyệt là lớp nhắc chất lượng: kết luận duyệt, sẵn sàng tính theo hành vi (model từ sonnet, không tiền tố audit, không ghi definite
// vào file dự án, dấu file không đổi), không theo vai; fs đo được ở mốc này mà không đo được ở mốc khác thì không tính.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { verdictOf } from '../../hooks/lib/verdict'
import { JS } from '../fixtures/runner-output'
import { base, plan, step, submit } from '../support/engine'
import type { Json, Seen } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const W = '/w/viec'
const GOAL = (over: Json = {}) => plan({ goal: 'Sửa luồng phí', scope: ['/repo/src', '/repo/skills'], sideWrites: [`${W}/backup/`], depth: 'substantial', volume: 'medium', kind: 'edit', main: { model: 'sonnet', effort: 'medium' }, ...over })
const OPTS = (over: Json = {}) => ({ options: { planApproval: 'off', checkCommands: 'bun test', ...over } })
const BLOCK = 'duyệt độc lập'
const SRC = '/repo/src/phi.ts'
type Out = { deny?: string; context?: string[]; result?: unknown }
type FakeFile = { text: string; mtimeMs: number }

/** Hệ tệp giả: `broken` làm stat, read trả lỗi EIO (fs không đo được); file thiếu trả ENOENT. Đếm lần gọi vào /repo. */
class Fs {
  files = new Map<string, FakeFile>()
  broken = false
  calls = 0
  set(path: string, text: string, mtimeMs: number) {
    this.files.set(path, { text, mtimeMs })
  }
}
function wire(on: On, fs: Fs): void {
  on('fs.stat', (_$, e) => {
    if (String(e.path).startsWith('/repo/')) fs.calls += 1
    if (fs.broken) return { deny: `EIO: i/o error, stat '${e.path}'` } as never
    const file = fs.files.get(e.path)
    return (file !== undefined ? { value: { kind: 'file', size: file.text.length, mtimeMs: file.mtimeMs, isLink: false, ...(e.resolve ? { realPath: e.path } : {}) } } : { deny: `ENOENT: no such file or directory, stat '${e.path}'` }) as never
  })
  on('fs.read', (_$, e) => {
    if (String(e.path).startsWith('/repo/')) fs.calls += 1
    if (fs.broken) return { deny: `EIO: i/o error, read '${e.path}'` } as never
    const file = fs.files.get(e.path)
    return (file !== undefined ? { value: file.text } : { deny: `ENOENT: no such file or directory, open '${e.path}'` }) as never
  })
}
let model = 'claude-opus-5-5'
/** Gọi ngay khi engine giả sinh subagent (sau khi mod gọi next của agent.spawn): mô phỏng subagent khởi chạy và đổi file tức thì. */
let onStart: () => void = () => {}
function setup(on: On, fs: Fs | null, reply: Json | (() => Json) = GOAL()): Seen {
  const seen = base(on, { router: typeof reply === 'function' ? reply : () => reply, root: '/repo' })
  if (fs !== null) wire(on, fs)
  model = 'claude-opus-5-5'
  onStart = () => {}
  on('tool.call', { tool: /^(?:Edit|Write|Read|Agent|Skill)$/ }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: JS.bun_pass }))
  on('agent.spawn', (_$, e) => {
    onStart()
    return { model, agentId: `a-${String((e as { tool_use_id?: unknown }).tool_use_id)}` } as never
  })
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  on('agent.offer', () => ({ isOffered: true }))
  return seen
}
const call = async ($: Engine, input: Record<string, unknown>) => (await $.tool.call(input as never)) as Out
const stop = async ($: Engine) => String(((await $.classic.Stop({ stop_hook_active: false } as never)) as { block?: string }).block ?? '')
let n = 0
async function spawn($: Engine, description: string, subagentType?: string) {
  const id = `k${(n += 1)}`
  await $.tool.call({ tool: 'Agent', tool_use_id: id, description, prompt: 'Rà.', ...(subagentType !== undefined ? { subagent_type: subagentType } : {}) } as never)
  await $.agent.spawn({ prompt: 'Rà.', description, tool_use_id: id } as never)
  return id
}
const complete = ($: Engine, id: string, text: string) =>
  $.turn.complete({ turnId: `x-${id}`, agentId: `a-${id}`, answer: text, durationMs: 5, isAborted: false, reason: 'answer', usage: { model, input_tokens: 10, output_tokens: 10 } } as never)
async function agent($: Engine, description: string, text: string, calls: ReadonlyArray<Record<string, unknown>> = [], during: () => void = () => {}, subagentType?: string) {
  const id = await spawn($, description, subagentType)
  const outs: Out[] = []
  for (const input of calls) outs.push(await call($, { ...input, agentId: `a-${id}` }))
  during()
  await complete($, id, text)
  return outs
}
const offer = ($: Engine) => $.agent.offer({ agent: 'general-purpose', description: 'việc chung', source: 'built-in', provider: { plugin: 'engine', tier: 'core' } } as never)
async function open($: Engine, seen: Seen, steps: ReadonlyArray<Record<string, unknown>> = [{ title: 'Sửa phí' }], text = 'Sửa luồng phí') {
  await offer($)
  await submit($, text)
  await $.tool.call({ tool: PLAN, action: 'set', steps } as never)
  await $.turn.start({ text, turnId: 't1' })
  await step($, seen, { turnId: 't1' })
}
async function edit($: Engine, fs: Fs | null, path = SRC, text = 'export const phi = 2\n', mtimeMs = 100) {
  await call($, { tool: 'Edit', file_path: path, old_string: 'a', new_string: 'b' })
  fs?.set(path, text, mtimeMs)
}
async function start($: Engine, seen: Seen, fs: Fs | null) {
  fs?.set(SRC, 'export const phi = 1\n', 50)
  await open($, seen)
  await edit($, fs)
  await call($, { tool: 'Bash', command: 'bun test' })
}
async function close($: Engine, count = 1) {
  for (let k = 1; k <= count; k++) await $.tool.call({ tool: PLAN, action: 'update', step: k, status: 'done' })
}

describe('K1: kịch bản kỷ luật giao việc từ đầu tới cuối', () => {
  for (const conductor of ['off', 'opus'] as const) {
    test(`K1 conductor ${conductor}: không lời gọi nào bị từ chối ngoài lệnh kiểm của luồng chính khi điều phối; cổng Stop không chặn`, OPTS({ conductor }), async ($, on) => {
      const fs = new Fs()
      const seen = setup(on, fs, GOAL({ main: conductor === 'off' ? { model: 'sonnet', effort: 'medium' } : { model: 'opus', effort: 'high' } }))
      for (const k of [1, 2, 3]) fs.set(`/repo/src/f${k}.ts`, `export const f${k} = 0\n`, 10)
      await open($, seen, [1, 2, 3].map(k => ({ title: `M${k}: sửa tệp ${k}`, check: '`bun test`' })))
      const denied: string[] = []
      const main = async (input: Record<string, unknown>) => {
        const out = await call($, input)
        if (out.deny !== undefined) denied.push(String(input['command'] ?? input['file_path'] ?? input['tool']))
        return out
      }
      await main({ tool: 'Skill', skill: 'ky-luat-giao-viec' })
      await main({ tool: 'Bash', command: 'pwd' })
      const boot = "bash <<'SH'\nset -euo pipefail\ncd /repo\ngit rev-parse --short HEAD\nbun test\nSH"
      await main({ tool: 'Bash', command: boot })
      await main({ tool: 'Write', file_path: `${W}/KE-HOACH.md`, content: '# Kế hoạch' })
      await main({ tool: 'Write', file_path: `${W}/TIEN-DO.md`, content: '# Tiến độ' })
      await main({ tool: 'Bash', command: `mkdir -p ${W}/backup && cp /repo/src/f1.ts ${W}/backup/f1.ts` })
      const edits = [1, 2, 3].map(k => ({ tool: 'Edit', file_path: `/repo/src/f${k}.ts`, old_string: 'a', new_string: 'b' }))
      if (conductor === 'off') {
        for (const input of edits) await main(input)
        await main({ tool: 'Bash', command: 'bun test' })
      } else {
        await agent($, 'Việc 1: sửa ba tệp', 'Đã sửa ba tệp, bun test đạt.', [...edits, { tool: 'Bash', command: 'bun test' }])
        await main({ tool: 'Bash', command: 'bun test' })
      }
      for (const k of [1, 2, 3]) fs.set(`/repo/src/f${k}.ts`, `export const f${k} = 1\n`, 20)
      const review = await agent($, 'Kiểm độc lập: rà ba tệp', 'đạt kèm lỗi nhẹ\n- Nhỏ: tên biến', [
        { tool: 'Bash', command: 'git diff' },
        { tool: 'Bash', command: 'mkdir -p /tmp/ra-soat && cp -r /repo/src /tmp/ra-soat/' },
        { tool: 'Bash', command: 'cd /tmp/ra-soat && bun probe.ts && node probe.js && bash probe.sh && python3 probe.py' },
      ])
      denied.push(...review.filter(o => o.deny !== undefined).map(() => 'review'))
      await main({ tool: 'Edit', file_path: `${W}/TIEN-DO.md`, old_string: 'a', new_string: 'b' })
      await main({ tool: 'Bash', command: `cp /repo/src/f1.ts ${W}/backup/f1.ts && shasum -a 256 ${W}/backup/f1.ts > ${W}/backup/f1.sha256` })
      await main({ tool: 'Bash', command: 'git add -A && git commit -m "M1 tới M3"' })
      await main({ tool: 'Bash', command: boot })
      await close($, 3)
      expect(denied.filter(d => !(conductor === 'opus' && (d === 'bun test' || d === boot)))).toEqual([])
      expect(await stop($)).toBe('')
    })
  }
})

describe('K2: người duyệt chép mã sang thư mục tạm và chạy probe', () => {
  test('K2 mktemp, mktemp -d, pushd, popd, git trong thư mục tạm: không bị từ chối, kết luận được tính', OPTS(), async ($, on) => {
    const fs = new Fs()
    const seen = setup(on, fs)
    await start($, seen, fs)
    const outs = await agent($, 'Kiểm độc lập: phí', 'ĐẠT', [
      { tool: 'Bash', command: 'TMP=$(mktemp -d) && cp -r /repo/src "$TMP" && cd "$TMP" && bun probe.ts' },
      { tool: 'Bash', command: 'cd "$(mktemp -d)" && cp -r /repo/src . && node probe.js' },
      { tool: 'Bash', command: 'F=$(mktemp) && echo x > "$F"' },
      { tool: 'Bash', command: 'pushd /tmp/ra-soat && cp -r /repo/src . && bash probe.sh && popd' },
      { tool: 'Bash', command: 'cd /tmp/ra-soat && git init && git add -A && git commit -m mau' },
    ])
    expect(outs.map(o => o.deny)).toEqual(outs.map(() => undefined))
    await close($)
    expect(await stop($)).toBe('')
  })
  test('K2 đối chứng: sau popd về thư mục dự án, sed -i vào src vẫn bị từ chối', OPTS(), async ($, on) => {
    const fs = new Fs()
    const seen = setup(on, fs)
    await start($, seen, fs)
    const outs = await agent($, 'Kiểm độc lập: phí', 'ĐẠT', [{ tool: 'Bash', command: 'pushd /tmp/ra-soat && popd && sed -i s/a/b/ src/phi.ts' }])
    expect(outs[0]?.deny).toBeDefined()
  })
})

describe('K3: mục tiêu light sửa 1 file', () => {
  test('K3 không đoạn dặn bước đóng, không chặn', OPTS(), async ($, on) => {
    const seen = setup(on, null, GOAL({ depth: 'light', volume: 'small' }))
    await open($, seen)
    const out = await call($, { tool: 'Edit', file_path: SRC, old_string: 'a', new_string: 'b' })
    await call($, { tool: 'Bash', command: 'bun test' })
    await close($)
    expect([...seen.contexts.flat(), ...(out.context ?? [])].some(c => c.includes('Trước khi kết thúc'))).toBe(false)
    expect(await stop($)).toBe('')
  })
})

describe('K4: đủ điều kiện bật mà thiếu duyệt', () => {
  test('K4 chặn một lần cho trạng thái đó, lý do nêu bước còn thiếu', OPTS(), async ($, on) => {
    const seen = setup(on, null)
    await start($, seen, null)
    await close($)
    expect(await stop($)).toContain(BLOCK)
    expect(await stop($)).toBe('')
  })
})

describe('K5: subagent từ sonnet trở lên, không ghi gì, trả ĐẠT hay đạt kèm lỗi nhẹ', () => {
  for (const description of ['Kiểm độc lập: phí', 'Rà lại thay đổi phí']) {
    for (const answer of ['ĐẠT', 'đạt kèm lỗi nhẹ\n- Nhỏ: tên biến']) {
      test(`K5 "${description}" trả "${answer.split('\n')[0]}": được tính`, OPTS(), async ($, on) => {
        const fs = new Fs()
        const seen = setup(on, fs)
        await start($, seen, fs)
        model = 'claude-sonnet-5-5'
        await agent($, description, answer, [{ tool: 'Bash', command: 'git diff' }])
        await close($)
        expect(await stop($)).toBe('')
      })
    }
  }
})

describe('K6, K7, K8: lượt không được tính', () => {
  test('K6 subagent tiền tố "Kiểm: " trả ĐẠT HẾT: không tính là duyệt', OPTS(), async ($, on) => {
    const fs = new Fs()
    const seen = setup(on, fs)
    await start($, seen, fs)
    await agent($, 'Kiểm: bun test', 'ĐẠT HẾT 12/12')
    await close($)
    expect(await stop($)).toContain(BLOCK)
  })
  test('K7 subagent chạy haiku trả ĐẠT: không tính', OPTS(), async ($, on) => {
    const fs = new Fs()
    const seen = setup(on, fs)
    await start($, seen, fs)
    model = 'claude-haiku-5-5'
    await agent($, 'Kiểm độc lập: phí', 'ĐẠT')
    await close($)
    expect(await stop($)).toContain(BLOCK)
  })
  test('K8 subagent có ghi file dự án (Edit, hay sed -i khi không bị chặn) trả ĐẠT: không tính', OPTS(), async ($, on) => {
    const fs = new Fs()
    const seen = setup(on, fs)
    await start($, seen, fs)
    await agent($, 'Rà và sửa phí', 'ĐẠT', [{ tool: 'Edit', file_path: '/repo/src/phu.ts', old_string: 'a', new_string: 'b' }])
    await call($, { tool: 'Bash', command: 'bun test' })
    await close($)
    expect(await stop($)).toContain(BLOCK)
  })
})

describe('K9, K10, K11: hết hiệu lực', () => {
  test('K9 sửa file sau lượt duyệt: hết hiệu lực, chặn; mọi lần chặn nêu tên file', OPTS(), async ($, on) => {
    const fs = new Fs()
    const seen = setup(on, fs)
    await start($, seen, fs)
    await agent($, 'Kiểm độc lập: phí', 'ĐẠT')
    await close($)
    expect(await stop($)).toBe('')
    await edit($, fs, SRC, 'export const phi = 3\n', 300)
    await call($, { tool: 'Bash', command: 'bun test' })
    const first = await stop($)
    expect(first).toContain(BLOCK)
    expect(first).toContain('phi.ts')
    await edit($, fs, '/repo/src/phu.ts', 'export const phu = 1\n', 310)
    await call($, { tool: 'Bash', command: 'bun test' })
    const second = await stop($)
    expect(second).toContain(BLOCK)
    expect(second).toContain('phu.ts')
  })
  test('K9 không có fs: sửa file sau lượt duyệt vẫn chặn và nêu tên file', OPTS(), async ($, on) => {
    const seen = setup(on, null)
    await start($, seen, null)
    await agent($, 'Kiểm độc lập: phí', 'ĐẠT')
    await close($)
    expect(await stop($)).toBe('')
    await edit($, null)
    await call($, { tool: 'Bash', command: 'bun test' })
    expect(await stop($)).toContain('phi.ts')
  })
  test('K10 nội dung đổi giữa lúc sinh và lúc hoàn tất (không qua lời gọi nào): hết hiệu lực', OPTS(), async ($, on) => {
    const fs = new Fs()
    const seen = setup(on, fs)
    await start($, seen, fs)
    await agent($, 'Kiểm độc lập: phí', 'ĐẠT', [], () => fs.set(SRC, 'export const phi = 5\n', 200))
    await close($)
    expect(await stop($)).toContain(BLOCK)
  })
  test('K10 nội dung đổi ngay khi subagent khởi chạy (trước khi mod kịp chụp nếu chụp sau next): hết hiệu lực', OPTS(), async ($, on) => {
    const fs = new Fs()
    const seen = setup(on, fs)
    await start($, seen, fs)
    onStart = () => fs.set(SRC, 'export const phi = 6\n', 210)
    await agent($, 'Kiểm độc lập: phí', 'ĐẠT')
    onStart = () => {}
    await close($)
    expect(await stop($)).toContain(BLOCK)
  })
  test('K10 nội dung đổi sau lúc hoàn tất: hết hiệu lực', OPTS(), async ($, on) => {
    const fs = new Fs()
    const seen = setup(on, fs)
    await start($, seen, fs)
    await agent($, 'Kiểm độc lập: phí', 'ĐẠT')
    await close($)
    expect(await stop($)).toBe('')
    fs.set(SRC, 'export const phi = 8\n', 400)
    expect(await stop($)).toContain('phi.ts')
  })
  test('K11 SKILL.md đổi trong lượt duyệt hay sau lượt duyệt: hết hiệu lực; .md dưới thư mục skill cũng vậy', OPTS(), async ($, on) => {
    const fs = new Fs()
    const seen = setup(on, fs)
    await open($, seen)
    const SKILL = '/repo/skills/ra-soat/SKILL.md'
    const REF = '/repo/skills/ra-soat/references/mau.md'
    await edit($, fs, SKILL, '# skill\n', 100)
    await edit($, fs, REF, '# mẫu\n', 100)
    await call($, { tool: 'Bash', command: 'bun test' })
    await agent($, 'Kiểm độc lập: skill', 'ĐẠT', [], () => fs.set(REF, '# mẫu khác\n', 150))
    await close($)
    expect(await stop($)).toContain('mau.md')
    await agent($, 'Kiểm độc lập: skill lần hai', 'ĐẠT')
    expect(await stop($)).toBe('')
    fs.set(SKILL, '# skill khác\n', 500)
    expect(await stop($)).toContain('SKILL.md')
  })
})

describe('K12: việc dọn sau lượt duyệt', () => {
  test('K12 tệp tiến độ, sao lưu, git commit, chạy lại khối khởi động: còn hiệu lực', OPTS(), async ($, on) => {
    const fs = new Fs()
    const seen = setup(on, fs)
    await start($, seen, fs)
    await agent($, 'Kiểm độc lập: phí', 'ĐẠT')
    await call($, { tool: 'Write', file_path: `${W}/TIEN-DO.md`, content: 'x' })
    await call($, { tool: 'Bash', command: `cp ${SRC} ${W}/backup/phi.ts && shasum -a 256 ${W}/backup/phi.ts > ${W}/backup/phi.sha256` })
    await call($, { tool: 'Bash', command: 'git add -A && git commit -m "M1"' })
    await call($, { tool: 'Bash', command: "bash <<'SH'\nnpm install\nbun test\nSH" })
    await close($)
    expect(await stop($)).toBe('')
  })
})

describe('K13: fs đo được hay không', () => {
  test('K13 fs không phản hồi ở mọi mốc: chạy theo sổ, kết luận được tính; sửa sau đó thì chặn', OPTS(), async ($, on) => {
    const fs = new Fs()
    fs.broken = true
    const seen = setup(on, fs)
    await start($, seen, fs)
    await agent($, 'Kiểm độc lập: phí', 'ĐẠT', [{ tool: 'Bash', command: 'python3 scripts/thu.py' }])
    await close($)
    expect(await stop($)).toBe('')
    await edit($, fs)
    await call($, { tool: 'Bash', command: 'bun test' })
    expect(await stop($)).toContain(BLOCK)
  })
  for (const at of ['spawn', 'complete', 'gate'] as const) {
    test(`K13 fs đo được ở mốc khác mà không đo được lúc ${at}: không tính`, OPTS(), async ($, on) => {
      const fs = new Fs()
      const seen = setup(on, fs)
      await start($, seen, fs)
      const id = await (async () => {
        if (at === 'spawn') fs.broken = true
        const value = await spawn($, 'Kiểm độc lập: phí')
        fs.broken = at === 'complete'
        return value
      })()
      await complete($, id, 'ĐẠT')
      fs.broken = at === 'gate'
      await close($)
      expect(await stop($)).toContain(BLOCK)
    })
  }
})

describe('K14: vòng sửa và dòng kết luận', () => {
  test('K14 CHƯA ĐẠT đi vào vòng sửa: câu dặn vòng 1', OPTS(), async ($, on) => {
    const fs = new Fs()
    const seen = setup(on, fs)
    await start($, seen, fs)
    await agent($, 'Kiểm độc lập: phí', 'CHƯA ĐẠT\n- Lớn: thiếu test phí âm')
    const out = await call($, { tool: 'Read', file_path: SRC })
    expect((out.context ?? []).join('\n')).toContain('vòng 1/3')
  })
  test('K14 các dạng dòng kết luận đọc đúng luật đóng', () => {
    const cases: ReadonlyArray<readonly [string, string | null]> = [
      ['ĐẠT', 'pass'], ['Kết luận: **ĐẠT**', 'pass'], ['đạt kèm lỗi nhẹ', 'pass'], ['ĐẠT KÈM 2 LỖI NHẸ', 'pass'], ['PASS with minor issues', 'pass'],
      ['ĐẠT, nhưng còn thiếu', 'fail'], ['ĐẠT, còn 2 lỗi lớn', 'fail'], ['READY WITH BLOCKERS', 'not-ready'], ['PASS, 1 critical', 'fail'],
      ['ĐẠT (12/12 mục)', null], ['ĐẠT phần lớn', null], ['ĐẠT, vừa kiểm xong', null], ['ĐẠT\nCHƯA ĐẠT', 'fail'], ['CHƯA ĐẠT\nĐẠT', 'fail'],
      ['Đã rà xong.', null],
    ]
    for (const [text, verdict] of cases) expect(verdictOf(text)?.verdict ?? null, text).toBe(verdict)
  })
})

describe('K15: không chặn', () => {
  test('K15 closingReview off: không chặn', OPTS({ closingReview: 'off' }), async ($, on) => {
    const seen = setup(on, null)
    await start($, seen, null)
    await close($)
    expect(await stop($)).toBe('')
  })
  test('K15 phiên không giao được subagent: không chặn', OPTS(), async ($, on) => {
    const seen = setup(on, null)
    await submit($, 'Sửa luồng phí')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa phí' }] } as never)
    await $.turn.start({ text: 'Sửa luồng phí', turnId: 't1' })
    await step($, seen, { turnId: 't1' })
    await edit($, null)
    await call($, { tool: 'Bash', command: 'bun test' })
    await close($)
    expect(await stop($)).not.toContain(BLOCK)
  })
})

describe('K16: lượt của mục tiêu cũ', () => {
  test('K16 lượt của mục tiêu cũ hoàn tất sau khi đổi mục tiêu: không đụng kết luận của mục tiêu mới', OPTS(), async ($, on) => {
    const fs = new Fs()
    let round = 0
    const seen = setup(on, fs, () => (round += 1) === 1 ? GOAL() : GOAL({ goal: 'Sửa luồng thuế' }))
    await start($, seen, fs)
    const old = await spawn($, 'Kiểm độc lập: phí')
    await submit($, 'Giờ sửa luồng thuế')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa thuế' }] } as never)
    await edit($, fs, '/repo/src/thue.ts', 'export const thue = 1\n', 600)
    await call($, { tool: 'Bash', command: 'bun test' })
    await agent($, 'Kiểm độc lập: thuế', 'ĐẠT')
    await complete($, old, 'CHƯA ĐẠT')
    await close($)
    expect(await stop($)).toBe('')
  })
})

describe('K17: không gọi fs', () => {
  test('K17 subagent Explore chạy haiku: không gọi fs', OPTS(), async ($, on) => {
    const fs = new Fs()
    const seen = setup(on, fs)
    await start($, seen, fs)
    fs.calls = 0
    model = 'claude-haiku-5-5'
    await agent($, 'Tìm chỗ gọi phí', 'Tìm thấy ở src/phi.ts:3', [], () => {}, 'Explore')
    expect(fs.calls).toBe(0)
  })
  test('K17 mục tiêu chưa sửa file: sinh lượt duyệt không gọi fs', OPTS(), async ($, on) => {
    const fs = new Fs()
    const seen = setup(on, fs)
    await open($, seen)
    fs.calls = 0
    await agent($, 'Kiểm độc lập: phí', 'ĐẠT')
    expect(fs.calls).toBe(0)
  })
})

describe('Ca bổ sung cho đột biến của vòng sửa cuối', () => {
  test('K13 fs chỉ đo được lúc hoàn tất (không đo được lúc sinh và lúc cổng xét): không tính', OPTS(), async ($, on) => {
    const fs = new Fs()
    const seen = setup(on, fs)
    await start($, seen, fs)
    fs.broken = true
    const id = await spawn($, 'Kiểm độc lập: phí')
    fs.broken = false
    await complete($, id, 'ĐẠT')
    fs.broken = true
    await close($)
    expect(await stop($)).toContain(BLOCK)
  })
  test('K13 fs không phản hồi ở mọi mốc, luồng chính sửa file trong lúc lượt duyệt chạy: không tính', OPTS(), async ($, on) => {
    const fs = new Fs()
    fs.broken = true
    const seen = setup(on, fs)
    await start($, seen, fs)
    const id = await spawn($, 'Kiểm độc lập: phí')
    await edit($, fs, SRC, 'export const phi = 4\n', 150)
    await call($, { tool: 'Bash', command: 'bun test' })
    await complete($, id, 'ĐẠT')
    await close($)
    expect(await stop($)).toContain(BLOCK)
  })
  test('K8 subagent ghi definite vào node_modules của dự án trả ĐẠT: không tính', OPTS(), async ($, on) => {
    const fs = new Fs()
    const seen = setup(on, fs)
    await start($, seen, fs)
    await agent($, 'Rà phí', 'ĐẠT', [{ tool: 'Edit', file_path: '/repo/node_modules/x/a.js', old_string: 'a', new_string: 'b' }])
    await call($, { tool: 'Bash', command: 'bun test' })
    await close($)
    const block = await stop($)
    expect(block).toContain(BLOCK)
    expect(block).not.toContain('lần kiểm')
  })
  test('K9 dấu đổi không qua lời gọi rồi sửa thêm file khác: lần chặn sau vẫn nêu file đổi dấu', OPTS(), async ($, on) => {
    const fs = new Fs()
    const seen = setup(on, fs)
    await start($, seen, fs)
    await agent($, 'Kiểm độc lập: phí', 'ĐẠT')
    await close($)
    expect(await stop($)).toBe('')
    fs.set(SRC, 'export const phi = 9\n', 700)
    expect(await stop($)).toContain('phi.ts')
    await edit($, fs, '/repo/src/phu.ts', 'export const phu = 2\n', 710)
    await call($, { tool: 'Bash', command: 'bun test' })
    expect(await stop($)).toContain('phi.ts')
  })
})

// Dòng đầu nguyên văn của ba lượt "Kiểm độc lập" trong phiên thật D4 (VERIFICATION, mục 0.9.0, phiên thật D4 sau vòng sửa cuối).
const D4_LINES = [
  '**Kết luận: đạt kèm lỗi nhẹ.** Tôi tự chạy lại mọi lệnh và không sửa file nào. Dữ liệu thử nằm trong `mktemp -d` và đã xóa.',
  '**ĐẠT, kèm lỗi nhỏ.** Không có lỗi Nghiêm trọng hay Lớn. Tôi không sửa file nào. Dữ liệu thử nằm trong một thư mục `mktemp -d` và đã xoá bằng trap. Git status vẫn như lúc đầu: `src/thong-ke.sh` đã sửa, `src/dem.sh` và `tests/kiem-cot.sh` là file mới chưa track, chưa có commit nào ngoài `init`.',
  '**ĐẠT**, chỉ có vài lỗi Nhỏ. Không có lỗi Nghiêm trọng hay Lớn. Tôi không sửa file nào: `git status` chỉ có `M src/thong-ke.sh`, `?? src/dem.sh` và `?? tests/kiem-cot.sh`, còn `tests/kiem.sh` và `data/` không đổi. Thư mục thử tạo bằng mktemp đã xoá.',
]

describe('K18: đọc kết luận theo câu đầu của dòng kết luận', () => {
  test('K18 ba dòng đầu của phiên D4 là đạt; các dạng của luật mới đọc đúng', () => {
    for (const line of D4_LINES) expect(verdictOf(`${line}\n\nChi tiết ...`)?.verdict, line.slice(0, 40)).toBe('pass')
    const cases: ReadonlyArray<readonly [string, string | null]> = [
      ['ĐẠT, nhưng còn 2 lỗi lớn', 'fail'],
      ['ĐẠT. Không có lỗi nghiêm trọng', 'pass'],
      ['ĐẠT (12/12 mục)', 'pass'],
      ['ĐẠT phần lớn', null],
      ['READY WITH BLOCKERS', 'not-ready'],
      ['ĐẠT, nhưng không có lỗi nghiêm trọng nào', 'pass'],
      ['PASS, but 1 major issue remains', 'fail'],
      ['ĐẠT kèm lỗi vặt', 'pass'],
      ['PASS with minor issues', 'pass'],
      ['ĐẠT một phần', null],
      ['CHƯA ĐẠT, chỉ có lỗi nhỏ', 'fail'],
      ['ĐẠT\nCHƯA ĐẠT', 'fail'],
    ]
    for (const [text, verdict] of cases) expect(verdictOf(text)?.verdict ?? null, text).toBe(verdict)
  })
  test('K18 lượt có tiền tố duyệt trả câu dòng đầu của phiên D4: được tính, cổng cho qua', OPTS(), async ($, on) => {
    const fs = new Fs()
    const seen = setup(on, fs)
    await start($, seen, fs)
    await agent($, 'Kiểm độc lập: phí', `${D4_LINES[1]}\n\nChi tiết lỗi nhỏ: tên biến.`)
    await close($)
    expect(await stop($)).toBe('')
  })
  test('K18 lượt có tiền tố không có dòng kết luận nào: vẫn tính, kèm dòng nhắc luồng chính đọc kết quả', OPTS(), async ($, on) => {
    const fs = new Fs()
    const seen = setup(on, fs)
    await start($, seen, fs)
    await agent($, 'Kiểm độc lập: phí', 'Đã rà phí và test.\n- Nhỏ: tên biến chưa rõ.')
    const out = await call($, { tool: 'Read', file_path: SRC })
    const note = (out.context ?? []).find(c => c.includes('đọc kết quả')) ?? ''
    expect(note).not.toBe('')
    expect(note.length).toBeLessThanOrEqual(160)
    await close($)
    expect(await stop($)).toBe('')
  })
  test('K18 lượt không tiền tố không có từ đạt: không tính', OPTS(), async ($, on) => {
    const fs = new Fs()
    const seen = setup(on, fs)
    await start($, seen, fs)
    await agent($, 'Rà lại thay đổi phí', 'Đã rà phí và test, nhìn chung ổn.')
    await close($)
    expect(await stop($)).toContain(BLOCK)
  })
})

describe('K19: lệnh kiểm qua ống che mã thoát', () => {
  const CHECK = { options: { planApproval: 'off', checkCommands: 'bash tests/kiem.sh' } }
  async function begin($: Engine, seen: Seen, fs: Fs) {
    fs.set(SRC, 'export const phi = 1\n', 50)
    await open($, seen)
    await edit($, fs)
  }
  test('K19 bash tests/kiem.sh | tail -1: có dòng nhắc ở kết quả, không tính; lý do chặn nêu ống lệnh', CHECK, async ($, on) => {
    const fs = new Fs()
    const seen = setup(on, fs)
    await begin($, seen, fs)
    const out = await call($, { tool: 'Bash', command: 'bash tests/kiem.sh | tail -1' })
    const note = (out.context ?? []).find(c => c.includes('ống')) ?? ''
    expect(note).not.toBe('')
    expect(note.length).toBeLessThanOrEqual(160)
    await agent($, 'Kiểm độc lập: phí', 'ĐẠT')
    await close($)
    const block = await stop($)
    expect(block).toContain('chưa có lần kiểm đạt')
    expect(block).toContain('ống')
  })
  test('K19 cùng lệnh không kèm ống: tính', CHECK, async ($, on) => {
    const fs = new Fs()
    const seen = setup(on, fs)
    await begin($, seen, fs)
    const out = await call($, { tool: 'Bash', command: 'bash tests/kiem.sh' })
    expect((out.context ?? []).some(c => c.includes('ống'))).toBe(false)
    await agent($, 'Kiểm độc lập: phí', 'ĐẠT')
    await close($)
    expect(await stop($)).toBe('')
  })
  test('K19 set -o pipefail; bash tests/kiem.sh | tail -1: tính khi đạt, không nhắc', CHECK, async ($, on) => {
    const fs = new Fs()
    const seen = setup(on, fs)
    await begin($, seen, fs)
    const out = await call($, { tool: 'Bash', command: 'set -o pipefail; bash tests/kiem.sh | tail -1' })
    expect((out.context ?? []).some(c => c.includes('ống'))).toBe(false)
    await agent($, 'Kiểm độc lập: phí', 'ĐẠT')
    await close($)
    expect(await stop($)).toBe('')
  })
  test('K19 lệnh ở check của bước qua ống cũng được nhắc; mỗi mục tiêu nhắc tối đa hai lần', { options: { planApproval: 'off' } }, async ($, on) => {
    const fs = new Fs()
    const seen = setup(on, fs)
    fs.set(SRC, 'export const phi = 1\n', 50)
    await open($, seen, [{ title: 'Sửa phí', check: '`bash tests/kiem-cot.sh` => TỔNG: ĐẠT' }])
    await edit($, fs)
    const outs = []
    for (let k = 0; k < 3; k++) outs.push(await call($, { tool: 'Bash', command: 'bash tests/kiem-cot.sh | tail -1' }))
    expect(outs.map(o => (o.context ?? []).some(c => c.includes('ống')))).toEqual([true, true, false])
  })
})
