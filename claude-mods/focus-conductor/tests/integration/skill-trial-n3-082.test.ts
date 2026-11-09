// 0.8.2 N3: sửa file skill (SKILL.md, file .md dưới skills/, hay khớp tiền tố skillPaths) phải thử skill trên ví dụ trước khi báo xong.
// Ghi file skill không là tài liệu nhẹ, không vào cảnh báo chưa kiểm hay cổng Y6; cổng Stop N3 chặn một lần mỗi mục tiêu khi chưa có lần
// thử sau lần ghi cuối: subagent "Thử skill: " trả lời xong, hay lệnh khai trong checkCommands đạt. Lần thử không chạy haiku.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, TurnCompleteInput } from 'claude-code'
import type { Core } from '../../types'
import * as S from '../../hooks/lib/state'
import { isSkillPath, isSoftDocs, newTracker, observe, summarize } from '../../hooks/lib/drift'
import { JS } from '../fixtures/runner-output'
import { PANE, base, plan, spawnTool, step, submit } from '../support/engine'
import type { Json, Seen } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const GOAL = plan({ goal: 'Sửa skill tóm tắt biên bản', depth: 'substantial', volume: 'medium', main: { model: 'sonnet', effort: 'medium' } })
const OFF = { options: { planApproval: 'off' } }
const DECLARED = { options: { planApproval: 'off', checkCommands: 'bun test' } }
const SKILL = 'skills/a/SKILL.md'
const TRIAL = 'chưa thử sau lần sửa cuối'
const NUDGE = 'chưa chạy lần kiểm nào'
const HAIKU = { why: 'tra cứu', model: 'haiku', effort: 'low', agent: 'general-purpose', depth: 'none', volume: 'small', kind: 'investigate' }

function setup(on: On, agent?: (task: string) => Json) {
  const passing = new Set<string>(['bun test'])
  const models: Array<string | undefined> = []
  const agentResults = new Map<string, { result: string; isError?: boolean }>()
  /** Việc "engine" làm trong lúc tool Agent chạy, theo tool_use_id (thứ tự của engine thật: subagent chạy xong trước kết quả tool). */
  const during = new Map<string, () => Promise<unknown>>()
  const seen = base(on, { router: () => GOAL, ...(agent !== undefined ? { agent } : {}) })
  on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: `a-${e.tool_use_id}` }))
  on('tool.call', { tool: 'Agent' }, async (_$, e) => {
    models.push((e as { model?: string }).model)
    const id = String((e as { tool_use_id?: unknown }).tool_use_id)
    await during.get(id)?.()
    return (agentResults.get(id) ?? { result: 'đã thử' }) as never
  })
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Read' }, () => ({ result: 'nội dung', isReadOnly: true }))
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    const command = String((e as { command?: unknown }).command ?? '')
    return passing.has(command) ? { result: JS.bun_pass } : { result: JS.bun_fail, isError: true }
  })
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  return { seen, models, agentResults, during }
}

const edit = ($: Engine, path: string) => $.tool.call({ tool: 'Edit', file_path: path, old_string: 'a', new_string: 'b' } as never)
const read = ($: Engine, path: string) => $.tool.call({ tool: 'Read', file_path: path } as never)
const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never)
const stop = async ($: Engine, active = false) => String(((await $.classic.Stop({ stop_hook_active: active } as never)) as { block?: string }).block ?? '')
const ended = (agentId: string, reason: TurnCompleteInput['reason']) =>
  ({ turnId: `t-${agentId}`, agentId, answer: reason === 'answer' ? 'đã thử' : '', durationMs: 1, isAborted: reason === 'aborted', reason }) as never
const endTurn = ($: Engine) => $.turn.complete({ turnId: 't1', answer: 'xong', durationMs: 1, isAborted: false, reason: 'answer' } as never)

/** Lần thử skill qua subagent: lời gọi Agent "Thử skill: a", rồi subagent kết thúc với `reason`. */
async function trial($: Engine, id: string, reason: TurnCompleteInput['reason'] = 'answer', description = 'Thử skill: a') {
  await spawnTool($, id, description, `Đọc ${SKILL} và làm theo trên hai prompt mẫu`)
  await $.turn.complete(ended(`a-${id}`, reason))
}

/** Mục tiêu một bước, turn t1, `work`, rồi bước đóng done. */
async function goal($: Engine, seen: Seen, work: () => Promise<unknown>) {
  const text = 'Sửa skill tóm tắt biên bản'
  await submit($, text)
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: text }] })
  await $.turn.start({ text, turnId: 't1' })
  await step($, seen, { turnId: 't1' })
  await work()
  await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
}

async function paneTexts($: Engine) {
  const pane = await $.ui.mount(PANE)
  const texts = (await pane.findAll({ type: 'Text' })).map(e => e.text)
  await pane.unmount()
  return texts
}

describe('0.8.2 N3: cổng thử skill', () => {
  test('1. ghi skills/a/SKILL.md, Read lại, Stop: chặn một lần; lần hai cho qua; không có cảnh báo tài liệu nhẹ', OFF, async ($, on) => {
    const { seen } = setup(on)
    await goal($, seen, async () => {
      await edit($, SKILL)
      await read($, SKILL)
    })
    const reason = await stop($)
    expect(reason).toContain(TRIAL)
    expect(reason).toContain('Thử skill: a')
    expect(reason).toContain('"Thử skill"')
    expect(reason.length).toBeLessThanOrEqual(600)
    expect(await stop($)).toBe('')
    await endTurn($)
    const texts = await paneTexts($)
    expect(texts.some(t => t.includes('Skill chưa thử'))).toBe(true)
    expect(texts.some(t => t.includes('thay đổi tài liệu'))).toBe(false)
  })

  test('2. ghi SKILL.md, rồi Agent "Thử skill: a" xong: không chặn, hết mục Skill chưa thử', OFF, async ($, on) => {
    const { seen } = setup(on)
    await goal($, seen, async () => {
      await edit($, SKILL)
      await trial($, 'k1')
    })
    expect(await stop($)).toBe('')
    expect((await paneTexts($)).some(t => t.includes('Skill chưa thử'))).toBe(false)
  })

  test('2b. "Skill trial: " cũng là lần thử', OFF, async ($, on) => {
    const { seen } = setup(on)
    await goal($, seen, async () => {
      await edit($, SKILL)
      await trial($, 'k1', 'answer', 'Skill trial: a')
    })
    expect(await stop($)).toBe('')
  })

  test('3. Agent "Thử skill: a" xong trước, ghi SKILL.md sau: chặn', OFF, async ($, on) => {
    const { seen } = setup(on)
    await goal($, seen, async () => {
      await edit($, SKILL)
      await trial($, 'k1')
      await edit($, SKILL)
    })
    expect(await stop($)).toContain(TRIAL)
  })

  for (const reason of ['aborted', 'error', 'refusal'] as const) {
    test(`4. Agent "Thử skill: a" kết thúc ${reason}: chặn`, OFF, async ($, on) => {
      const { seen } = setup(on)
      await goal($, seen, async () => {
        await edit($, SKILL)
        await trial($, 'k1', reason)
      })
      expect(await stop($)).toContain(TRIAL)
    })
  }

  test('4b. kết quả tool Agent lỗi sau khi subagent trả lời: không tính lần thử', OFF, async ($, on) => {
    const { seen, agentResults, during } = setup(on)
    // Thứ tự của engine thật: subagent khởi động và trả lời trong lúc tool Agent chạy, kết quả tool đến sau.
    const real = (id: string) => async () => {
      await $.agent.spawn({ prompt: 'p', description: 'Thử skill: a', tool_use_id: id } as never)
      await $.turn.complete(ended(`a-${id}`, 'answer'))
    }
    during.set('k2', real('k2'))
    agentResults.set('k2', { result: 'lỗi', isError: true })
    await goal($, seen, async () => {
      await edit($, SKILL)
      await $.tool.call({ tool: 'Agent', tool_use_id: 'k2', description: 'Thử skill: a', prompt: 'p' } as never)
    })
    expect(await stop($)).toContain(TRIAL)
  })

  test('4c. thứ tự của engine thật, kết quả tool Agent không lỗi: lần thử được tính', OFF, async ($, on) => {
    const { seen, during } = setup(on)
    during.set('k3', async () => {
      await $.agent.spawn({ prompt: 'p', description: 'Thử skill: a', tool_use_id: 'k3' } as never)
      await $.turn.complete(ended('a-k3', 'answer'))
    })
    await goal($, seen, async () => {
      await edit($, SKILL)
      await $.tool.call({ tool: 'Agent', tool_use_id: 'k3', description: 'Thử skill: a', prompt: 'p' } as never)
    })
    expect(await stop($)).toBe('')
  })

  test('5. ghi docs/guide.md, Read lại: cảnh báo nhẹ như cũ, không chặn', OFF, async ($, on) => {
    const { seen } = setup(on)
    await goal($, seen, async () => {
      await edit($, 'docs/guide.md')
      await read($, 'docs/guide.md')
    })
    expect(await stop($)).toBe('')
    await endTurn($)
    const texts = await paneTexts($)
    expect(texts.some(t => t.includes('thay đổi tài liệu'))).toBe(true)
    expect(texts.some(t => t.includes('Skill chưa thử'))).toBe(false)
  })

  test('6a. có checkCommands, turn chỉ ghi SKILL.md: Y6 không chặn, không có cảnh báo chưa kiểm; N3 chặn', DECLARED, async ($, on) => {
    const { seen } = setup(on)
    await goal($, seen, () => edit($, SKILL))
    const reason = await stop($)
    expect(reason).not.toContain(NUDGE)
    expect(reason).toContain(TRIAL)
    await endTurn($)
    const texts = await paneTexts($)
    expect(texts.some(t => t.includes('Skill chưa thử'))).toBe(true)
    expect(texts.some(t => t.includes('không chạy bước kiểm tra'))).toBe(false)
    expect(texts.some(t => t.includes('chưa được kiểm tra lại'))).toBe(false)
  })

  test('6b. có checkCommands, turn ghi SKILL.md và hooks/a.ts: Y6 rồi N3, gộp theo thứ tự trong 1.200 ký tự', DECLARED, async ($, on) => {
    const { seen } = setup(on)
    await goal($, seen, async () => {
      await edit($, SKILL)
      await edit($, 'hooks/a.ts')
    })
    const reason = await stop($)
    const y6 = reason.indexOf(NUDGE)
    const n3 = reason.indexOf(TRIAL)
    expect(y6).toBeGreaterThanOrEqual(0)
    expect(n3).toBeGreaterThan(y6)
    expect(reason.length).toBeLessThanOrEqual(1200)
  })

  test('7. skillPaths prompts/, ghi prompts/x.md: chặn', { options: { planApproval: 'off', skillPaths: 'prompts/' } }, async ($, on) => {
    const { seen } = setup(on)
    await goal($, seen, async () => {
      await edit($, 'prompts/x.md')
      await read($, 'prompts/x.md')
    })
    expect(await stop($)).toContain(TRIAL)
  })

  test('8. lệnh khai trong checkCommands đạt sau lần ghi cuối: không chặn', DECLARED, async ($, on) => {
    const { seen } = setup(on)
    await goal($, seen, async () => {
      await edit($, SKILL)
      await bash($, 'bun test')
    })
    expect(await stop($)).toBe('')
  })

  test('8b. lệnh khai đạt trước lần ghi cuối: chặn', DECLARED, async ($, on) => {
    const { seen } = setup(on)
    await goal($, seen, async () => {
      await bash($, 'bun test')
      await edit($, SKILL)
    })
    expect(await stop($)).toContain(TRIAL)
  })

  test('9. Agent "Thử skill: a" không ghi model, router chọn haiku: gửi đi không phải haiku', OFF, async ($, on) => {
    const { seen, models } = setup(on, () => HAIKU)
    await goal($, seen, async () => {
      await edit($, SKILL)
      await trial($, 'k1')
    })
    expect(seen.agentRouted.length).toBeGreaterThan(0)
    expect(models.at(-1)).toBeDefined()
    expect(models.at(-1)).not.toContain('haiku')
  })

  test('9b. lời gọi Agent khác vẫn chạy haiku khi router chọn', OFF, async ($, on) => {
    const { seen, models } = setup(on, () => HAIKU)
    await goal($, seen, () => spawnTool($, 'k1', 'Tìm chỗ gọi hàm', 'Tìm trong src/'))
    expect(models.at(-1)).toContain('haiku')
  })

  test('tier trivial: không chặn', OFF, async ($, on) => {
    const seen = base(on, { router: () => plan({ goal: 'Sửa một chữ', depth: 'none', volume: 'small', main: { model: 'sonnet', effort: 'low' } }) })
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('turn.complete', () => ({ text: '' }))
    on('classic.Stop', () => ({}))
    await goal($, seen, () => edit($, SKILL))
    expect(await stop($)).not.toContain(TRIAL)
  })

  test('enforceChecklist false: không chặn', { options: { planApproval: 'off', enforceChecklist: false } }, async ($, on) => {
    const { seen } = setup(on)
    await goal($, seen, () => edit($, SKILL))
    expect(await stop($)).toBe('')
  })

  test('stop_hook_active: không chặn trong cùng chuỗi dừng, khóa không bị dùng', OFF, async ($, on) => {
    const { seen } = setup(on)
    await goal($, seen, () => edit($, SKILL))
    expect(await stop($, true)).toBe('')
    expect(await stop($)).toContain(TRIAL)
  })

  test('lần ghi skill qua nhiều turn: turn sau chỉ hỏi đáp có tool vẫn giữ trạng thái, lần thử ở turn sau gỡ mục', OFF, async ($, on) => {
    const { seen } = setup(on)
    await goal($, seen, () => edit($, SKILL))
    expect(await stop($)).toContain(TRIAL)
    await endTurn($)
    expect((await paneTexts($)).some(t => t.includes('Skill chưa thử'))).toBe(true)
    await trial($, 'k9')
    expect((await paneTexts($)).some(t => t.includes('Skill chưa thử'))).toBe(false)
  })
})

describe('0.8.2 N3: hàm thuần', () => {
  test('isSkillPath: SKILL.md, .md dưới skills/, không phải file khác', () => {
    expect(isSkillPath('skills/a/SKILL.md')).toBe(true)
    expect(isSkillPath('/p/.claude/x/SKILL.md')).toBe(true)
    expect(isSkillPath('/p/skills/a/ref/guide.md')).toBe(true)
    expect(isSkillPath('/p/skills/a/run.ts')).toBe(false)
    expect(isSkillPath('/p/docs/guide.md')).toBe(false)
    expect(isSkillPath('/p/skill.md')).toBe(false)
  })

  test('isSoftDocs: SKILL.md đã đọc lại không là tài liệu nhẹ; summarize không có cảnh báo chưa kiểm', () => {
    const brief = { goal: 'g', scopePaths: [], tier: 'moderate' as const }
    const tracker = newTracker('t')
    observe(tracker, { tool: 'Edit', input: { file_path: '/p/skills/a/SKILL.md' }, isError: false, isReadOnly: false }, brief, [])
    observe(tracker, { tool: 'Read', input: { file_path: '/p/skills/a/SKILL.md' }, isError: false, isReadOnly: true }, brief, [])
    expect(isSoftDocs(tracker)).toBe(false)
    expect(tracker.skillWrites).toBe(1)
    expect(summarize(tracker, { tier: 'moderate' } as never, []).find(f => f.kind === 'unverified')).toBeUndefined()
  })

  test('Core: skill và skillNudged còn sau vòng JSON; Core cũ mặc định', () => {
    const core = S.withSkillNudged(4)(S.withSkillWrite(4, SKILL)(S.EMPTY_CORE))
    const back = S.normalizeCore(JSON.parse(JSON.stringify(core)) as Partial<Core>)
    expect(back.skillNudged).toBe(4)
    expect(back.skill).toEqual({ goalId: 4, seq: 1, lastWrite: 1, trialAt: -1, path: SKILL })
    expect(S.normalizeCore({} as Partial<Core>).skillNudged).toBe(-1)
    expect(S.normalizeCore({} as Partial<Core>).skill).toEqual({ goalId: -1, seq: 0, lastWrite: -1, trialAt: -1, path: '' })
  })
})
