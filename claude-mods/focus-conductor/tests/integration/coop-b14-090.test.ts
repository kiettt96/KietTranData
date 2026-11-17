// 0.9.0 B14: phối hợp tự động với kỷ luật giao việc. (7) việc dọn sau lượt duyệt (ghi tệp trạng thái, sao lưu kèm shasum, git add, commit,
// tag, push, chạy lại khối khởi động kể cả cài phụ thuộc, lệnh possible không rõ đích) không làm kết luận mất hiệu lực; chỉ lần sửa
// definite vào file không nhẹ ngoài tệp trạng thái, nơi ghi phụ, thư mục tạm và thư mục phụ thuộc, sản phẩm build mới làm. (8) option
// stateFileNames: tên tệp trạng thái mặc định ở bất kỳ thư mục nào. (9) vai điều phối tự lưu bản: ghi nơi ghi phụ, git add, commit, tag,
// push. (10) bước kiểm của cổng đóng tính mọi lần lệnh kiểm chạy đạt sau thay đổi cuối, do ai chạy. (11) dừng cứng vì hạn mức có tệp
// trạng thái: câu báo dừng nêu ghi phần bàn giao vào tệp đó. (12) kịch bản một phiên theo kỷ luật giao việc từ đầu tới cuối.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { JS } from '../fixtures/runner-output'
import { base, plan, step, submit } from '../support/engine'
import type { Json, Seen } from '../support/engine'
import { flatFs, quotaMeter, week } from '../support/quota'

const PLAN = 'mcp__focus-conductor__plan'
const W = '/w/viec'
const GOAL = (over: Json = {}) => plan({ goal: 'Sửa luồng phí', scope: ['/repo/src'], sideWrites: [`${W}/backup/`], depth: 'substantial', volume: 'medium', kind: 'edit', main: { model: 'sonnet', effort: 'medium' }, ...over })
const OPTS = (over: Json = {}) => ({ options: { planApproval: 'off', checkCommands: 'bun test', ...over } })
const BLOCK = 'duyệt độc lập'
type Out = { deny?: string; context?: string[]; result?: unknown }

function setup(on: On, reply: Json = GOAL()): Seen {
  const seen = base(on, { router: () => reply, root: '/repo' })
  on('tool.call', { tool: /^(?:Edit|Write|Read|Agent|Skill)$/ }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: JS.bun_pass }))
  on('agent.spawn', (_$, e) => ({ model: 'claude-opus-5-5', agentId: `a-${String((e as { tool_use_id?: unknown }).tool_use_id)}` }) as never)
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  on('agent.offer', () => ({ isOffered: true }))
  return seen
}
const call = async ($: Engine, input: Record<string, unknown>) => (await $.tool.call(input as never)) as Out
const stop = async ($: Engine) => String(((await $.classic.Stop({ stop_hook_active: false } as never)) as { block?: string }).block ?? '')
let n = 0
async function agent($: Engine, description: string, text: string, calls: ReadonlyArray<Record<string, unknown>> = []) {
  const id = `co${(n += 1)}`
  await $.tool.call({ tool: 'Agent', tool_use_id: id, description, prompt: 'Làm.' } as never)
  await $.agent.spawn({ prompt: 'Làm.', description, tool_use_id: id } as never)
  const outs: Out[] = []
  for (const input of calls) outs.push(await call($, { ...input, agentId: `a-${id}` }))
  await $.turn.complete({ turnId: `x-${id}`, agentId: `a-${id}`, answer: text, durationMs: 5, isAborted: false, reason: 'answer', usage: { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 10 } } as never)
  return outs
}
async function start($: Engine, seen: Seen, steps: ReadonlyArray<Record<string, unknown>> = [{ title: 'Sửa phí' }]) {
  await $.agent.offer({ agent: 'general-purpose', description: 'việc chung', source: 'built-in', provider: { plugin: 'engine', tier: 'core' } } as never)
  await submit($, 'Sửa luồng phí')
  await $.tool.call({ tool: PLAN, action: 'set', steps } as never)
  await $.turn.start({ text: 'Sửa luồng phí', turnId: 't1' })
  await step($, seen, { turnId: 't1' })
}
const closeAll = async ($: Engine, count: number) => {
  for (let k = 1; k <= count; k++) await $.tool.call({ tool: PLAN, action: 'update', step: k, status: 'done' })
}

describe('0.9.0 B14 (7): việc dọn sau lượt duyệt không làm kết luận mất hiệu lực', () => {
  test('ghi tiến độ, sao lưu kèm shasum, git add và commit, chạy lại khối khởi động có npm install: cổng cho qua', OPTS(), async ($, on) => {
    const seen = setup(on)
    await start($, seen)
    await call($, { tool: 'Edit', file_path: '/repo/src/phi.ts', old_string: 'a', new_string: 'b' })
    await call($, { tool: 'Bash', command: 'bun test' })
    await agent($, 'Rà phí', 'ĐẠT')
    await call($, { tool: 'Write', file_path: `${W}/TIEN-DO.md`, content: 'x' })
    await call($, { tool: 'Bash', command: `cp /repo/src/phi.ts ${W}/backup/phi.ts && shasum -a 256 ${W}/backup/phi.ts > ${W}/backup/phi.sha256` })
    await call($, { tool: 'Bash', command: 'git add -A && git commit -m "M1" && git tag m1' })
    await call($, { tool: 'Bash', command: "bash <<'SH'\nnpm install\nbun test\nSH" })
    await closeAll($, 1)
    expect(await stop($)).toBe('')
  })
  test('ghi sản phẩm build vào dist/ và node_modules/ sau lượt duyệt: cổng cho qua', OPTS(), async ($, on) => {
    const seen = setup(on)
    await start($, seen)
    await call($, { tool: 'Edit', file_path: '/repo/src/phi.ts', old_string: 'a', new_string: 'b' })
    await call($, { tool: 'Bash', command: 'bun test' })
    await agent($, 'Rà phí', 'ĐẠT')
    await call($, { tool: 'Bash', command: 'cp /repo/src/phi.ts /repo/dist/phi.js && cp /repo/a.js /repo/node_modules/x/a.js' })
    // Bằng chứng lệnh kiểm vẫn hết hiệu lực như cũ: chạy lại lệnh kiểm; kết luận duyệt thì còn.
    await call($, { tool: 'Bash', command: 'bun test' })
    await closeAll($, 1)
    expect(await stop($)).toBe('')
  })
  test('sửa src sau lượt duyệt: kết luận hết hiệu lực, cổng chặn', OPTS(), async ($, on) => {
    const seen = setup(on)
    await start($, seen)
    await call($, { tool: 'Edit', file_path: '/repo/src/phi.ts', old_string: 'a', new_string: 'b' })
    await call($, { tool: 'Bash', command: 'bun test' })
    await agent($, 'Rà phí', 'ĐẠT')
    await call($, { tool: 'Edit', file_path: '/repo/src/phi.ts', old_string: 'b', new_string: 'c' })
    await call($, { tool: 'Bash', command: 'bun test' })
    await closeAll($, 1)
    expect(await stop($)).toContain(BLOCK)
  })
})

describe('0.9.0 B14 (8): tên tệp trạng thái mặc định', () => {
  test('prompt không khai tệp trạng thái: ghi TIEN-DO.md, PLAN.md ở bất kỳ thư mục nào không sinh cảnh báo ngoài phạm vi', OPTS(), async ($, on) => {
    const seen = setup(on)
    await start($, seen)
    const outs = [await call($, { tool: 'Write', file_path: '/w/khac/TIEN-DO.md', content: 'x' }), await call($, { tool: 'Write', file_path: '/w/khac/PLAN.md', content: 'x' })]
    expect(outs.flatMap(o => o.context ?? []).some(c => c.includes('ngoài phạm vi'))).toBe(false)
  })
  test('stateFileNames để trống: ghi TIEN-DO.md ngoài phạm vi có cảnh báo như trước', OPTS({ stateFileNames: '' }), async ($, on) => {
    const seen = setup(on)
    await start($, seen)
    const out = await call($, { tool: 'Write', file_path: '/w/khac/TIEN-DO.md', content: 'x' })
    expect((out.context ?? []).some(c => c.includes('ngoài phạm vi'))).toBe(true)
  })
})

describe('0.9.0 B14 (9): vai điều phối tự lưu bản', () => {
  test('conductor opus: cp, mkdir -p, shasum vào nơi ghi phụ và git add, commit, tag, push qua; sửa src và chạy kiểm vẫn bị từ chối', OPTS({ conductor: 'opus' }), async ($, on) => {
    const seen = setup(on, GOAL({ depth: 'hard', main: { model: 'opus', effort: 'high' } }))
    await start($, seen)
    for (const command of [`mkdir -p ${W}/backup`, `cp /repo/src/phi.ts ${W}/backup/phi.ts`, `shasum -a 256 ${W}/backup/phi.ts`, 'git add -A', 'git commit -m "M1"', 'git tag m1', 'git push origin HEAD']) {
      expect((await call($, { tool: 'Bash', command })).deny, command).toBeUndefined()
    }
    expect((await call($, { tool: 'Edit', file_path: '/repo/src/phi.ts', old_string: 'a', new_string: 'b' })).deny).toBeDefined()
    expect((await call($, { tool: 'Bash', command: 'bun test' })).deny).toBeDefined()
  })
})

describe('0.9.0 B14 (10): bước kiểm của cổng đóng tính lần kiểm của bất kỳ ai', () => {
  test('subagent không tiền tố chạy bun test sau thay đổi cuối; luồng chính không chạy kiểm: bước kiểm đạt, cổng cho qua', OPTS(), async ($, on) => {
    const seen = setup(on)
    await start($, seen)
    await call($, { tool: 'Edit', file_path: '/repo/src/phi.ts', old_string: 'a', new_string: 'b' })
    await agent($, 'Chạy bộ test', 'Xong', [{ tool: 'Bash', command: 'bun test' }])
    await agent($, 'Rà phí', 'ĐẠT')
    await closeAll($, 1)
    expect(await stop($)).toBe('')
  })
  test('đoạn dặn bước đóng nêu lần kiểm do luồng chính hay subagent chạy', OPTS(), async ($, on) => {
    const seen = setup(on)
    await start($, seen)
    expect(seen.contexts.flat().find(c => c.includes('Trước khi kết thúc')) ?? '').toContain('luồng chính hay subagent chạy')
  })
})

describe('0.9.0 B14 (11): dừng cứng vì hạn mức khi có tệp trạng thái', () => {
  test('câu báo dừng nêu ghi phần bàn giao vào tệp trạng thái đã khai rồi dừng, vế thêm không quá 120 ký tự', { options: { planApproval: 'off' } }, async ($, on) => {
    const seen = base(on, { router: () => GOAL({ stateFiles: [`${W}/DIEM-DUNG.md`] }) })
    const meter = quotaMeter(on, [week(10)])
    flatFs(on)
    on('tool.call', { tool: /^(?:Write|Edit|Bash)$/ }, () => ({ result: 'ok' }))
    await submit($, 'Sửa luồng phí')
    meter.set([week(99)])
    await seen.clock.advance(60_000)
    const deny = (await call($, { tool: 'Write', file_path: '/repo/src/z.ts', content: 'x' })).deny ?? ''
    const clause = deny.slice(deny.indexOf('Ghi phần bàn giao'))
    expect(deny).toContain('Ghi phần bàn giao')
    expect(clause).toContain('DIEM-DUNG.md')
    expect(clause.split('.')[0]!.length).toBeLessThanOrEqual(120)
  })
})

describe('0.9.0 B14 (12): một phiên theo kỷ luật giao việc từ đầu tới cuối', () => {
  for (const conductor of ['off', 'opus'] as const) {
    test(`conductor ${conductor}: không lời gọi nào bị từ chối ngoài lệnh kiểm của luồng chính khi điều phối; không cảnh báo ngoài phạm vi; Stop không chặn; các bước lên verified`, OPTS({ conductor }), async ($, on) => {
      const seen = setup(on, GOAL({ main: conductor === 'off' ? { model: 'sonnet', effort: 'medium' } : { model: 'opus', effort: 'high' } }))
      const steps = [1, 2, 3].map(k => ({ title: `M${k}: sửa tệp ${k}`, check: '`bun test`' }))
      await start($, seen, steps)
      const denied: string[] = []
      const warned: string[] = []
      const main = async (input: Record<string, unknown>) => {
        const out = await call($, input)
        if (out.deny !== undefined) denied.push(String(input['command'] ?? input['file_path'] ?? input['tool']))
        warned.push(...(out.context ?? []).filter(c => c.includes('ngoài phạm vi') || c.includes('không xác định được file đích')))
        return out
      }
      await main({ tool: 'Skill', skill: 'ky-luat-giao-viec' })
      await main({ tool: 'Bash', command: 'pwd' })
      const boot = "bash <<'SH'\nset -euo pipefail\ncd /repo\ngit rev-parse --short HEAD\nshasum -a 256 src/a.ts\nbun test\nSH"
      await main({ tool: 'Bash', command: boot })
      await main({ tool: 'Write', file_path: `${W}/KE-HOACH.md`, content: '# Kế hoạch' })
      await main({ tool: 'Write', file_path: `${W}/TIEN-DO.md`, content: '# Tiến độ' })
      await main({ tool: 'Bash', command: `mkdir -p ${W}/backup && cp /repo/src/a.ts ${W}/backup/a.ts` })
      const edits = [1, 2, 3].flatMap(k => [{ tool: 'Edit', file_path: `/repo/src/f${k}.ts`, old_string: 'a', new_string: 'b' }])
      if (conductor === 'off') {
        for (const input of edits) await main(input)
        await main({ tool: 'Bash', command: 'bun test' })
      } else {
        const outs = await agent($, 'Việc 1: sửa ba tệp', 'Đã sửa ba tệp, bun test đạt.', [...edits, { tool: 'Bash', command: 'bun test' }])
        denied.push(...outs.filter(o => o.deny !== undefined).map(() => 'build'))
        await main({ tool: 'Bash', command: 'bun test' })
      }
      const review = await agent($, 'Kiểm độc lập: rà ba tệp', 'đạt kèm lỗi nhẹ\n- Nhỏ: tên biến', [
        { tool: 'Bash', command: 'git diff' },
        { tool: 'Bash', command: 'mkdir -p /tmp/ra-soat && cp -r /repo/src /tmp/ra-soat/' },
        { tool: 'Bash', command: 'cd /tmp/ra-soat && bash probe.sh' },
      ])
      denied.push(...review.filter(o => o.deny !== undefined).map(() => 'review'))
      await main({ tool: 'Edit', file_path: `${W}/TIEN-DO.md`, old_string: 'a', new_string: 'b' })
      await main({ tool: 'Bash', command: `cp /repo/src/f1.ts ${W}/backup/f1.ts && shasum -a 256 ${W}/backup/f1.ts > ${W}/backup/f1.sha256` })
      await main({ tool: 'Bash', command: 'git add -A && git commit -m "M1 tới M3"' })
      await main({ tool: 'Bash', command: boot })
      for (const k of [1, 2, 3]) await $.tool.call({ tool: PLAN, action: 'update', step: k, status: 'done' })
      const shown = String(((await $.tool.call({ tool: PLAN, action: 'show' } as never)) as Out).result ?? '')
      expect(denied.filter(d => !(conductor === 'opus' && (d === 'bun test' || d === boot)))).toEqual([])
      expect(warned).toEqual([])
      expect(await stop($)).toBe('')
      expect((shown.match(/\[v\]/g) ?? []).length).toBe(3)
    })
  }
})
