// 0.8.4 V1 (vòng 2 PR 37): luồng chính được nhắc lại vai điều phối. Sau nén ngữ cảnh và khi chạy tiếp từ điểm dừng, khi luồng chính
// đang điều phối thì kèm một câu conductorKeepText (trần CONDUCTOR_KEEP_CHARS). Mục tiêu lớn chưa nhận đoạn dặn đầy đủ (mở lúc Fable
// chưa sẵn sàng) thì nhận đoạn dặn ở prompt đầu tiên luồng chính điều phối (Core.fable.briefedGoal), đúng một lần.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Core } from '../../types'
import * as S from '../../hooks/lib/state'
import { CONDUCTOR_KEEP_CHARS, conductorKeepText } from '../../hooks/lib/text'
import { COMPLEX_PROMPT, base, plan, step, submit } from '../support/engine'
import type { Json, Seen } from '../support/engine'
import { memoryStore, quotaMeter, session } from '../support/quota'

const PLAN = 'mcp__focus-conductor__plan'
const ID = 'claude-fable-5-2'
const COMPACT = '[focus-conductor] Hội thoại vừa được nén.'
const BRIEFING = '[focus-conductor] Điều phối'
const MESSAGES = [{ role: 'user' as const, text: 'tóm tắt', toolUses: [] }]
const BIG = (over: Json = {}) => plan({ goal: 'Sửa luồng thanh toán', depth: 'substantial', volume: 'medium', kind: 'edit', ...over })
const FOLLOW = plan({ relation: 'continue', goal: '', depth: 'substantial', volume: 'medium', kind: 'edit' })
const readFile = ($: Engine) => $.tool.call({ tool: 'Read', file_path: 'src/a.ts' } as never) as Promise<{ context?: string[] }>

async function compacted($: Engine, on: On, reply: Json) {
  const seen = base(on, { router: () => reply })
  on('session.compact', () => ({ messages: MESSAGES, tokensAfter: 40_000 }) as never)
  const box = { tokens: 150_000 }
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: box.tokens, window: 200_000 }, rateLimits: [] } }) as never)
  on('tool.call', { tool: 'Read' }, () => ({ result: 'nội dung', isReadOnly: true }))
  await submit($, 'Sửa luồng thanh toán')
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa hàm phí' }, { title: 'Thêm test' }] } as never)
  await step($, seen, { turnId: 't1' })
  await $.session.compact({ trigger: 'auto', messages: MESSAGES } as never)
  box.tokens = 38_000
  await step($, seen, { turnId: 't2' })
  return (await readFile($)).context?.find(c => c.startsWith(COMPACT)) ?? ''
}

describe('0.8.4 V1: câu vai điều phối sau nén ngữ cảnh', () => {
  test('luồng chính điều phối: lời nhắc sau nén có đúng một câu vai điều phối, không quá CONDUCTOR_KEEP_CHARS ký tự', { options: { planApproval: 'off', conductor: 'fable' } }, async ($, on) => {
    const note = await compacted($, on, BIG())
    expect(note.startsWith(COMPACT)).toBe(true)
    expect(note.split(conductorKeepText()).length - 1).toBe(1)
    expect(CONDUCTOR_KEEP_CHARS).toBe(200)
    expect(conductorKeepText().length).toBeLessThanOrEqual(CONDUCTOR_KEEP_CHARS)
  })
  test('mục tiêu không lớn: lời nhắc sau nén không có câu vai điều phối', { options: { planApproval: 'off', conductor: 'fable' } }, async ($, on) => {
    const note = await compacted($, on, BIG({ depth: 'light', volume: 'small' }))
    expect(note.startsWith(COMPACT)).toBe(true)
    expect(note).not.toContain(conductorKeepText())
  })
  test('conductor mặc định: lời nhắc sau nén không có câu vai điều phối', { options: { planApproval: 'off' } }, async ($, on) => {
    const note = await compacted($, on, BIG())
    expect(note.startsWith(COMPACT)).toBe(true)
    expect(note).not.toContain(conductorKeepText())
  })
})

describe('0.8.4 V1: câu vai điều phối khi chạy tiếp từ điểm dừng', () => {
  test('dừng vì hạn mức rồi chạy tiếp mục tiêu lớn: context của prompt chạy tiếp có câu vai điều phối', { options: { planApproval: 'off', conductor: 'fable' } }, async ($, on) => {
    const seen = base(on, { router: request => (request.startsWith('tiếp tục') ? FOLLOW : BIG()) })
    on('tool.register', () => ({ value: { tool: PLAN } }))
    on('command.register', () => ({ value: { command: 'conductor' } }))
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('turn.complete', () => ({ text: '' }))
    memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }))
    on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: 900, isLink: false } }) as never)
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }, { title: 'Kiểm' }] })
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'doing' })
    await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' } as never)
    meter.set([session(97)])
    await seen.clock.advance(10_000)
    await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
    await $.tool.call({ tool: PLAN, action: 'checkpoint', note: 'Tiếp: chạy npm test.' })
    meter.set([session(5)])
    await seen.clock.advance(10_000)
    await submit($, 'tiếp tục')
    const context = seen.contexts.at(-1) ?? []
    expect(context.some(c => c.includes('ĐIỂM DỪNG'))).toBe(true)
    expect(context.filter(c => c.includes(conductorKeepText())).length).toBe(1)
  })
})

describe('0.8.4 V1: đoạn dặn đầy đủ khi Fable sẵn sàng trở lại giữa mục tiêu', () => {
  test('mục tiêu lớn mở lúc router Fable tạm ngừng: prompt đầu tiên Fable sẵn sàng có đoạn dặn đúng một lần, prompt sau không có', { options: { planApproval: 'off', conductor: 'fable' } }, async ($, on) => {
    let fable = 0
    let other = 0
    const seen: Seen = base(on, { router: () => (seen.routerModels.at(-1) === ID ? (fable++ < 2 ? null : FOLLOW) : other++ === 0 ? BIG() : FOLLOW) })
    const briefings = () => (seen.contexts.at(-1) ?? []).filter(c => c.includes(BRIEFING)).length
    for (let i = 1; i <= 5; i++) {
      await submit($, i === 3 ? 'Sửa luồng thanh toán' : `làm tiếp bước ${i}`)
      expect(briefings(), `prompt ${i}`).toBe(0)
    }
    await submit($, 'làm tiếp bước 6')
    expect(seen.routerModels.at(-1)).toBe(ID)
    expect(briefings()).toBe(1)
    await submit($, 'làm tiếp bước 7')
    expect(briefings()).toBe(0)
  })

  test('Core từ bdfe0b0 không có trường briefedGoal: nạp được, mặc định chưa nhận đoạn dặn', () => {
    const old = { ...S.EMPTY_CORE, fable: { failures: 0, pauseLeft: 0, ready: true, reason: '', holdKey: '' } }
    expect(S.normalizeCore(JSON.parse(JSON.stringify(old)) as Partial<Core>).fable.briefedGoal).toBe(-1)
  })
})
