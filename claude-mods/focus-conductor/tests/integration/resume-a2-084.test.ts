// 0.8.4 A2 (vòng 4 PR 37): "tiếp tục" sau một việc chen vào quay lại luồng việc đã cất. Tin bảo chạy tiếp (intent resume sau bước kẹp),
// checklist của mục tiêu hiện tại không còn bước mở, mục tiêu đã cất gần nhất còn bước mở và chính là mục tiêu bị mục tiêu hiện tại thay
// (số mục tiêu liền trước): khôi phục bằng cùng đường với plan action restore, một dòng context báo đã quay lại, nhật ký restore. Áp cho mọi
// giá trị của conductor; mục tiêu khôi phục là mục tiêu lớn thì vai điều phối quay lại theo luật hiện có.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { PlanStep } from '../../types'
import { conductorContext, restoreResumeContext } from '../../hooks/lib/text'
import { base, conductor, plan, step, submit } from '../support/engine'
import type { Json, Seen } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const LOG = '/tmp/fc-resume-a2-084.jsonl'
const MAIN = { model: 'sonnet', effort: 'medium', why: '' }
const A = 'Sửa luồng thanh toán'
const BIG = (over: Json = {}) => plan({ goal: A, depth: 'substantial', volume: 'medium', kind: 'edit', main: MAIN, ...over })
const NEW = (goal: string) => plan({ relation: 'new', confidence: 0.97, goal, depth: 'light', volume: 'small', kind: 'edit', main: { model: 'sonnet', effort: 'low', why: '' } })
const RESUME = plan({ relation: 'continue', intent: 'resume', goal: '', depth: 'light', volume: 'small', kind: 'edit', main: MAIN })
const STATUS = plan({ relation: 'continue', intent: 'status', goal: '', depth: 'none', volume: 'small', kind: 'answer', main: MAIN })
const STEP2: PlanStep = { id: 2, title: 'Thêm test', status: 'doing' }
const OPTIONS = [
  ['conductor mặc định', { planApproval: 'off', decisionLog: LOG }],
  ['conductor fable', { planApproval: 'off', conductor: 'fable', decisionLog: LOG }],
] as const
const expectedMain = (opts: { readonly conductor?: string; readonly decisionLog: string }) => (opts.conductor === 'fable' ? 'claude-fable-5-2/medium' : 'claude-sonnet-5-5/medium')
const pick = (s: { model: string; effort?: unknown } | undefined) => `${s?.model ?? ''}/${String(s?.effort ?? '')}`
const show = async ($: Engine) => String((await $.tool.call({ tool: PLAN, action: 'show' } as never)).result)
const statusText = async ($: Engine) => String((await conductor($, 'status')).text ?? '')
const lastContext = (seen: Seen) => seen.contexts.at(-1) ?? []
const stop = async ($: Engine) => String(((await $.classic.Stop({ stop_hook_active: false } as never)) as { block?: string }).block ?? '')
const edit = ($: Engine) => $.tool.call({ tool: 'Edit', file_path: 'src/phi.ts', old_string: 'a', new_string: 'b' } as never) as Promise<{ deny?: string }>
const setPlan = ($: Engine, titles: string[]) => $.tool.call({ tool: PLAN, action: 'set', steps: titles.map(title => ({ title })) } as never)
const mark = ($: Engine, id: number, status: string) => $.tool.call({ tool: PLAN, action: 'update', step: id, status } as never)

/** Router giả trả lần lượt các câu trả lời (câu cuối lặp lại); lượt rà kế hoạch trả sạch. */
function setup(on: On, replies: Json[]) {
  let n = 0
  const seen: Seen = base(on, {
    router: request => (request.startsWith('Requirements:') ? { missing: [], extra: [], issues: [] } : (replies[Math.min(n++, replies.length - 1)] ?? null)),
  })
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  const writes: string[] = []
  on('fs.write', (_$, e) => {
    writes.push(e.text)
    return { value: undefined }
  })
  const lines = () => (writes[writes.length - 1] ?? '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
  return { seen, lines }
}

/** Mục tiêu A: checklist 3 bước, bước 1 xong, bước 2 đang làm, bước 3 chưa làm. */
async function goalA($: Engine, seen: Seen) {
  await submit($, A)
  await $.turn.start({ text: 'làm', turnId: 't1' })
  await step($, seen, { turnId: 't1' })
  await setPlan($, ['Sửa hàm phí', 'Thêm test', 'Cập nhật tài liệu'])
  await mark($, 1, 'done')
  await mark($, 2, 'doing')
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as never)
}

/** Mục tiêu B thay A (A được cất); checklist của B một bước, đóng khi `isClosed`. */
async function goalB($: Engine, isClosed: boolean) {
  await submit($, 'Sửa chú thích README')
  await setPlan($, ['Sửa chú thích'])
  if (isClosed) await mark($, 1, 'done')
}

const FABLE_ID = 'claude-fable-5-2'
const PAUSED = 'Fable tạm ngừng'
const FABLE_OPTS = { planApproval: 'off', conductor: 'fable', decisionLog: LOG } as const
const promptModels = (seen: Seen) => seen.routerCalls.filter(c => c.kind === 'prompt').map(c => c.model)

/** Router giả theo từng prompt (0.8.4 Z1): `now.reply` là câu trả lời của prompt sắp gửi (null là lỗi); `now.isFableDown` làm mọi lượt
 *  gửi Fable lỗi. Lượt rà kế hoạch trả sạch. */
function setupLive(on: On) {
  const now: { reply: Json | null; isFableDown: boolean } = { reply: null, isFableDown: false }
  const seen: Seen = base(on, {
    router: request => (request.startsWith('Requirements:') ? { missing: [], extra: [], issues: [] } : now.isFableDown && seen.routerModels.at(-1) === FABLE_ID ? null : now.reply),
  })
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  return { seen, now }
}

/** Gửi một prompt với câu trả lời router cho trước (null là router lỗi). */
async function say($: Engine, now: { reply: Json | null }, text: string, reply: Json | null) {
  now.reply = reply
  await submit($, text)
}

/** A lớn còn bước mở, B thay A rồi đóng hết checklist; router trả được ở cả hai prompt. */
async function aThenB($: Engine, seen: Seen, now: { reply: Json | null }) {
  now.reply = BIG()
  await goalA($, seen)
  now.reply = NEW('Sửa chú thích')
  await goalB($, true)
}

describe('0.8.4 A2: tiếp tục quay lại mục tiêu đã cất', () => {
  for (const [name, opts] of OPTIONS) {
    test(`${name}: B đã xong, tiếp tục: quay lại A còn đúng 2 bước mở, context báo quay lại và bước kế tiếp, nhật ký restore`, { options: opts }, async ($, on) => {
      const { seen, lines } = setup(on, [BIG(), NEW('Sửa chú thích'), RESUME])
      await goalA($, seen)
      await goalB($, true)
      await submit($, 'tiếp tục')
      const shown = await show($)
      expect(shown).toContain(`Mục tiêu: ${A}`)
      expect(shown).toContain('[~] 2. Thêm test')
      expect(shown).toContain('[ ] 3. Cập nhật tài liệu')
      expect(lastContext(seen).filter(c => c === restoreResumeContext(A, STEP2)).length).toBe(1)
      expect(lastContext(seen).some(c => c.includes('chạy tiếp từ bước đang mở'))).toBe(false)
      const restore = lines().filter(l => l['kind'] === 'restore').at(-1)
      expect(restore?.['from']).toBe(1)
      expect(typeof restore?.['goalId']).toBe('number')
      await $.turn.start({ text: 'làm', turnId: 't3' })
      expect(pick(await step($, seen, { turnId: 't3' }))).toBe(expectedMain(opts))
      if (expectedMain(opts).includes('fable')) expect(await statusText($)).toContain('Điều phối: fable/medium, đang điều phối')
    })

    test(`${name}: B còn bước mở: không khôi phục, chạy tiếp B`, { options: opts }, async ($, on) => {
      const { seen } = setup(on, [BIG(), NEW('Sửa chú thích'), RESUME])
      await goalA($, seen)
      await goalB($, false)
      await submit($, 'tiếp tục')
      expect(await show($)).toContain('Mục tiêu: Sửa chú thích')
      expect(lastContext(seen).some(c => c.includes('chạy tiếp từ bước 1. Sửa chú thích'))).toBe(true)
    })
  }

  test('không có mục tiêu đã cất, checklist trống: như trước, chạy tiếp từ bước đang mở', { options: OPTIONS[0][1] }, async ($, on) => {
    const { seen } = setup(on, [plan({ goal: 'Sửa phí', depth: 'light', volume: 'small', kind: 'edit' }), RESUME])
    await submit($, 'Sửa phí')
    await submit($, 'tiếp tục')
    expect(await show($)).toContain('Mục tiêu: Sửa phí')
    expect(lastContext(seen).some(c => c.includes('chạy tiếp từ bước đang mở'))).toBe(true)
  })

  test('mục tiêu đã cất không còn bước mở (chỉ còn bước waiting): không khôi phục', { options: OPTIONS[0][1] }, async ($, on) => {
    const { seen } = setup(on, [BIG(), NEW('Sửa chú thích'), RESUME])
    await submit($, A)
    await step($, seen, { turnId: 't1' })
    await setPlan($, ['Sửa hàm phí', 'Chờ CI'])
    await mark($, 1, 'done')
    await $.tool.call({ tool: PLAN, action: 'update', step: 2, status: 'waiting', note: 'chờ CI chạy xong' } as never)
    await goalB($, true)
    await submit($, 'tiếp tục')
    expect(await show($)).toContain('Mục tiêu: Sửa chú thích')
  })

  // 0.8.5 K5: tên giữ như 0.8.4; kỳ vọng đổi thành khôi phục mục tiêu đã cất gần nhất còn dở (mục tiêu ở giữa không dở nên không được cất).
  test('mục tiêu đã cất gần nhất không phải mục tiêu bị mục tiêu hiện tại thay: không khôi phục', { options: OPTIONS[0][1] }, async ($, on) => {
    const { seen } = setup(on, [BIG(), NEW('Viết hàm slugify'), NEW('Sửa chú thích'), RESUME])
    await goalA($, seen)
    await submit($, 'Viết hàm slugify(text)')
    await goalB($, true)
    await submit($, 'tiếp tục')
    expect(await show($)).toContain(`Mục tiêu: ${A}`)
  })

  test('tin hỏi tiến độ trong cùng tình huống: không khôi phục', { options: OPTIONS[0][1] }, async ($, on) => {
    const { seen } = setup(on, [BIG(), NEW('Sửa chú thích'), STATUS])
    await goalA($, seen)
    await goalB($, true)
    await submit($, 'tới đâu rồi')
    expect(await show($)).toContain('Mục tiêu: Sửa chú thích')
  })

  test('sau khi khôi phục bằng tiếp tục, plan restore lần nữa: như khi không còn mục tiêu để khôi phục', { options: OPTIONS[0][1] }, async ($, on) => {
    const { seen } = setup(on, [BIG(), NEW('Sửa chú thích'), RESUME])
    await goalA($, seen)
    await goalB($, true)
    await submit($, 'tiếp tục')
    const again = await $.tool.call({ tool: PLAN, action: 'restore' } as never)
    expect(String(again.deny)).toBe('Không có mục tiêu cũ nào đang được lưu để khôi phục.')
  })

  test('mục tiêu lớn A đã duyệt, bị B thay, tiếp tục khôi phục A: Edit ở luồng chính không bị từ chối vì chưa duyệt', { options: { enforceChecklist: true, decisionLog: LOG } }, async ($, on) => {
    const approve = plan({ relation: 'continue', intent: 'approve', goal: '', depth: 'light', volume: 'small', kind: 'edit' })
    const { seen } = setup(on, [BIG({ requirements: ['Sửa hàm phí', 'Thêm test'] }), approve, NEW('Sửa chú thích'), RESUME])
    await submit($, A)
    await $.turn.start({ text: 'việc', turnId: 't1' })
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa hàm phí', check: 'bun test' }, { title: 'Thêm test', check: 'bun test' }] } as never)
    expect(await stop($)).toBe('')
    await submit($, 'ok duyệt')
    expect((await edit($)).deny).toBeUndefined()
    await goalB($, true)
    await submit($, 'tiếp tục')
    expect(await show($)).toContain(`Mục tiêu: ${A}`)
    expect(String((await edit($)).deny ?? '')).not.toContain('chưa được duyệt')
    expect(lastContext(seen).some(c => c.startsWith('[focus-conductor] Tin bảo chạy tiếp: đã quay lại'))).toBe(true)
  })
})

// 0.8.4 Z1 (vòng 5 PR 37): nhánh A2 khôi phục trên Core đọc ngay trước khi khôi phục, nên các lần ghi Core trước đó trong cùng prompt
// (lượt Fable đạt đưa bộ đếm lỗi về 0, giảm số prompt còn tạm ngừng) không bị mất.
describe('0.8.4 Z1: khôi phục bằng tiếp tục giữ các lần ghi Core trước đó của cùng prompt', () => {
  test('một lỗi router, tiếp tục khôi phục A, một lỗi nữa: Fable không tạm ngừng, vẫn điều phối mục tiêu A', { options: FABLE_OPTS }, async ($, on) => {
    const { seen, now } = setupLive(on)
    await aThenB($, seen, now)
    await say($, now, 'xem log build', null)
    await say($, now, 'tiếp tục', RESUME)
    expect(await show($)).toContain(`Mục tiêu: ${A}`)
    await say($, now, 'xem log build lần nữa', null)
    const status = await statusText($)
    expect(status).not.toContain(PAUSED)
    expect(status).toContain('Điều phối: fable/medium, đang điều phối')
    expect(await show($)).toContain(`Mục tiêu: ${A}`)
  })

  test('đối chứng: sau khi khôi phục, hai lỗi router liên tiếp thì Fable tạm ngừng như luật cũ', { options: FABLE_OPTS }, async ($, on) => {
    const { seen, now } = setupLive(on)
    await aThenB($, seen, now)
    await say($, now, 'tiếp tục', RESUME)
    expect(await show($)).toContain(`Mục tiêu: ${A}`)
    await say($, now, 'xem log build', null)
    await say($, now, 'xem log build lần nữa', null)
    expect(await statusText($)).toContain(PAUSED)
  })

  test('Fable đang tạm ngừng còn 2 prompt, tiếp tục có khôi phục: số prompt còn tạm ngừng giảm đúng 1', { options: FABLE_OPTS }, async ($, on) => {
    const { seen, now } = setupLive(on)
    await aThenB($, seen, now)
    now.isFableDown = true
    await say($, now, 'xem log build', STATUS)
    await say($, now, 'xem log build lần nữa', STATUS)
    now.isFableDown = false
    await say($, now, 'tới đâu rồi', STATUS)
    await say($, now, 'tiếp tục', RESUME)
    expect(await show($)).toContain(`Mục tiêu: ${A}`)
    const before = promptModels(seen).length
    await say($, now, 'tới đâu rồi', STATUS)
    await say($, now, 'tới đâu rồi', STATUS)
    expect(promptModels(seen).slice(before)).toEqual(['sonnet', FABLE_ID])
  })
})

// 0.8.4 Z2 (vòng 5 PR 37): ghim bốn hành vi của nhánh A2 chưa có test: chi phí router, turn sau khi khôi phục là turn thực thi, đoạn dặn
// điều phối của mục tiêu lớn được khôi phục, tin chạy tiếp điểm dừng giữ ưu tiên.
/** Dòng sổ của /conductor status: tiền và số lượt router của phiên. */
function routerLedger(status: string) {
  const match = /router <?\$([0-9,]+) trong ([0-9]+) lượt/.exec(status)
  return { usd: Number((match?.[1] ?? '').replace(',', '.')), calls: Number(match?.[2] ?? Number.NaN) }
}

describe('0.8.4 Z2: các hành vi của nhánh A2', () => {
  for (const [name, opts] of OPTIONS) {
    test(`${name}: tiếp tục có khôi phục: số lượt router tăng đúng 1 và tiền router tăng`, { options: opts }, async ($, on) => {
      const { seen } = setup(on, [BIG(), NEW('Sửa chú thích'), RESUME])
      await goalA($, seen)
      await goalB($, true)
      const before = routerLedger(await statusText($))
      await submit($, 'tiếp tục')
      expect(await show($)).toContain(`Mục tiêu: ${A}`)
      const after = routerLedger(await statusText($))
      expect(after.calls).toBe(before.calls + 1)
      // Status làm tròn tới cent: một lượt router sonnet giả không đổi số hiện, một lượt Fable thì có.
      if (expectedMain(opts).includes('fable')) expect(after.usd).toBeGreaterThan(before.usd)
      else expect(after.usd).toBeGreaterThanOrEqual(before.usd)
    })

    test(`${name}: turn sau khi khôi phục là turn thực thi: Stop chặn vì checklist của A còn bước mở`, { options: { ...opts, enforceChecklist: true } }, async ($, on) => {
      const { seen } = setup(on, [BIG(), NEW('Sửa chú thích'), RESUME])
      // Một tool call chỉ đọc: turn thực thi theo ý của prompt (turn hỏi đáp thì không bị checklist chặn).
      on('tool.call', { tool: 'Read' }, () => ({ result: 'nội dung' }))
      await goalA($, seen)
      await goalB($, true)
      await submit($, 'tiếp tục')
      expect(await show($)).toContain(`Mục tiêu: ${A}`)
      await $.turn.start({ text: 'tiếp tục', turnId: 't4' })
      await $.tool.call({ tool: 'Read', file_path: 'src/phi.ts' } as never)
      expect(await stop($)).toContain('Thêm test')
    })

    test(`${name}: đoạn dặn điều phối khi khôi phục mục tiêu lớn: fable có đúng một lần, tin tiếp tục kế tiếp không lặp; mặc định không có`, { options: opts }, async ($, on) => {
      const { seen } = setup(on, [BIG(), NEW('Sửa chú thích'), RESUME])
      await goalA($, seen)
      await goalB($, true)
      await submit($, 'tiếp tục')
      expect(await show($)).toContain(`Mục tiêu: ${A}`)
      expect(lastContext(seen).filter(c => c === conductorContext()).length).toBe(expectedMain(opts).includes('fable') ? 1 : 0)
      await submit($, 'tiếp tục')
      expect(await show($)).toContain(`Mục tiêu: ${A}`)
      expect(lastContext(seen).filter(c => c === conductorContext()).length).toBe(0)
    })
  }

  test('điểm dừng đang mở và vừa gõ /conductor resume: tin kế tiếp chạy tiếp điểm dừng, không khôi phục mục tiêu đã cất', { options: OPTIONS[0][1] }, async ($, on) => {
    const { seen, lines } = setup(on, [BIG(), NEW('Sửa chú thích'), RESUME])
    await goalA($, seen)
    await goalB($, true)
    await conductor($, 'pause')
    expect(String((await $.tool.call({ tool: PLAN, action: 'checkpoint', note: 'Tiếp: rà lại chú thích.' } as never)).result ?? '')).toContain('Đã ghi điểm dừng')
    await conductor($, 'resume')
    await submit($, 'tiếp tục')
    expect((lastContext(seen)[0] ?? '')).toContain('ĐIỂM DỪNG')
    expect(await show($)).toContain('Mục tiêu: Sửa chú thích')
    expect(lines().some(l => l['kind'] === 'restore' && l['cause'] === 'resume')).toBe(false)
  })
})

// 0.8.5 K5: tin bảo chạy tiếp lùi được nhiều tầng (mục tiêu đã cất gần nhất còn dở, duyệt từ mới tới cũ), và báo không còn việc khi checklist
// hiện tại đã đóng hết mà không còn mục tiêu đã cất nào đang dở.
const NOTHING_LEFT = 'không còn việc nào đã cất'
describe('0.8.5 K5: tiếp tục lùi nhiều tầng và báo khi không còn gì', () => {
  /** A còn bước mở bị B thay; B còn bước mở bị C thay; C đóng hết. */
  async function threeLevels($: Engine, seen: Seen) {
    await goalA($, seen)
    await submit($, 'Sửa chú thích README')
    await setPlan($, ['Sửa chú thích', 'Thêm ví dụ'])
    await mark($, 1, 'doing')
    await submit($, 'Đổi tên biến cấu hình')
    await setPlan($, ['Đổi tên biến'])
    await mark($, 1, 'done')
  }

  test('C xong, tiếp tục quay lại B; B xong, tiếp tục lần hai quay lại A với đúng 2 bước mở', { options: OPTIONS[0][1] }, async ($, on) => {
    const { seen } = setup(on, [BIG(), NEW('Sửa chú thích'), NEW('Đổi tên biến'), RESUME])
    await threeLevels($, seen)
    await submit($, 'tiếp tục')
    expect(await show($)).toContain('Mục tiêu: Sửa chú thích')
    await mark($, 1, 'done')
    await mark($, 2, 'done')
    await submit($, 'tiếp tục')
    const shown = await show($)
    expect(shown).toContain(`Mục tiêu: ${A}`)
    expect(shown).toContain('[~] 2. Thêm test')
    expect(shown).toContain('[ ] 3. Cập nhật tài liệu')
  })

  test('A cũng xong, tiếp tục lần ba: dòng báo không còn việc, không có chạy tiếp từ bước đang mở, không có dòng restore mới', { options: OPTIONS[0][1] }, async ($, on) => {
    const { seen, lines } = setup(on, [BIG(), NEW('Sửa chú thích'), NEW('Đổi tên biến'), RESUME])
    await threeLevels($, seen)
    await submit($, 'tiếp tục')
    await mark($, 1, 'done')
    await mark($, 2, 'done')
    await submit($, 'tiếp tục')
    expect(await show($)).toContain(`Mục tiêu: ${A}`)
    await mark($, 2, 'done')
    await mark($, 3, 'done')
    const restores = lines().filter(l => l['kind'] === 'restore').length
    await submit($, 'tiếp tục')
    expect(lastContext(seen).filter(c => c.includes(NOTHING_LEFT)).length).toBe(1)
    expect(lastContext(seen).some(c => c.includes('chạy tiếp từ bước đang mở'))).toBe(false)
    expect(lines().filter(l => l['kind'] === 'restore').length).toBe(restores)
  })

  test('mục tiêu đã cất gần nhất chỉ còn bước waiting: bỏ qua, quay lại mục đã cất cũ hơn còn bước mở', { options: OPTIONS[0][1] }, async ($, on) => {
    const { seen } = setup(on, [BIG(), NEW('Chờ CI'), NEW('Đổi tên biến'), RESUME])
    await goalA($, seen)
    await submit($, 'Chờ CI chạy xong')
    await setPlan($, ['Chờ CI'])
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'waiting', note: 'chờ CI chạy xong' } as never)
    await submit($, 'Đổi tên biến cấu hình')
    await setPlan($, ['Đổi tên biến'])
    await mark($, 1, 'done')
    await submit($, 'tiếp tục')
    expect(await show($)).toContain(`Mục tiêu: ${A}`)
  })

  test('checklist trống (việc nhỏ không lập checklist), không có mục tiêu đã cất: giữ dòng chạy tiếp, không có dòng báo không còn việc', { options: OPTIONS[0][1] }, async ($, on) => {
    const { seen } = setup(on, [plan({ goal: 'Sửa phí', depth: 'light', volume: 'small', kind: 'edit' }), RESUME])
    await submit($, 'Sửa phí')
    await submit($, 'tiếp tục')
    expect(lastContext(seen).some(c => c.includes('chạy tiếp từ bước đang mở'))).toBe(true)
    expect(lastContext(seen).some(c => c.includes(NOTHING_LEFT))).toBe(false)
  })
})

// 0.8.5 D3: việc chen vào không có checklist chưa chắc đã xong: tin bảo chạy tiếp chỉ quay lại mục tiêu đã cất khi mục tiêu hiện tại đã có
// ít nhất một turn thực thi kết thúc và turn luồng chính gần nhất không bị ngắt.
describe('0.8.5 D3: việc chen vào không có checklist', () => {
  /** B (light, edit) thay A; B không lập checklist; một turn sửa file của B, kết thúc bình thường hay bị ngắt. */
  async function bTurn($: Engine, seen: Seen, ending: 'answer' | 'aborted') {
    await $.turn.start({ text: 'sửa', turnId: 't2' })
    await step($, seen, { turnId: 't2' })
    await edit($)
    await $.turn.complete({ turnId: 't2', answer: ending === 'answer' ? 'ok' : '', durationMs: 5, isAborted: ending === 'aborted', reason: ending } as never)
  }

  test('B chưa có turn nào kết thúc, tiếp tục: không khôi phục, chạy tiếp B', { options: OPTIONS[0][1] }, async ($, on) => {
    const { seen } = setup(on, [BIG(), NEW('Sửa chú thích'), RESUME])
    await goalA($, seen)
    await submit($, 'Sửa chú thích README')
    await submit($, 'tiếp tục')
    expect(await show($)).toContain('Mục tiêu: Sửa chú thích')
    expect(lastContext(seen).some(c => c.includes('chạy tiếp từ bước đang mở'))).toBe(true)
  })

  test('B có một turn thực thi kết thúc bình thường, tiếp tục: khôi phục A', { options: OPTIONS[0][1] }, async ($, on) => {
    const { seen } = setup(on, [BIG(), NEW('Sửa chú thích'), RESUME])
    await goalA($, seen)
    await submit($, 'Sửa chú thích README')
    await bTurn($, seen, 'answer')
    await submit($, 'tiếp tục')
    expect(await show($)).toContain(`Mục tiêu: ${A}`)
  })

  test('B có turn gần nhất bị ngắt, tiếp tục: không khôi phục', { options: OPTIONS[0][1] }, async ($, on) => {
    const { seen } = setup(on, [BIG(), NEW('Sửa chú thích'), RESUME])
    await goalA($, seen)
    await submit($, 'Sửa chú thích README')
    await bTurn($, seen, 'answer')
    await bTurn($, seen, 'aborted')
    await submit($, 'tiếp tục')
    expect(await show($)).toContain('Mục tiêu: Sửa chú thích')
  })
})

// 0.8.5 K4: tin bảo chạy tiếp chen ngang giữa turn khôi phục mục tiêu lớn: turn đang chạy giữ model của nó, nên không chèn đoạn dặn điều
// phối và không ghi briefedGoal; prompt kế tiếp ngoài turn chèn đoạn dặn theo cơ chế hiện có.
describe('0.8.5 K4: khôi phục giữa turn không chèn đoạn dặn điều phối', () => {
  test('tin tiếp tục chen ngang khôi phục A: không có đoạn dặn; prompt tiếp tục kế tiếp ngoài turn có đúng một đoạn dặn; turn mới chạy fable/medium', { options: FABLE_OPTS }, async ($, on) => {
    const { seen } = setup(on, [BIG(), NEW('Sửa chú thích'), RESUME])
    await goalA($, seen)
    await goalB($, true)
    await $.turn.start({ text: 'sửa', turnId: 't2' })
    expect(pick(await step($, seen, { turnId: 't2' }))).toBe('claude-sonnet-5-5/low')
    await $.prompt.submit({ text: 'tiếp tục', wait: false, turnId: 't2', origin: { kind: 'composer' } } as never)
    expect(await show($)).toContain(`Mục tiêu: ${A}`)
    expect(lastContext(seen).filter(c => c === conductorContext()).length).toBe(0)
    await $.turn.complete({ turnId: 't2', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as never)
    await submit($, 'tiếp tục')
    expect(lastContext(seen).filter(c => c === conductorContext()).length).toBe(1)
    await $.turn.start({ text: 'làm', turnId: 't3' })
    expect(pick(await step($, seen, { turnId: 't3' }))).toBe('claude-fable-5-2/medium')
  })
})

// 0.8.5 K6: sau khi tin bảo chạy tiếp khôi phục A, /conductor reroute đọc lại prompt đó trên brief vừa khôi phục, nên mục tiêu vẫn là A và
// checklist của A giữ nguyên.
describe('0.8.5 K6: reroute sau khi khôi phục', () => {
  test('tiếp tục khôi phục A rồi /conductor reroute (router continue, resume): mục tiêu vẫn là A, checklist của A giữ đủ 3 bước', { options: OPTIONS[0][1] }, async ($, on) => {
    const { seen } = setup(on, [BIG(), NEW('Sửa chú thích'), RESUME])
    await goalA($, seen)
    await goalB($, true)
    await submit($, 'tiếp tục')
    expect(await show($)).toContain(`Mục tiêu: ${A}`)
    await conductor($, 'reroute')
    const shown = await show($)
    expect(shown).toContain(`Mục tiêu: ${A}`)
    expect(shown).toContain('[x] 1. Sửa hàm phí')
    expect(shown).toContain('[~] 2. Thêm test')
    expect(shown).toContain('[ ] 3. Cập nhật tài liệu')
  })
})

// 0.8.5 K7: "tiếp tục" trong routerSkip quay lại mục tiêu đã cất theo cùng luật với nhánh có router (K5, D3), không gọi router. Tin chạy
// tiếp một điểm dừng đang mở giữ ưu tiên.
describe('0.8.5 K7: tiếp tục trong routerSkip quay lại mục tiêu đã cất', () => {
  const SKIP = { planApproval: 'off', decisionLog: LOG, routerSkip: 'tiếp tục' } as const
  test('A còn bước mở bị B thay, B đóng hết, tiếp tục đi nhánh skip: mục tiêu là A, có dòng restore, router không được gọi thêm', { options: SKIP }, async ($, on) => {
    const { seen, lines } = setup(on, [BIG(), NEW('Sửa chú thích')])
    await goalA($, seen)
    await goalB($, true)
    const calls = seen.routerCalls.filter(c => c.kind === 'prompt').length
    const before = routerLedger(await statusText($))
    await submit($, 'tiếp tục')
    expect(await show($)).toContain(`Mục tiêu: ${A}`)
    expect(lines().some(l => l['kind'] === 'restore' && l['cause'] === 'resume')).toBe(true)
    expect(lastContext(seen).filter(c => c === restoreResumeContext(A, STEP2)).length).toBe(1)
    expect(seen.routerCalls.filter(c => c.kind === 'prompt').length).toBe(calls)
    expect(routerLedger(await statusText($)).calls).toBe(before.calls)
  })

  test('B còn bước mở: nhánh skip như cũ, chạy tiếp B', { options: SKIP }, async ($, on) => {
    const { seen, lines } = setup(on, [BIG(), NEW('Sửa chú thích')])
    await goalA($, seen)
    await goalB($, false)
    await submit($, 'tiếp tục')
    expect(await show($)).toContain('Mục tiêu: Sửa chú thích')
    expect(lines().some(l => l['kind'] === 'restore')).toBe(false)
  })

  test('điểm dừng đang mở và vừa gõ /conductor resume: tiếp tục đi nhánh skip chạy tiếp điểm dừng, không khôi phục mục tiêu đã cất', { options: SKIP }, async ($, on) => {
    const { seen, lines } = setup(on, [BIG(), NEW('Sửa chú thích')])
    await goalA($, seen)
    await goalB($, true)
    await conductor($, 'pause')
    expect(String((await $.tool.call({ tool: PLAN, action: 'checkpoint', note: 'Tiếp: rà lại chú thích.' } as never)).result ?? '')).toContain('Đã ghi điểm dừng')
    await conductor($, 'resume')
    await submit($, 'tiếp tục')
    expect(lastContext(seen)[0] ?? '').toContain('ĐIỂM DỪNG')
    expect(await show($)).toContain('Mục tiêu: Sửa chú thích')
    expect(lines().some(l => l['kind'] === 'restore')).toBe(false)
  })
})

// 0.8.5 W1 (vòng 2 PR 38): việc chen vào đã xong, một câu hỏi kiến thức thành mục tiêu hỏi đáp C (không có mục tiêu đang dở nên không phải
// tin ngoài lề); turn trả lời của C không phải turn thực thi. Mục tiêu hỏi đáp không đòi turn thực thi trước khi quay lại; turn gần nhất
// bị ngắt thì vẫn không quay lại.
describe('0.8.5 W1: tiếp tục sau một câu hỏi kiến thức', () => {
  /** Dạng bản ghi explain của tests/golden/replies.ts: new, task, answer, none, không việc. */
  const EXPLAIN = plan({ why: 'Câu hỏi giải thích khái niệm, không cần sửa file.', confidence: 0.97, relation: 'new', intent: 'task', goal: 'Giải thích git rebase', requirements: ['Giải thích git rebase'], depth: 'none', volume: 'small', kind: 'answer', main: { model: 'haiku', effort: 'low', why: '' }, tasks: [] })
  /** A còn 2 bước mở bị B thay, B đóng hết; câu hỏi thành C; một turn trả lời của C kết thúc bình thường hay bị ngắt. */
  async function aBThenQuestion($: Engine, seen: Seen, isAborted: boolean) {
    await goalA($, seen)
    await goalB($, true)
    await submit($, 'git rebase là gì?')
    expect(await show($)).toContain('Mục tiêu: Giải thích git rebase')
    await $.turn.start({ text: 'trả lời', turnId: 't3' })
    await step($, seen, { turnId: 't3' })
    await $.turn.complete({ turnId: 't3', answer: isAborted ? '' : 'rebase là...', durationMs: 5, isAborted, reason: isAborted ? 'aborted' : 'answer' } as never)
  }

  test('turn trả lời của C kết thúc bình thường, tiếp tục: quay lại A còn đúng 2 bước mở, nhật ký restore, context báo quay lại', { options: OPTIONS[0][1] }, async ($, on) => {
    const { seen, lines } = setup(on, [BIG(), NEW('Sửa chú thích'), EXPLAIN, RESUME])
    await aBThenQuestion($, seen, false)
    await submit($, 'tiếp tục')
    const shown = await show($)
    expect(shown).toContain(`Mục tiêu: ${A}`)
    expect(shown).toContain('[~] 2. Thêm test')
    expect(shown).toContain('[ ] 3. Cập nhật tài liệu')
    expect(lines().some(l => l['kind'] === 'restore' && l['cause'] === 'resume')).toBe(true)
    expect(lastContext(seen).filter(c => c === restoreResumeContext(A, STEP2)).length).toBe(1)
  })

  test('turn trả lời của C bị ngắt, tiếp tục: không khôi phục, mục tiêu vẫn là C', { options: OPTIONS[0][1] }, async ($, on) => {
    const { seen, lines } = setup(on, [BIG(), NEW('Sửa chú thích'), EXPLAIN, RESUME])
    await aBThenQuestion($, seen, true)
    await submit($, 'tiếp tục')
    expect(await show($)).toContain('Mục tiêu: Giải thích git rebase')
    expect(lines().some(l => l['kind'] === 'restore')).toBe(false)
  })
})
