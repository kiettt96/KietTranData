// 0.8.8 N5: màu chạy. Khi có turn luồng chính đang chạy, neon khác off và neonMotion là on, nhịp vẽ lại là 1 giây thay cho 60 giây; frame là
// số giây của đồng hồ lúc vẽ, mọi dải màu của band và pane dùng chung frame; \u25D0 của bước đang làm in đậm ở frame chẵn, thường ở frame lẻ;
// dải pause đứng yên. Nhịp chỉ xin vẽ lại (không ghi $.state, không chèn context), nhiều nhất một nhịp, tự hủy khi không còn turn chạy.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import type { Seen } from '../support/engine'
import { base, plan, submit } from '../support/engine'

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const PLAN = 'mcp__focus-conductor__plan'
const HALF = '\u25D0'
const textOf = (n: unknown): string => (typeof n === 'string' ? n : n !== null && typeof n === 'object' ? ((n as Node).children ?? []).map(textOf).join('') : '')
function texts(root: unknown): Node[] {
  const out: Node[] = []
  const walk = (n: unknown) => {
    if (n === null || typeof n !== 'object') return
    if ((n as Node).type === 'Text') out.push(n as Node)
    for (const c of (n as Node).children ?? []) walk(c)
  }
  walk(root)
  return out
}

/** Đếm chu kỳ $.clock.every được xin (theo ms), các lần xin vẽ lại và các lần ghi $.state. Gọi trước base(). */
function counters(on: On) {
  const count = { periods: [] as number[], invalidates: 0, writes: 0 }
  for (const ms of [1_000, 60_000]) {
    on('clock.every', { ms }, (_$, e, next) => {
      count.periods.push(ms)
      return next(e)
    })
  }
  on('ui.invalidate', (_$, e, next) => {
    count.invalidates += 1
    return next(e)
  })
  on('state.set', (_$, e, next) => {
    count.writes += 1
    return next(e)
  })
  return count
}

function sessionHooks(on: On) {
  on('tool.register', () => ({ value: { tool: PLAN } }) as never)
  on('command.register', () => ({ value: { command: 'conductor' } }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
}

async function goal($: Engine, on: On): Promise<Seen> {
  const seen = base(on, { router: () => plan({ goal: 'Sửa module thanh toán', depth: 'substantial', volume: 'small' }) })
  on('turn.complete', () => ({ text: '' }))
  await submit($, 'Sửa module thanh toán')
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }, { title: 'Kiểm' }, { title: 'Ghi' }] } as never)
  await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' } as never)
  await $.tool.call({ tool: PLAN, action: 'update', step: 2, status: 'doing' } as never)
  return seen
}
const startTurn = ($: Engine) => $.turn.start({ text: 'làm', turnId: 't1' })
const endTurn = ($: Engine) => $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, reason: 'answer' } as never)

async function band($: Engine): Promise<Node> {
  const ui = await $.ui.mount({ plugin: 'focus-conductor', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isCollapsed: false, isWorking: true, maxRows: 2, bodyColumns: 120, scroll: { offset: 0, bodyRows: 2 }, view: {} } } as never)
  const tree = (await ui.drawn()) as unknown as Node
  await ui.unmount()
  return tree
}
/** Ô đầu của thanh tiến độ (dòng 2) và ký hiệu \u25D0 của đầu thanh. */
const barOf = (tree: Node) => {
  const all = texts(tree).filter(t => (t.children ?? []).every(c => typeof c === 'string'))
  const first = all.find(t => textOf(t).startsWith('\u2501'))
  const head = all.find(t => textOf(t) === HALF)
  return { color: first?.props?.color, bold: head?.props?.bold === true }
}

describe('0.8.8 N5: nhịp 1 giây', () => {
  test('turn đang chạy, mặc định: xin chu kỳ 1.000 ms; ba nhịp là ba lần vẽ lại, không ghi $.state, không chèn context', { options: { planApproval: 'off' } }, async ($, on) => {
    const count = counters(on)
    sessionHooks(on)
    const seen = await goal($, on)
    await startTurn($)
    expect(count.periods).toEqual([1_000])
    const before = { invalidates: count.invalidates, writes: count.writes, contexts: seen.contexts?.length ?? 0 }
    for (let i = 0; i < 3; i++) await seen.clock.advance(1_000)
    expect(count.invalidates - before.invalidates).toBe(3)
    expect(count.writes - before.writes).toBe(0)
    expect(seen.contexts?.length ?? 0).toBe(before.contexts)
  })

  for (const option of [{ neonMotion: 'off' }, { neon: 'off' }]) {
    test(`${JSON.stringify(option)}: chu kỳ 60.000 ms; hai lần vẽ cách nhau 5 giây cho cùng một cây`, { options: { planApproval: 'off', ...option } }, async ($, on) => {
      const count = counters(on)
      sessionHooks(on)
      const seen = await goal($, on)
      await startTurn($)
      expect(count.periods).toEqual([60_000])
      // Vẽ lần đầu khi thời gian đã chạy đã có chữ ("<1 phút"), để hai lần vẽ chỉ khác nhau ở nhịp của dải màu.
      await seen.clock.advance(2_000)
      // Bỏ khóa press (mã nút đổi mỗi lần dựng), còn lại là cây vẽ.
      const shape = async () => JSON.stringify(await band($), (key, value) => (key === 'press' ? undefined : value))
      const first = await shape()
      await seen.clock.advance(5_000)
      expect(await shape()).toBe(first)
    })
  }

  test('mặc định: hai lần vẽ cách nhau 1 giây có màu ô đầu của thanh khác nhau; \u25D0 đổi giữa đậm và thường', { options: { planApproval: 'off' } }, async ($, on) => {
    const seen = await goal($, on)
    await startTurn($)
    const a = barOf(await band($))
    await seen.clock.advance(1_000)
    const b = barOf(await band($))
    expect(a.color).toMatch(/^#[0-9a-f]{6}$/)
    expect(b.color).not.toBe(a.color)
    expect(b.bold).toBe(!a.bold)
  })

  test('không có turn đang chạy: không có nhịp nào', { options: { planApproval: 'off' } }, async ($, on) => {
    const count = counters(on)
    sessionHooks(on)
    const seen = await goal($, on)
    await seen.clock.advance(10_000)
    expect(count.periods).toEqual([])
    await startTurn($)
    await endTurn($)
    const after = count.invalidates
    await seen.clock.advance(10_000)
    expect(count.invalidates - after).toBeLessThanOrEqual(1)
  })

  test('nạp lại mod giữa turn: vẫn chỉ một nhịp', { options: { planApproval: 'off' } }, async ($, on) => {
    const count = counters(on)
    sessionHooks(on)
    const seen = await goal($, on)
    await startTurn($)
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: true } as never)
    const before = count.invalidates
    await seen.clock.advance(3_000)
    expect(count.invalidates - before).toBe(3)
  })
})
