// 0.7.5 mục 6: nghiệm thu phiên dài. Prompt tự viết khoảng 30.000 ký tự, 11 bước có mã BƯỚC 0 tới BƯỚC 10, quy định model theo
// loại việc; một turn của luồng chính với 1.000 tool call (đọc, script python chạy bằng đường dẫn tuyệt đối, lệnh kiểm đã khai
// chạy qua | tail); 300 subagent mỗi cái 4 tool call, mô tả theo mã BƯỚC; hai lần nén; một lần báo hạn mức mềm. Các chỉ số gom
// vào `measure`, cùng kịch bản này chạy trên main 19b0349 cho bảng trước và sau ở VERIFICATION.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { PANE, base, plan, task } from '../support/engine'
import { quotaMeter, week } from '../support/quota'
import { LONG_CODED_PROMPT } from '../fixtures/prompt-long-coded'

const PLAN = 'mcp__focus-conductor__plan'
const ROOT = '/srv/so-gia'
const CHECKS = [`python3 ${ROOT}/scripts/kiem-dinh-dang.py`, `python3 ${ROOT}/scripts/kiem-trung-lap.py`]
const TITLES = [
  'BƯỚC 0: chuẩn bị và đọc hiện trạng',
  'BƯỚC 1: chuẩn hóa đơn vị tính',
  'BƯỚC 2: chuyển dữ liệu cũ sang dạng tuần',
  'BƯỚC 3: lọc tin thị trường, lô 1',
  'BƯỚC 4: lọc tin thị trường, lô 2',
  'BƯỚC 5: lọc tin thị trường, lô 3',
  'BƯỚC 6: đọc và giải thích biến động giá',
  'BƯỚC 7: tóm tắt tin theo nhóm hàng',
  'BƯỚC 8: bảng giá tuần cho biên tập',
  'BƯỚC 9: bản tổng hợp tuần',
  'BƯỚC 10: kết thúc phiên',
]
/** Script ghi dữ liệu của từng bước (bước lọc tin dùng chung một script gộp). */
const SCRIPTS = ['chuan-bi', 'chuan-don-vi', 'chuyen-tuan', 'gop-tin', 'gop-tin', 'gop-tin', 'bien-dong', 'tom-tat', 'bang-gia', 'tong-hop', 'ket-thuc']
const FILTER_STEPS = [3, 4, 5]
const AGENTS_PER_STEP = 100
const MAIN_CALLS = 1000
/** Một lời gọi script ghi dữ liệu trong mỗi SCRIPT_EVERY lời gọi của luồng chính, còn lại là đọc (VERIFICATION ghi thêm số đo với 3). */
const SCRIPT_EVERY = 10
const MESSAGES = [{ role: 'user' as const, text: 'tóm tắt', toolUses: [] }]
const OPTIONS = { options: { checkCommands: CHECKS.join(','), noticeWeekRemainingPct: 25 }, timeoutMs: 600_000 }

const LONG_PLAN = plan({
  goal: 'Cập nhật sổ giá nông sản theo 11 bước BƯỚC 0 tới BƯỚC 10',
  constraints: [
    'Việc lọc tin thị trường chạy sonnet, giao subagent theo lô',
    'Đọc hiểu, giải thích và tóm tắt dùng model của phiên',
    'Không tạo bộ test mới; kiểm bằng hai script kiểm có sẵn',
    'Dừng khi hạn mức tuần đã dùng 80 phần trăm',
  ],
  scope: [ROOT],
  depth: 'hard',
  volume: 'large',
  kind: 'mixed',
  main: { model: 'opus', effort: 'high', why: 'phiên dài nhiều bước' },
  tasks: TITLES.map((title, k) =>
    FILTER_STEPS.includes(k) ? task(title, 'agent', 'sonnet', 'medium', { kind: 'investigate' }) : task(title, 'main', 'opus', 'high'),
  ),
})

type Out = { context?: string[]; result?: unknown }

function hooks(on: On) {
  on('classic.Stop', () => ({}))
  on('turn.complete', () => ({ text: '' }))
  on('session.compact', () => ({ messages: MESSAGES }))
  on('tool.call', { tool: 'Read' }, () => ({ result: 'nội dung', isReadOnly: true }))
  on('tool.call', { tool: 'Write' }, () => ({ result: 'đã ghi' }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
  on('tool.call', { tool: 'Bash' }, (_$, e) => ({ result: String((e as { command?: unknown }).command ?? '').includes('kiem-') ? 'Đã kiểm 1200 tin\nKẾT QUẢ: ĐẠT' : 'đã ghi 100 dòng' }))
  on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: `ag-${String((e as { tool_use_id?: unknown }).tool_use_id)}` }) as never)
}

type Measure = {
  injectedChars: number
  scopeWarnings: Record<string, number>
  agentRouterCalls: number
  stopBlockedAfterAgents: boolean
  checkpointsAfterAgents: number
  autoVerifiedAtClose: boolean[]
  compactReminders: number
  softNotices: number
  taskRows: string[]
}

async function session($: Engine, on: On): Promise<Measure> {
  const seen = base(on, { router: () => LONG_PLAN, root: ROOT })
  hooks(on)
  const meter = quotaMeter(on, [week(50)])
  const m: Measure = { injectedChars: 0, scopeWarnings: {}, agentRouterCalls: 0, stopBlockedAfterAgents: false, checkpointsAfterAgents: 0, autoVerifiedAtClose: [], compactReminders: 0, softNotices: 0, taskRows: [] }
  let afterAgents = false
  const note = (out: Out) => {
    for (const c of out.context ?? []) {
      m.injectedChars += c.length
      for (const script of new Set(SCRIPTS)) if (c.includes(`${script}.py`) && c.includes('không xác định được file đích')) m.scopeWarnings[script] = (m.scopeWarnings[script] ?? 0) + 1
      if (c.includes('Checkpoint:') && afterAgents) m.checkpointsAfterAgents += 1
      if (c.startsWith('[focus-conductor] Hội thoại vừa được nén.')) m.compactReminders += 1
      if (c.includes('quy tắc dừng theo hạn mức')) m.softNotices += 1
    }
    return out
  }
  const call = async (input: Record<string, unknown>) => note((await $.tool.call(input as never)) as Out)

  await $.prompt.submit({ text: LONG_CODED_PROMPT, wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: LONG_CODED_PROMPT, turnId: 't1' })
  await call({ tool: PLAN, action: 'set', steps: TITLES.map(title => ({ title })) })

  let mainCalls = 0
  const tick = async () => {
    mainCalls += 1
    if (mainCalls % 10 === 0) await seen.clock.advance(5_000)
    if (mainCalls === 300 || mainCalls === 700) await $.session.compact({ trigger: 'auto', messages: MESSAGES } as never)
    if (mainCalls === 900) {
      meter.set([week(76)])
      await seen.clock.advance(10_000)
    }
  }
  const perStep = (k: number) => (k === TITLES.length - 1 ? MAIN_CALLS - 90 * (TITLES.length - 1) : 90)

  for (const [k] of TITLES.entries()) {
    await call({ tool: PLAN, action: 'update', step: k + 1, status: 'doing' })
    if (FILTER_STEPS.includes(k)) {
      for (let n = 1; n <= AGENTS_PER_STEP; n++) {
        const id = `s${k}-${n}`
        const agentId = `ag-${id}`
        const description = `BƯỚC ${k}: lọc tin lô ${n}`
        await call({ tool: 'Agent', tool_use_id: id, description, prompt: `Lọc tin của lô ${n} trong ${ROOT}/data/tin-tho theo tiêu chí giữ và bỏ.`, model: 'sonnet', subagent_type: 'general-purpose' })
        await $.agent.spawn({ prompt: `Lọc tin lô ${n}`, description, tool_use_id: id } as never)
        await $.turn.start({ text: `Lọc tin lô ${n}`, turnId: `a-${id}`, agentId } as never)
        for (let r = 1; r <= 3; r++) await call({ tool: 'Read', file_path: `${ROOT}/data/tin-tho/lo-${n}/tin-${r}.json`, agentId })
        await call({ tool: 'Write', file_path: `${ROOT}/data/tin-loc/lo-${n}.json`, content: '[]', agentId })
        await $.turn.complete({ turnId: `a-${id}`, agentId, answer: 'xong', durationMs: 5, isAborted: false, reason: 'answer' } as never)
      }
      afterAgents = true
    }
    const count = perStep(k)
    for (let i = 0; i < count - CHECKS.length; i++) {
      await tick()
      if (i % SCRIPT_EVERY === 1) await call({ tool: 'Bash', command: `/usr/bin/python3 -B ${ROOT}/scripts/${SCRIPTS[k]}.py --lo ${i}` })
      else await call({ tool: 'Read', file_path: `${ROOT}/data/tuan/tuan-${k}-${i}.json` })
    }
    for (const check of CHECKS) {
      await tick()
      await call({ tool: 'Bash', command: `${check} 2>&1 | tail -n 3` })
    }
    const closed = await call({ tool: PLAN, action: 'update', step: k + 1, status: 'done' })
    const line = String(closed.result ?? '').split('\n').find(l => l.includes(`${k + 1}. ${TITLES[k]}`)) ?? ''
    m.autoVerifiedAtClose.push(line.includes('tự động'))
    // Cổng Stop ngay sau các bước có subagent, trước lần báo hạn mức mềm (turn đã nhận báo mềm thì Stop không chặn, 0.7.5 A6).
    if (k === 5) m.stopBlockedAfterAgents = ((await $.classic.Stop({ stop_hook_active: false })) as { block?: string }).block?.includes('Checklist còn') === true
  }
  expect(mainCalls).toBe(MAIN_CALLS)
  m.agentRouterCalls = seen.agentRouted.length

  const pane = await $.ui.mount(PANE)
  const texts = (await pane.findAll({ type: 'Text' })).map(e => e.text)
  await pane.unmount()
  // Dòng tiến độ của từng bước lọc tin: tiêu đề "Việc N: BƯỚC k" rồi dòng đếm lô ngay sau.
  m.taskRows = FILTER_STEPS.map(k => {
    const at = texts.indexOf(`Việc ${k + 1}: ${TITLES[k]}`)
    const count = at < 0 ? undefined : texts.slice(at + 1, at + 6).find(t => /lô xong/.test(t))
    return at < 0 ? '' : `${texts[at]} | ${count ?? ''}`
  })
  return m
}

describe('0.7.5 mục 6: nghiệm thu phiên dài', () => {
  test('1.000 tool call luồng chính, 300 subagent, hai lần nén, một lần báo hạn mức mềm', OPTIONS, async ($, on) => {
    const m = await session($, on)
    // Cổng Stop và checkpoint còn hoạt động sau khi có subagent.
    expect(m.stopBlockedAfterAgents).toBe(true)
    expect(m.checkpointsAfterAgents).toBeGreaterThan(0)
    // Lệnh kiểm qua | tail được tính: mỗi bước vừa đóng được nâng verified ngay, đúng bước đó.
    expect(m.autoVerifiedAtClose).toEqual(TITLES.map(() => true))
    // Subagent mô tả "BƯỚC N" khớp đúng việc, và dòng tiến độ đếm đúng: mỗi bước lọc tin 100/100 lô xong.
    expect(m.taskRows).toEqual(FILTER_STEPS.map(k => `Việc ${k + 1}: ${TITLES[k]} | ${AGENTS_PER_STEP}/${AGENTS_PER_STEP} lô xong`))
    // Tổng ký tự mod chèn vào kết quả tool không quá 20.000 [mục tiêu của đặc tả].
    expect(m.injectedChars).toBeLessThanOrEqual(20_000)
    // Cảnh báo phạm vi không quá một lần mỗi script.
    for (const count of Object.values(m.scopeWarnings)) expect(count).toBeLessThanOrEqual(1)
    // Router chấm subagent: cùng kịch bản trên main 19b0349 là 300 lượt [Đo trực tiếp, VERIFICATION 0.7.5]; sau không quá một nửa.
    expect(m.agentRouterCalls).toBeLessThanOrEqual(150)
    expect(m.compactReminders).toBe(2)
    expect(m.softNotices).toBe(1)
  })
})
