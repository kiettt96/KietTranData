// 0.7.9 UI2: dòng Đang chạy của pane ở 56 tới 72 cột phải cắt thì cắt phần tên trước, giữ trọn "· từ HH:MM" (en "since"). Thời gian đã chạy
// ở pane và band cập nhật mỗi 60 giây khi có turn luồng chính đang chạy: một nhịp $.clock.every chỉ vẽ lại ($.ui.invalidate), không ghi
// $.state và không tạo context cho model. Không có turn đang chạy thì không có nhịp; nạp lại mod giữa turn không để lại hai nhịp.

import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import type { Seen } from '../support/engine'
import { PANE, base, plan, spawnTool, submit, task } from '../support/engine'

const GOAL = 'Lọc tin và tổng hợp'
const LONG = 'BƯỚC 2: lọc tin của từng nguồn và đối chiếu với bảng tham chiếu của nhóm phụ trách'

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const textOf = (n: unknown): string => (typeof n === 'string' ? n : n !== null && typeof n === 'object' ? ((n as Node).children ?? []).map(textOf).join('') : '')
const cells = (text: string) => [...text.normalize('NFC')].length

/**
 * Đếm các lần mod xin vẽ lại, các lần ghi $.state và các chu kỳ $.clock.every 60 giây được xin (hook của test nằm dưới mod, chuyển tiếp cho kit
 * trả lời). Gọi trước base() để hook đếm chu kỳ nằm trên đồng hồ giả.
 */
function counters(on: On) {
  const count = { invalidates: [] as string[], writes: 0, periods: 0 }
  // Matcher riêng (chu kỳ 60 giây): đồng hồ giả đã đăng ký clock.every không matcher.
  on('clock.every', { ms: 60_000 }, (_$, e, next) => {
    count.periods += 1
    return next(e)
  })
  on('ui.invalidate', (_$, e, next) => {
    count.invalidates.push(String(e.event))
    return next(e)
  })
  on('state.set', (_$, e, next) => {
    count.writes += 1
    return next(e)
  })
  return count
}

/** Tầng dưới của session.start (như engine nạp lại mod): mod đăng ký tool plan và lệnh /conductor ở đó. */
function sessionHooks(on: On) {
  on('tool.register', () => ({ value: { tool: 'mcp__focus-conductor__plan' } }) as never)
  on('command.register', () => ({ value: { command: 'conductor' } }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
}
const reload = ($: Engine) => $.session.start({ cwd: '/repo', surface: null, isInteractive: true } as never)

async function goal($: Engine, on: On, title = 'BƯỚC 2: lọc tin'): Promise<Seen> {
  const seen = base(on, { router: () => plan({ goal: GOAL, depth: 'hard', volume: 'large', tasks: [task('BƯỚC 1: chuẩn bị', 'main', 'opus', 'high'), task(title, 'agent', 'sonnet', 'medium'), task('BƯỚC 3: tổng hợp', 'main', 'opus', 'high')] }) })
  on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: `a-${e.tool_use_id}` }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
  await submit($, GOAL)
  return seen
}

const startTurn = ($: Engine) => $.turn.start({ text: GOAL, turnId: 't1' })
const endTurn = ($: Engine) => $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, reason: 'answer' } as never)

/** Dòng Đang chạy của pane ở `columns` cột: Text đầu tiên sau tiêu đề mục, bắt đầu bằng mã bước. */
async function runningLine($: Engine, columns: number, heading: RegExp): Promise<string> {
  const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: columns } })
  const texts = (await pane.findAll({ type: 'Text' })).map(e => e.text).filter((t): t is string => typeof t === 'string')
  await pane.unmount()
  const at = texts.findIndex(t => heading.test(t))
  expect(at).toBeGreaterThanOrEqual(0)
  return texts.slice(at + 1).find(t => t.startsWith('BƯỚC 2')) ?? ''
}

const BAND_PROPS = { hasSurvey: false, isCollapsed: false, isWorking: true, maxRows: 2, bodyColumns: 120, scroll: { offset: 0, bodyRows: 2 }, view: {} }
const mountBand = ($: Engine) => $.ui.mount({ plugin: 'focus-conductor', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS } as never)

/** Thời gian đã chạy của mục tiêu trên dòng 1 của band ("<1 phút", "3 phút"). */
const bandElapsed = async (band: Awaited<ReturnType<typeof mountBand>>) => /(<1|\d+) phút/.exec(textOf(await band.drawn()))?.[0] ?? ''

const mountPane = ($: Engine) => $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 80 } })

/** Thời gian của dòng Đang chạy trên pane đang gắn (dòng có "· từ HH:MM"; checklist dự kiến cũng ghi tên bước). */
const paneElapsed = async (pane: Awaited<ReturnType<typeof mountPane>>) => {
  const texts = (await pane.findAll({ type: 'Text' })).map(e => e.text).filter((t): t is string => typeof t === 'string')
  return texts.map(t => /^BƯỚC 2.* · (<1|\d+) phút · từ \d\d:\d\d$/.exec(t)?.[1]).find(found => found !== undefined) ?? ''
}

describe('0.7.9 UI2: dòng Đang chạy giữ "từ HH:MM"', () => {
  for (const columns of [56, 60, 72]) {
    test(`pane ${columns} cột, tên việc dài: dòng Đang chạy không quá bề ngang, cắt tên trước, còn đủ "· từ HH:MM"`, { options: { planApproval: 'off' } }, async ($, on) => {
      const seen = await goal($, on, LONG)
      await spawnTool($, 'u1', `${LONG} lô 101`, 'lọc')
      await spawnTool($, 'u2', `${LONG} lô 102`, 'lọc')
      await seen.clock.advance(180_000)
      const line = await runningLine($, columns, /^\s*Đang chạy\s+─/)
      expect(cells(line), line).toBeLessThanOrEqual(columns)
      expect(line).toMatch(/^BƯỚC 2:.*… · lô 101 đến 102 · 2 agent · 3 phút · từ \d\d:\d\d$/)
    })
  }

  test('uiLanguage en, 60 cột: còn đủ "· since HH:MM"', { options: { planApproval: 'off', uiLanguage: 'en' } }, async ($, on) => {
    const seen = await goal($, on, LONG)
    await spawnTool($, 'u1', `${LONG} lô 101`, 'lọc')
    await seen.clock.advance(180_000)
    const line = await runningLine($, 60, /^\s*Running\s+─/)
    expect(cells(line), line).toBeLessThanOrEqual(60)
    expect(line).toMatch(/^BƯỚC 2:.*… · run 101 · 1 agent · 3 min · since \d\d:\d\d$/)
  })

  test('tên việc ngắn vừa 72 cột: giữ nguyên tên, không cắt', { options: { planApproval: 'off' } }, async ($, on) => {
    await goal($, on)
    await spawnTool($, 'u1', 'BƯỚC 2: lọc tin lô 7', 'lọc')
    const line = await runningLine($, 72, /^\s*Đang chạy\s+─/)
    expect(line).toMatch(/^BƯỚC 2: lọc tin · lô 7 · 1 agent · <1 phút · từ \d\d:\d\d$/)
  })
})

describe('0.7.9 UI2: nhịp vẽ lại 60 giây khi có turn đang chạy', () => {
  test('đồng hồ giả chạy 3 phút trong một turn: thời gian đã chạy ở band và pane tăng 3 lần, 3 lần vẽ lại, không ghi $.state', { options: { planApproval: 'off', neonMotion: 'off' } }, async ($, on) => {
    const count = counters(on)
    const session = mock.session(on)
    const seen = await goal($, on)
    await spawnTool($, 'u1', 'BƯỚC 2: lọc tin lô 1', 'lọc')
    await startTurn($)
    await seen.clock.advance(10_000)
    const band = await mountBand($)
    const pane = await mountPane($)
    const bandSeen = [await bandElapsed(band)]
    const paneSeen = [await paneElapsed(pane)]
    const before = { invalidates: count.invalidates.length, writes: count.writes, appended: session.appended().length }
    for (let k = 0; k < 3; k++) {
      await seen.clock.advance(60_000)
      bandSeen.push(await bandElapsed(band))
      paneSeen.push(await paneElapsed(pane))
    }
    expect(bandSeen).toEqual(['<1 phút', '1 phút', '2 phút', '3 phút'])
    expect(paneSeen).toEqual(['<1', '1', '2', '3'])
    const ticks = count.invalidates.slice(before.invalidates)
    expect(ticks).toEqual(['ui.render', 'ui.render', 'ui.render'])
    expect(count.periods).toBeGreaterThanOrEqual(3)
    // Nhịp chỉ vẽ lại: không ghi $.state, không nối gì vào hội thoại.
    expect(count.writes - before.writes).toBe(0)
    expect(session.appended().length - before.appended).toBe(0)
    await band.unmount()
    await pane.unmount()
    // Hook đếm của test có nghe được lần ghi $.state (kết thúc turn ghi trạng thái): số 0 ở trên là đo thật.
    await endTurn($)
    expect(count.writes - before.writes).toBeGreaterThan(0)
  })

  test('không có turn đang chạy: không có nhịp nào, kể cả sau khi nạp lại mod; turn kết thúc thì nhịp dừng', { options: { planApproval: 'off' } }, async ($, on) => {
    sessionHooks(on)
    const count = counters(on)
    const seen = await goal($, on)
    const band = await mountBand($)
    const first = await bandElapsed(band)
    await reload($)
    await seen.clock.advance(180_000)
    expect(count.invalidates.length).toBe(0)
    // Không đặt nhịp: không có chu kỳ $.clock.every nào được xin.
    expect(count.periods).toBe(0)
    expect(await bandElapsed(band)).toBe(first)
    await band.unmount()
    await startTurn($)
    await seen.clock.advance(60_000)
    await endTurn($)
    const after = count.invalidates.length
    await seen.clock.advance(180_000)
    expect(count.invalidates.length).toBe(after)
  })

  test('nạp lại mod giữa turn (session.start lần nữa), rồi đồng hồ chạy 3 phút: vẫn đúng 3 lần vẽ lại', { options: { planApproval: 'off', neonMotion: 'off' } }, async ($, on) => {
    sessionHooks(on)
    const count = counters(on)
    const seen = await goal($, on)
    await startTurn($)
    await seen.clock.advance(30_000)
    await reload($)
    const before = count.invalidates.length
    await seen.clock.advance(180_000)
    expect(count.invalidates.length - before).toBe(3)
    await endTurn($)
    const after = count.invalidates.length
    await seen.clock.advance(180_000)
    expect(count.invalidates.length).toBe(after)
  })

  test('turn mới bắt đầu ngay sau turn cũ (trước nhịp kế): vẫn một nhịp, 3 phút là 3 lần vẽ lại', { options: { planApproval: 'off', neonMotion: 'off' } }, async ($, on) => {
    const count = counters(on)
    const seen = await goal($, on)
    await startTurn($)
    await seen.clock.advance(30_000)
    await endTurn($)
    await $.turn.start({ text: 'làm tiếp', turnId: 't2' })
    const before = count.invalidates.length
    await seen.clock.advance(180_000)
    expect(count.invalidates.length - before).toBe(3)
  })
})
