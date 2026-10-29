// 0.7.5 R11 (vòng rà soát 3): khóa nhớ kết quả router chấm subagent chỉ giữ mã ngắn (1 tới 3 chữ cái cộng số: b12, l3, utf8, s3) khi mã
// đó có trong brief hay checklist; mã không có trong brief được coi như số lô. codesIn của mentionsGoal cũng chỉ đếm mã có trong brief.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { agentMemoKey as keyOf } from '../../hooks/lib/route'
import { briefCodes, nextBrief, parseRoute } from '../../hooks/lib/router'
import type { Policy, RouterPlan } from '../../hooks/lib/router'
import { makeBrief } from '../support/commands'
import { base, plan, submit, task } from '../support/engine'

const agentMemoKey = keyOf
const key = (description: string, known: string[] = []) => agentMemoKey(description, undefined, undefined, undefined, new Set(known))

describe('0.7.5 R11: mã ngắn chỉ giữ trong khóa khi có trong brief', () => {
  test('b12, l3, utf8, s3 không có trong brief: coi như số lô, cùng khóa', () => {
    expect(key('Đọc b12 lô 3')).toBe(key('Đọc b13 lô 3'))
    expect(key('Lọc l3 tin')).toBe(key('Lọc l4 tin'))
    expect(key('Kiểm utf8 của file')).toBe(key('Kiểm utf16 của file'))
    expect(key('Gộp s3')).toBe(key('Gộp s9'))
  })

  test('mã có trong brief hay checklist được giữ: khác mã, khác khóa', () => {
    expect(key('Đọc b12 lô 3', ['b12', 'b13'])).not.toBe(key('Đọc b13 lô 3', ['b12', 'b13']))
    expect(key('Gộp s3', ['s3'])).not.toBe(key('Gộp s9', ['s3']))
    expect(key('K4.10 kiểm số liệu', ['k4.10', 'k4.11'])).not.toBe(key('K4.11 kiểm số liệu', ['k4.10', 'k4.11']))
  })

  test('mã trong brief chỉ giữ đúng mã đó: mã khác vẫn coi như số', () => {
    expect(key('Đọc b12 lô 3', ['b12'])).not.toBe(key('Đọc b13 lô 3', ['b12']))
    expect(key('Gộp s3 và t4', ['s3'])).toBe(key('Gộp s3 và t7', ['s3']))
  })

  test('mã không có trong brief giữ chữ cái đứng đầu: "b12" và "s3" vẫn khác khóa', () => {
    expect(key('Đọc b12 lô')).not.toBe(key('Đọc s3 lô'))
  })

  test('mã bước và mã việc (BƯỚC N, Việc N) vẫn được giữ như trước', () => {
    expect(key('BƯỚC 3: lọc tin lô 1')).not.toBe(key('BƯỚC 9: lọc tin lô 1'))
    expect(key('Việc 2: đổi tên lô 3')).not.toBe(key('Việc 5: đổi tên lô 3'))
    expect(key('BƯỚC 3: lọc tin lô 1')).toBe(key('BƯỚC 3: lọc tin lô 77'))
  })

  test('briefCodes lấy mã từ bước, việc và checklist, bỏ dấu và viết thường', () => {
    const codes = briefCodes(['K4.10 Kiểm kê', 'BƯỚC 7: lọc tin', 'Đọc B12 và utf8'])
    expect(codes.has('k4.10')).toBe(true)
    expect(codes.has('b12')).toBe(true)
    expect(codes.has('utf8')).toBe(true)
    expect(codes.has('buoc7')).toBe(true)
    expect(codes.has('b13')).toBe(false)
  })
})

describe('0.7.5 R11: số lượt router khi ghi nhiều lô mã ngắn', () => {
  const agent = ($: Engine, description: string) => $.tool.call({ tool: 'Agent', description, prompt: `${description} trong codebase` } as never)

  test('20 lời gọi "Đọc b<N>" khi brief không có mã b: một lần chấm (cùng khóa)', {}, async ($, on) => {
    const seen = base(on, { router: () => plan({ goal: 'Dọn dữ liệu', depth: 'hard', volume: 'large' }) })
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'xong' }))
    await submit($, 'Dọn dữ liệu')
    for (let n = 10; n < 30; n++) await agent($, `Đọc b${n} và ghi chú`)
    expect(seen.agentRouted.length).toBe(1)
  })

  test('brief có mã b12 và b13: hai lần chấm riêng', {}, async ($, on) => {
    const seen = base(on, { router: () => plan({ goal: 'Dọn dữ liệu', depth: 'hard', volume: 'large', tasks: [task('b12 chuẩn bị', 'main', 'opus', 'high'), task('b13 đối chiếu', 'main', 'opus', 'high')] }) })
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'xong' }))
    await submit($, 'Dọn dữ liệu')
    await agent($, 'Đọc b12 và ghi chú')
    await agent($, 'Đọc b13 và ghi chú')
    await agent($, 'Đọc b14 và ghi chú')
    expect(seen.agentRouted.length).toBeGreaterThanOrEqual(2)
  })
})

describe('0.7.5 R11: agent của workflow cũng dùng mã trong brief', () => {
  const spawn = ($: Engine, index: number, description: string) => $.agent.spawn({ prompt: description, description, workflow: { runId: 'wf_r11', agentIndex: index } } as never)
  const workflowHooks = (on: Parameters<typeof base>[0]) => {
    let n = 0
    on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `w-${(n += 1)}` }))
    on('turn.complete', () => ({ text: '' }))
  }

  test('brief không có mã b: hai agent "Đọc b12" và "Đọc b13" dùng chung một lần chấm', {}, async ($, on) => {
    const seen = base(on, { router: () => plan({ goal: 'Dọn dữ liệu', depth: 'hard', volume: 'large' }) })
    workflowHooks(on)
    await submit($, 'Dọn dữ liệu')
    await spawn($, 1, 'Đọc b12 và ghi chú')
    await spawn($, 2, 'Đọc b13 và ghi chú')
    expect(seen.agentRouted.length).toBe(1)
  })

  test('brief có mã b12 và b13: hai lần chấm riêng', {}, async ($, on) => {
    const seen = base(on, { router: () => plan({ goal: 'Dọn dữ liệu', depth: 'hard', volume: 'large', tasks: [task('b12 chuẩn bị', 'main', 'opus', 'high'), task('b13 đối chiếu', 'main', 'opus', 'high')] }) })
    workflowHooks(on)
    await submit($, 'Dọn dữ liệu')
    await spawn($, 1, 'Đọc b12 và ghi chú')
    await spawn($, 2, 'Đọc b13 và ghi chú')
    expect(seen.agentRouted.length).toBe(2)
  })
})

describe('0.7.5 R11: mã trong checklist của tool plan cũng được tính', () => {
  const agent = ($: Engine, description: string) => $.tool.call({ tool: 'Agent', description, prompt: `${description} trong codebase` } as never)

  test('brief không có mã b nhưng checklist có b12 và b13: hai lần chấm riêng', {}, async ($, on) => {
    const seen = base(on, { router: () => plan({ goal: 'Dọn dữ liệu', depth: 'hard', volume: 'large' }) })
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'xong' }))
    await submit($, 'Dọn dữ liệu')
    await $.tool.call({ tool: 'mcp__focus-conductor__plan', action: 'set', steps: [{ title: 'b12 chuẩn bị' }, { title: 'b13 đối chiếu' }] })
    await agent($, 'Đọc b12 và ghi chú')
    await agent($, 'Đọc b13 và ghi chú')
    expect(seen.agentRouted.length).toBe(2)
  })
})

describe('0.7.5 R11: mentionsGoal chỉ đếm mã có trong brief', () => {
  const OPEN: Policy = { allowFable: false, blocked: new Set(), session: null }
  const routed = (over: Record<string, unknown>): RouterPlan => parseRoute(JSON.stringify(plan(over)), OPEN)!
  const prev = makeBrief({ goalId: 3, steps: ['K4.1 Kiểm kê kho', 'K4.2 Xếp loại'], tasks: [] })

  test('prompt nhắc mã không có trong brief (utf8, b12) không được giữ làm tiếp nối', () => {
    const out = nextBrief(prev, routed({ relation: 'new', confidence: 0.7, goal: 'Việc khác' }), 'Kiểm utf8 của b12 giúp tôi', 2, { openSteps: prev.steps })
    expect(out.held).toBe(false)
    expect(out.isNewGoal).toBe(true)
  })

  test('prompt nhắc mã có trong brief (K4.2) được giữ làm tiếp nối', () => {
    const out = nextBrief(prev, routed({ relation: 'new', confidence: 0.7, goal: 'Việc khác' }), 'làm tiếp K4.2', 2, { openSteps: prev.steps })
    expect(out.held).toBe(true)
  })
})
