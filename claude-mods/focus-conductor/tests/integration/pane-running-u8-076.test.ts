// 0.7.6 U8: mục "Đang chạy" của pane, lấy từ tiến độ agent: mỗi việc có subagent đang chạy một dòng gồm tên việc, khoảng lô (theo
// số cuối của mô tả), số agent đang chạy và thời gian từ lúc agent đầu tiên của nhóm bắt đầu. Không có agent đang chạy thì không có mục.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { PANE, base, plan, spawnTool, submit, task } from '../support/engine'

const GOAL = 'Lọc tin và tổng hợp'

function hooks(on: On) {
  on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: `a-${e.tool_use_id}` }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
}

async function goal($: Engine, on: On) {
  const seen = base(on, { router: () => plan({ goal: GOAL, depth: 'hard', volume: 'large', tasks: [task('BƯỚC 1: chuẩn bị', 'main', 'opus', 'high'), task('BƯỚC 2: lọc tin', 'agent', 'sonnet', 'medium'), task('BƯỚC 3: tổng hợp', 'main', 'opus', 'high')] }) })
  hooks(on)
  await submit($, GOAL)
  return seen
}

async function paneTexts($: Engine): Promise<string[]> {
  const pane = await $.ui.mount(PANE)
  const texts = (await pane.findAll({ type: 'Text' })).map(e => e.text).filter((t): t is string => typeof t === 'string')
  await pane.unmount()
  return texts
}

describe('0.7.6 U8: mục Đang chạy của pane', () => {
  test('hai lô của BƯỚC 2 đang chạy 3 phút: "BƯỚC 2: lọc tin · lô 101 đến 102 · 2 agent · 3 phút", trước mục Chế độ', async ($, on) => {
    const seen = await goal($, on)
    await spawnTool($, 'u1', 'BƯỚC 2: lọc tin lô 101', 'lọc')
    await seen.clock.advance(30_000)
    await spawnTool($, 'u2', 'BƯỚC 2: lọc tin lô 102', 'lọc')
    await seen.clock.advance(150_000)
    const texts = await paneTexts($)
    const at = texts.findIndex(t => /^Đang chạy ─/.test(t))
    expect(at).toBeGreaterThanOrEqual(0)
    expect(texts.slice(at)).toContain('BƯỚC 2: lọc tin · lô 101 đến 102 · 2 agent · 3 phút')
    expect(texts.findIndex(t => t === 'Chế độ')).toBeGreaterThan(at)
  })

  test('một lô: "lô 7"; việc Claude tự giao không có số: không ghi lô', async ($, on) => {
    await goal($, on)
    await spawnTool($, 'u1', 'BƯỚC 2: lọc tin lô 7', 'lọc')
    await spawnTool($, 'u9', 'Kiểm tra log lỗi thanh toán', 'kiểm tra')
    const texts = await paneTexts($)
    expect(texts).toContain('BƯỚC 2: lọc tin · lô 7 · 1 agent · <1 phút')
    expect(texts).toContain('Claude tự giao: Kiểm tra log lỗi thanh toán · 1 agent · <1 phút')
  })

  test('25 lô đang chạy (danh sách agent chỉ giữ 20 agent gần nhất): số agent theo bộ đếm', async ($, on) => {
    await goal($, on)
    for (let n = 1; n <= 25; n++) await spawnTool($, `u${n}`, `BƯỚC 2: lọc tin lô ${n}`, 'lọc')
    const texts = await paneTexts($)
    expect(texts.some(t => /^BƯỚC 2: lọc tin · lô \d+ đến 25 · 25 agent · <1 phút$/.test(t))).toBe(true)
  })

  test('không có agent đang chạy: không có mục Đang chạy', async ($, on) => {
    await goal($, on)
    await spawnTool($, 'u1', 'BƯỚC 2: lọc tin lô 1', 'lọc')
    await $.turn.complete({ turnId: 't-u1', agentId: 'a-u1', answer: '', durationMs: 1, isAborted: false, reason: 'answer' } as never)
    const texts = await paneTexts($)
    expect(texts.some(t => /^Đang chạy ─/.test(t))).toBe(false)
  })

  test('uiLanguage en: "Running", "runs 101 to 102 · 2 agents · 3 min"', { options: { uiLanguage: 'en' } }, async ($, on) => {
    const seen = await goal($, on)
    await spawnTool($, 'u1', 'BƯỚC 2: lọc tin lô 101', 'lọc')
    await spawnTool($, 'u2', 'BƯỚC 2: lọc tin lô 102', 'lọc')
    await seen.clock.advance(180_000)
    const texts = await paneTexts($)
    expect(texts.some(t => /^Running ─/.test(t))).toBe(true)
    expect(texts).toContain('BƯỚC 2: lọc tin · runs 101 to 102 · 2 agents · 3 min')
  })
})
