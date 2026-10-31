// 0.6.1 mục 3: status line giữ nhãn hạn mức, mục Hạn mức trong pane, band hẹp khi dừng, và band, pane trên vscode và mobile.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { COMPLEX_PROMPT, PANE, base, conductor, step, submit } from '../support/engine'
import { RESUME, memoryStore, quotaMeter, session, week } from '../support/quota'

const PLAN = 'mcp__focus-conductor__plan'
const DONE = (turnId: string) => ({ turnId, answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' }) as never
const BASH = { tool: 'Bash', command: 'npm test' } as never
const LABEL = { vi: 'tạm dừng: hạn mức', en: 'paused: quota' } as const

function startHooks(on: On) {
  on('tool.register', () => ({ value: { tool: PLAN } }))
  on('command.register', () => ({ value: { command: 'conductor' } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
}

async function measure($: Engine, used: number) {
  await $.session.measure({ context: { tokens: 1, window: 200_000 }, rateLimits: [session(used)], changed: ['rateLimits'] } as never)
}

async function goalWithSteps($: Engine) {
  await submit($, COMPLEX_PROMPT)
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }, { title: 'Kiểm' }] })
  await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'doing' })
}

/** Dừng vì hạn mức qua một tool call, rồi Claude ghi note của điểm dừng. */
async function pauseByQuota($: Engine, meter: ReturnType<typeof quotaMeter>, clock: { advance: (ms: number) => Promise<void> }) {
  meter.set([session(97)])
  await clock.advance(10_000)
  await $.tool.call(BASH)
  await $.tool.call({ tool: PLAN, action: 'checkpoint', note: 'Tiếp: chạy npm test rồi sửa lỗi còn lại ở module thanh toán.' })
}

type El = { type: string; props?: Record<string, unknown>; children?: Array<El | string> }
const cells = (s: string) => [...s.normalize('NFC')].length
const textOf = (el: El | string): string => (typeof el === 'string' ? el : (el.children ?? []).map(textOf).join(''))
/** Nút engine [Giả định: khoảng 10 ô cho nhãn ngắn, như spec 0.6.1 mục 3.3]. */
const buttonCells = (el: El) => Math.max(10, cells(String(el.props?.['label'] ?? '')) + 2)

/** Số ô một phần tử chiếm khi không co: Text theo chữ, Box hàng cộng con và gap, Box cột lấy con rộng nhất. */
function widthOf(el: El | string): number {
  if (typeof el === 'string') return cells(el)
  if (el.type === 'Button') return buttonCells(el)
  if (el.type === 'Text') return cells(textOf(el))
  const kids = (el.children ?? []).filter(k => k !== null && k !== '')
  const margin = Number(el.props?.['marginLeft'] ?? 0) + Number(el.props?.['marginRight'] ?? 0)
  if (el.props?.['flexDirection'] === 'column') return margin + Math.max(0, ...kids.map(widthOf))
  return margin + kids.reduce((sum, k) => sum + widthOf(k), 0) + Number(el.props?.['gap'] ?? 0) * Math.max(0, kids.length - 1)
}

/** Phần cố định của từng dòng band: gờ trái, mọi con không co (flexShrink 0, nút) và gap; con co được chỉ tính lề. */
function fixedRows(tree: El): number[] {
  const [spine, body] = (tree.children ?? []) as El[]
  const spineCells = widthOf(spine as El)
  return ((body?.children ?? []) as El[]).map(row => {
    const kids = (row.children ?? []).filter(k => typeof k !== 'string') as El[]
    const own = kids.reduce((sum, k) => sum + (k.type === 'Box' && k.props?.['flexShrink'] === 1 ? Number(k.props?.['marginLeft'] ?? 0) : widthOf(k)), 0)
    return spineCells + own + Number(row.props?.['gap'] ?? 0) * Math.max(0, kids.length - 1)
  })
}

const bandProps = (columns: number, maxRows: number) => ({ hasSurvey: false, isWorking: false, maxRows, bodyColumns: columns, scroll: { offset: 0, bodyRows: 6 }, view: {} })

describe('0.6.1 3.1: status line giữ nhãn hạn mức', () => {
  for (const lang of ['vi', 'en'] as const) {
    test(`dừng, plan checkpoint, turn.complete, một prompt: status luôn có nhãn dừng; hạn mức làm mới thì nhãn mất (${lang})`, { options: { uiLanguage: lang } }, async ($, on) => {
      const seen = base(on, RESUME)
      startHooks(on)
      memoryStore(on)
      const meter = quotaMeter(on, [session(10)])
      await goalWithSteps($)
      meter.set([session(97)])
      await seen.clock.advance(10_000)
      await $.tool.call(BASH)
      expect(seen.statuses.at(-1)).toContain(LABEL[lang])
      await $.tool.call({ tool: PLAN, action: 'checkpoint', note: 'Tiếp: chạy npm test.' })
      expect(seen.statuses.at(-1)).toContain(LABEL[lang])
      await $.turn.complete(DONE('t1'))
      expect(seen.statuses.at(-1)).toContain(LABEL[lang])
      await submit($, 'giải thích ngắn trạng thái hiện tại')
      expect(seen.statuses.at(-1)).toContain(LABEL[lang])
      meter.set([session(1)])
      await seen.clock.advance(10_000)
      await measure($, 1)
      expect(seen.statuses.at(-1) ?? '').not.toContain(LABEL[lang])
    })
  }

  test('chưa có mục tiêu mà đang dừng: status là tên chế độ kèm nhãn dừng; prompt sau đó vẫn giữ nhãn', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    memoryStore(on)
    quotaMeter(on, [session(97)])
    await measure($, 97)
    expect(seen.statuses.at(-1)).toBe(`auto · ${LABEL.vi}`)
    await conductor($, 'status')
    await submit($, 'giải thích ngắn kiến trúc hiện tại')
    expect(seen.statuses.at(-1)).toContain(LABEL.vi)
  })

  test('gần ngưỡng: prompt qua router và step đầu của turn vẫn giữ nhãn phần còn lại (061-U3, 061-U4)', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    await goalWithSteps($)
    meter.set([session(92)])
    await seen.clock.advance(10_000)
    await measure($, 92)
    expect(seen.statuses.at(-1)).toContain('hạn mức còn 8%')
    await submit($, 'tiếp tục bước sửa')
    expect(seen.statuses.at(-1)).toContain('hạn mức còn 8%')
    await step($, seen)
    expect(seen.statuses.at(-1)).toContain('hạn mức còn 8%')
  })

  test('lệnh /conductor mode và nút Đặt lại khi đang dừng: status vẫn có nhãn dừng (061-U5, 061-U6)', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    await goalWithSteps($)
    await pauseByQuota($, meter, seen.clock)
    await conductor($, 'mode suggest')
    expect(seen.statuses.at(-1)).toContain(LABEL.vi)
    await conductor($, 'mode auto')
    const pane = await $.ui.mount(PANE)
    await pane.press({ key: 'reset' })
    await pane.press({ key: 'reset' })
    await pane.unmount()
    expect(seen.statuses.at(-1)).toBe(`auto · ${LABEL.vi}`)
  })

  test('prompt đến khi vừa vào vùng dừng (không có số đo, không tool call nào): status có nhãn dừng ngay (061-U9)', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    await goalWithSteps($)
    meter.set([session(97)])
    await seen.clock.advance(10_000)
    await submit($, 'tiếp')
    expect(seen.statuses.at(-1)).toContain(LABEL.vi)
  })

  test('quotaGuard false: status như 0.6.0, không nhãn hạn mức', { options: { quotaGuard: false } }, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    memoryStore(on)
    quotaMeter(on, [session(99)])
    await goalWithSteps($)
    await measure($, 99)
    await $.turn.complete(DONE('t1'))
    expect(seen.statuses.every(s => !String(s ?? '').includes('hạn mức'))).toBe(true)
  })
})

describe('0.6.1 3.2: mục Hạn mức trong pane', () => {
  for (const width of [36, 48, 80]) {
    test(`bình thường (${width} cột): từng cửa sổ và trạng thái bình thường, trước mục Cảnh báo`, {}, async ($, on) => {
      const seen = base(on, RESUME)
      startHooks(on)
      memoryStore(on)
      quotaMeter(on, [session(40), week(20)])
      await goalWithSteps($)
      await seen.clock.advance(10_000)
      await $.session.measure({ context: { tokens: 1, window: 200_000 }, rateLimits: [session(40), week(20)], changed: ['rateLimits'] } as never)
      const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: width } })
      expect(await pane.drawn()).toMatchObject({ type: 'Box' })
      expect(await pane.find({ type: 'Text', text: /^Hạn mức ─+/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /phiên \(5 giờ\): đã dùng 40%, còn 60%.*ngưỡng còn 5%/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /tuần: đã dùng 20%, còn 80%/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /Trạng thái: bình thường/ })).toBeDefined()
      const texts = (await pane.findAll({ type: 'Text' })).map(e => e.text)
      const quotaAt = texts.findIndex(t => /^Hạn mức ─/.test(t))
      const warnAt = texts.findIndex(t => /Không có cảnh báo/.test(t))
      expect(quotaAt).toBeGreaterThanOrEqual(0)
      expect(warnAt).toBeGreaterThan(quotaAt)
      await pane.unmount()
    })
  }

  test('dừng vì hạn mức: trạng thái, điểm dừng (giờ tạo, lý do, note, lệnh) và cảnh báo ghi Đang tạm dừng', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    await goalWithSteps($)
    await pauseByQuota($, meter, seen.clock)
    for (const width of [36, 48, 80]) {
      const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: width } })
      expect(await pane.drawn()).toMatchObject({ type: 'Box' })
      expect(await pane.find({ type: 'Text', text: /Trạng thái: tạm dừng \(hạn mức\)/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /Điểm dừng: đang mở, tạo lúc \d\d:\d\d/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /Lý do: hạn mức phiên \(5 giờ\) chỉ còn 3%/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /Ghi chú của Claude: Tiếp: chạy npm test/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /Chạy tiếp: \/conductor resume force/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /Không có cảnh báo/ })).toBeUndefined()
      expect(await pane.find({ type: 'Text', text: /Đang tạm dừng: hạn mức phiên \(5 giờ\) chỉ còn 3%/ })).toBeDefined()
      await pane.unmount()
    }
  })

  test('người dùng tự dừng: trạng thái và lệnh /conductor resume', {}, async ($, on) => {
    base(on, RESUME)
    startHooks(on)
    memoryStore(on)
    quotaMeter(on, [session(10)])
    await goalWithSteps($)
    await conductor($, 'pause')
    const pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: /Trạng thái: tạm dừng \(người dùng\)/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Chạy tiếp: \/conductor resume$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Đang tạm dừng: người dùng yêu cầu tạm dừng/ })).toBeDefined()
    await pane.unmount()
  })

  test('ép tiếp: trạng thái ghi cửa sổ được ép và mốc hết ép', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    await goalWithSteps($)
    await pauseByQuota($, meter, seen.clock)
    await conductor($, 'resume force')
    const pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: /Trạng thái: ép tiếp hạn mức phiên \(5 giờ\) tới \d\d:\d\d/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Đang tạm dừng/ })).toBeUndefined()
    await pane.unmount()
  })

  // 0.7.5 C6: chưa có số đo, không dừng và không có điểm dừng thì mục Hạn mức ẩn hẳn; khi người dùng tự dừng thì mục hiện lại
  // (trạng thái dừng do người dùng).
  test('chưa có số đo: không có mục Hạn mức; người dùng tự dừng thì mục hiện lại', {}, async ($, on) => {
    base(on, RESUME)
    startHooks(on)
    memoryStore(on)
    await goalWithSteps($)
    let pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: /^Hạn mức ─/ })).toBeUndefined()
    await pane.unmount()
    await conductor($, 'pause')
    pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: /^Hạn mức ─/ })).toBeDefined()
    await pane.unmount()
  })

  test('quotaGuard false: không vẽ mục Hạn mức', { options: { quotaGuard: false } }, async ($, on) => {
    base(on, RESUME)
    startHooks(on)
    memoryStore(on)
    quotaMeter(on, [session(99)])
    await goalWithSteps($)
    await measure($, 99)
    const pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: /^Hạn mức ─/ })).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: /Không có cảnh báo/ })).toBeDefined()
    await pane.unmount()
  })

  test('chưa có mục tiêu mà đang dừng: pane vẫn có mục Hạn mức', {}, async ($, on) => {
    base(on, RESUME)
    startHooks(on)
    memoryStore(on)
    quotaMeter(on, [session(97)])
    await measure($, 97)
    const pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: /Trạng thái: tạm dừng \(hạn mức\)/ })).toBeDefined()
    await pane.unmount()
  })

  test('uiLanguage en: nhãn tiếng Anh ở mọi trạng thái', { options: { uiLanguage: 'en' } }, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    await goalWithSteps($)
    await seen.clock.advance(10_000)
    await measure($, 10)
    let pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 48 } })
    expect(await pane.find({ type: 'Text', text: /^Quota ─/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /session \(5h\): used 10%, left 90%.*threshold 5% left/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /State: normal/ })).toBeDefined()
    await pane.unmount()
    await pauseByQuota($, meter, seen.clock)
    pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 36 } })
    expect(await pane.find({ type: 'Text', text: /State: paused \(quota\)/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Checkpoint: open, created \d\d:\d\d/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Reason: session quota \(5h\) only 3% left/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Claude's note: Tiếp: chạy npm test/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Continue with: \/conductor resume force/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Paused: session quota \(5h\) only 3% left/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /No warnings/ })).toBeUndefined()
    await pane.unmount()
    await conductor($, 'resume force')
    pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 80 } })
    expect(await pane.find({ type: 'Text', text: /State: forced past session quota \(5h\) until \d\d:\d\d/ })).toBeDefined()
    await pane.unmount()
  })

  test('uiLanguage en: người dùng tự dừng và chưa có số đo', { options: { uiLanguage: 'en' } }, async ($, on) => {
    base(on, RESUME)
    startHooks(on)
    memoryStore(on)
    await goalWithSteps($)
    // 0.7.5 C6: chưa có số đo và chưa dừng thì không có mục Hạn mức.
    let pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: /^Quota ─/ })).toBeUndefined()
    await pane.unmount()
    await conductor($, 'pause')
    pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: /State: paused \(by you\)/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Paused: you asked to pause/ })).toBeDefined()
    await pane.unmount()
  })
})

describe('0.6.1 3.3: band hẹp khi dừng', () => {
  for (const columns of [40, 48]) {
    for (const maxRows of [1, 2]) {
      test(`${columns} cột, maxRows ${maxRows}: nhãn ngắn, phần cố định không vượt chiều rộng`, {}, async ($, on) => {
        const seen = base(on, RESUME)
        startHooks(on)
        memoryStore(on)
        const meter = quotaMeter(on, [session(10)])
        await goalWithSteps($)
        await pauseByQuota($, meter, seen.clock)
        const band = await $.ui.mount({ plugin: 'focus-conductor', surface: 'terminal', component: 'AbovePrompt', props: bandProps(columns, maxRows) })
        const tree = (await band.drawn()) as unknown as El
        expect(await band.find({ type: 'Text', text: /^dừng$/ })).toBeDefined()
        expect(await band.find({ type: 'Text', text: /tạm dừng: hạn mức/ })).toBeUndefined()
        for (const fixed of fixedRows(tree)) expect(fixed).toBeLessThanOrEqual(columns)
        await band.unmount()
      })
    }
  }

  test('có chip model: thiếu chỗ thì bỏ lần lượt số bước, effort, rồi cả chip model', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    await goalWithSteps($)
    await step($, seen)
    await pauseByQuota($, meter, seen.clock)
    const look = async (columns: number) => {
      const band = await $.ui.mount({ plugin: 'focus-conductor', surface: 'terminal', component: 'AbovePrompt', props: bandProps(columns, 1) })
      const tree = (await band.drawn()) as unknown as El
      const out = {
        count: (await band.find({ type: 'Text', text: /^0\/2$/ })) !== undefined,
        family: (await band.find({ type: 'Text', text: /^ opus $/ })) !== undefined,
        effort: (await band.find({ type: 'Text', text: /xhigh/ })) !== undefined,
        fixed: Math.max(...fixedRows(tree)),
      }
      await band.unmount()
      return out
    }
    expect(await look(48)).toMatchObject({ count: true, family: true, effort: true })
    const at40 = await look(40)
    expect(at40).toMatchObject({ count: false, family: true, effort: true })
    expect(at40.fixed).toBeLessThanOrEqual(40)
    const at36 = await look(36)
    expect(at36).toMatchObject({ count: false, family: true, effort: false })
    expect(at36.fixed).toBeLessThanOrEqual(36)
    const at30 = await look(30)
    expect(at30).toMatchObject({ count: false, family: false, effort: false })
    expect(at30.fixed).toBeLessThanOrEqual(30)
  })

  test('chế độ suggest: thiếu chỗ thì bỏ effort của chip đề xuất, giữ tên model (061-U21)', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    await goalWithSteps($)
    await step($, seen)
    await pauseByQuota($, meter, seen.clock)
    await conductor($, 'mode suggest')
    const band = await $.ui.mount({ plugin: 'focus-conductor', surface: 'terminal', component: 'AbovePrompt', props: bandProps(40, 1) })
    expect(await band.find({ type: 'Text', text: /^opus$/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /xhigh/ })).toBeUndefined()
    for (const fixed of fixedRows((await band.drawn()) as unknown as El)) expect(fixed).toBeLessThanOrEqual(40)
    await band.unmount()
  })

  test('56 cột trở lên: nhãn đầy đủ; en dưới 56 cột: paused', {}, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    await goalWithSteps($)
    await pauseByQuota($, meter, seen.clock)
    const band = await $.ui.mount({ plugin: 'focus-conductor', surface: 'terminal', component: 'AbovePrompt', props: bandProps(56, 2) })
    expect(await band.find({ type: 'Text', text: /^tạm dừng: hạn mức$/ })).toBeDefined()
    await band.unmount()
  })

  test('en dưới 56 cột: nhãn ngắn paused', { options: { uiLanguage: 'en' } }, async ($, on) => {
    const seen = base(on, RESUME)
    startHooks(on)
    memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    await goalWithSteps($)
    await pauseByQuota($, meter, seen.clock)
    const band = await $.ui.mount({ plugin: 'focus-conductor', surface: 'terminal', component: 'AbovePrompt', props: bandProps(40, 1) })
    expect(await band.find({ type: 'Text', text: /^paused$/ })).toBeDefined()
    const tree = (await band.drawn()) as unknown as El
    for (const fixed of fixedRows(tree)) expect(fixed).toBeLessThanOrEqual(40)
    await band.unmount()
  })
})

describe('0.6.1 3.4: band và pane trên vscode và mobile', () => {
  type State = 'no-checklist' | 'warning' | 'paused' | 'near'
  async function reach($: Engine, on: On, state: State) {
    const seen = base(on, RESUME)
    startHooks(on)
    memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    if (state === 'no-checklist') {
      await submit($, COMPLEX_PROMPT)
      return
    }
    await goalWithSteps($)
    if (state === 'warning') {
      await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
      await $.turn.complete(DONE('t1'))
      return
    }
    if (state === 'paused') {
      await pauseByQuota($, meter, seen.clock)
      return
    }
    meter.set([session(92)])
    await seen.clock.advance(10_000)
    await measure($, 92)
  }

  for (const surface of ['vscode', 'mobile'] as const) {
    for (const state of ['no-checklist', 'warning', 'paused', 'near'] as const) {
      test(`${surface}, ${state}: band và pane vẽ được`, {}, async ($, on) => {
        await reach($, on, state)
        const band = await $.ui.mount({ plugin: 'focus-conductor', surface, component: 'AbovePrompt', props: bandProps(80, 3) })
        expect(await band.drawn()).toMatchObject({ type: 'Box' })
        expect(await band.find({ type: 'Text', text: /Refactor module thanh toán/ })).toBeDefined()
        if (state === 'paused') expect(await band.find({ type: 'Text', text: /^tạm dừng: hạn mức$/ })).toBeDefined()
        if (state === 'near') expect(await band.find({ type: 'Text', text: /^hạn mức còn 8%$/ })).toBeDefined()
        await band.unmount()
        const pane = await $.ui.mount({ ...PANE, surface })
        expect(await pane.drawn()).toMatchObject({ type: 'Box' })
        expect(await pane.find({ type: 'Text', text: /Refactor module thanh toán/ })).toBeDefined()
        if (state === 'warning') expect(await pane.find({ type: 'Text', text: /Cảnh báo nhất quán/ })).toBeDefined()
        if (state === 'paused') expect(await pane.find({ type: 'Text', text: /Trạng thái: tạm dừng \(hạn mức\)/ })).toBeDefined()
        await pane.unmount()
      })
    }
  }
})
