// 0.9.0 B6 (tích hợp): đường dẫn thuộc tệp trạng thái hay nơi ghi phụ (B1) không bao giờ là file skill: không bị đòi thử skill, không vào
// cảnh báo chưa kiểm. SKILL.md và .md dưới skills/ ngoài hai danh sách giữ như 0.8.9. Mục tiêu có phạm vi chạm file skill: câu dặn lập kế
// hoạch thêm một vế (không quá 120 ký tự) nêu phải có bước thử skill với description mở đầu "Thử skill: ". Dựng lại H5 hai ca.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import * as A from '../../hooks/lib/approval'
import { base, plan, step, submit } from '../support/engine'
import type { Json, Seen } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const SKILL_DIR = '/home/u/.claude/skills/abc'
const OFF = { options: { planApproval: 'off' } }
const TRIAL = 'chưa thử sau lần sửa cuối'
const goalOf = (over: Json = {}) =>
  plan({ goal: 'Sửa skill abc', depth: 'substantial', volume: 'medium', main: { model: 'sonnet', effort: 'medium' }, stateFiles: [`${SKILL_DIR}/TIEN-DO.md`], sideWrites: ['/work/backup'], ...over })

function setup(on: On, reply: Json): Seen {
  const seen = base(on, { router: request => (request.startsWith('Requirements:') ? { missing: [], extra: [], issues: [] } : reply) })
  on('tool.call', { tool: /^(?:Write|Edit|Bash)$/ }, () => ({ result: 'ok' }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  return seen
}
const stop = async ($: Engine) => String(((await $.classic.Stop({ stop_hook_active: false } as never)) as { block?: string }).block ?? '')
async function run($: Engine, seen: Seen, work: () => Promise<unknown>) {
  await submit($, 'Sửa skill abc')
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa skill abc' }] })
  await $.turn.start({ text: 'Sửa skill abc', turnId: 't1' })
  await step($, seen, { turnId: 't1' })
  await work()
  await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
}

describe('0.9.0 B6: tệp trạng thái và nơi sao lưu không là file skill', () => {
  test('cp SKILL.md vào nơi sao lưu .../skills/abc/SKILL.md: cổng Stop không đòi thử skill', OFF, async ($, on) => {
    const seen = setup(on, goalOf())
    await run($, seen, () => $.tool.call({ tool: 'Bash', command: `cp ${SKILL_DIR}/SKILL.md /work/backup/skills/abc/SKILL.md` } as never))
    expect(await stop($)).not.toContain(TRIAL)
  })
  test('Write vào <thư mục skill>/TIEN-DO.md (tệp trạng thái): cổng Stop không đòi thử skill TIEN-DO', OFF, async ($, on) => {
    const seen = setup(on, goalOf())
    await run($, seen, () => $.tool.call({ tool: 'Write', file_path: `${SKILL_DIR}/TIEN-DO.md`, content: 'x' } as never))
    expect(await stop($)).not.toContain(TRIAL)
  })
  test('đối chứng: sửa SKILL.md thật vẫn bị chặn một lần khi chưa thử', OFF, async ($, on) => {
    const seen = setup(on, goalOf())
    await run($, seen, () => $.tool.call({ tool: 'Edit', file_path: `${SKILL_DIR}/SKILL.md`, old_string: 'a', new_string: 'b' } as never))
    expect(await stop($)).toContain(TRIAL)
    expect(await stop($)).not.toContain(TRIAL)
  })
})

describe('0.9.0 B6: nơi sao lưu không vào cảnh báo chưa kiểm', () => {
  test('cp tệp .ts vào nơi sao lưu: cổng Stop không đòi chạy kiểm; đối chứng cp vào src thì có', { options: { planApproval: 'off', checkCommands: 'bun test' } }, async ($, on) => {
    const seen = setup(on, goalOf())
    await run($, seen, () => $.tool.call({ tool: 'Bash', command: 'cp /work/repo/src/a.ts /work/backup/a.ts' } as never))
    expect(await stop($)).not.toContain('chưa chạy lần kiểm nào')
  })
  test('đối chứng: cp tệp .ts vào src thì cổng Stop đòi chạy kiểm', { options: { planApproval: 'off', checkCommands: 'bun test' } }, async ($, on) => {
    const seen = setup(on, goalOf())
    await run($, seen, () => $.tool.call({ tool: 'Bash', command: 'cp /work/backup/a.ts /work/repo/src/a.ts' } as never))
    expect(await stop($)).toContain('chưa chạy lần kiểm nào')
  })
})

describe('0.9.0 B6: câu dặn lập kế hoạch khi phạm vi chạm file skill', () => {
  test('phạm vi có SKILL.md: câu dặn nêu bước thử skill với "Thử skill: ", thêm không quá 120 ký tự', {}, async ($, on) => {
    const seen = setup(on, goalOf({ scope: [`${SKILL_DIR}/SKILL.md`], stateFiles: [], sideWrites: [] }))
    await submit($, 'Sửa skill abc')
    const planning = (seen.contexts.at(-1) ?? []).find(c => c.includes('Việc lớn: lập kế hoạch')) ?? ''
    expect(planning).toContain('Thử skill: ')
    expect(planning.length - A.planningContext().length).toBeGreaterThan(0)
    expect(planning.length - A.planningContext().length).toBeLessThanOrEqual(120)
  })
  test('phạm vi không chạm file skill: không có vế thử skill', {}, async ($, on) => {
    const seen = setup(on, goalOf({ scope: ['src/a.ts'], stateFiles: [], sideWrites: [] }))
    await submit($, 'Sửa skill abc')
    const planning = (seen.contexts.at(-1) ?? []).find(c => c.includes('Việc lớn: lập kế hoạch')) ?? ''
    expect(planning).not.toContain('Thử skill: ')
  })
})
