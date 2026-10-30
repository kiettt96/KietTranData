// 0.7.5 R1 (vòng rà soát 3): mục của prompt tiếp nối không bao giờ bị bỏ im lặng khi ràng buộc (trần 12) và yêu cầu (trần 30) đã
// đầy bằng mục của prompt lập mục tiêu. Mục đó vào phần tràn (tối đa thêm 10 mỗi danh sách): vẫn ở brief, trong request tiếp nối và
// trong covers của việc mới. Phần tràn cũng đầy thì mục bị bỏ kèm một cảnh báo nêu số mục, hiện ở /conductor status.

import { describe, expect, test } from 'claude-code/testing'
import { nextBrief, parseRoute, routerRequest } from '../../hooks/lib/router'
import type { Policy, RouterPlan } from '../../hooks/lib/router'
import { LONG_CODED_PROMPT } from '../fixtures/prompt-long-coded'
import { makeBrief } from '../support/commands'
import { PANE, base, conductor, plan, submit, task } from '../support/engine'

const OPEN: Policy = { allowFable: false, blocked: new Set(), session: null }
const routed = (over: Record<string, unknown>): RouterPlan => parseRoute(JSON.stringify(plan(over)), OPEN)!
const REQUIREMENTS = Array.from({ length: 30 }, (_, i) => `Yêu cầu gốc ${i + 1}`)
const CONSTRAINTS = ['Việc lọc tin chạy sonnet', ...Array.from({ length: 11 }, (_, i) => `Ràng buộc gốc ${i + 1}`)]
const EXCEL = 'BẮT BUỘC xuất file Excel'
/** Prompt khoảng 32.000 ký tự: prompt có mã 11 bước cộng phần mô tả thêm. */
const PROMPT_32K = `${LONG_CODED_PROMPT}\n\n${'Ghi chú vận hành bổ sung cho từng bước, giữ nguyên dữ liệu gốc. '.repeat(40)}`.slice(0, 32_000)
const FIRST = plan({
  goal: 'Cập nhật sổ giá theo 11 bước',
  depth: 'hard',
  volume: 'large',
  requirements: REQUIREMENTS,
  constraints: CONSTRAINTS,
  // Mọi yêu cầu đều có việc phủ, để router không bị hỏi lại phần phủ yêu cầu ở prompt đầu.
  tasks: Array.from({ length: 11 }, (_, k) => task(`BƯỚC ${k}: phần ${k}`, 'main', 'opus', 'high', { covers: REQUIREMENTS.map((_, r) => r + 1).filter(r => (r - 1) % 11 === k) })),
})
// Ràng buộc khác chữ với yêu cầu, để request kế tiếp chỉ có chữ của yêu cầu khi yêu cầu được giữ (router trả tối đa 6 ràng buộc mỗi lượt
// nên ràng buộc mới còn chỗ; yêu cầu thì 30 mục của prompt đầu đã đầy).
const REFINE = plan({ relation: 'refine', goal: '', requirements: [EXCEL], constraints: ['Chỉ xuất định dạng .xlsx'], tasks: [task('Xuất file Excel', 'main', 'sonnet', 'medium', { covers: [1] })] })

describe('0.7.5 R1: mục của prompt tiếp nối khi đã đầy bằng mục của prompt đầu', () => {
  test('nextBrief: yêu cầu và ràng buộc tinh chỉnh vào phần tràn; việc mới phủ đúng yêu cầu đó', () => {
    const prev = makeBrief({ requirements: REQUIREMENTS, requirementsBase: 30, constraints: CONSTRAINTS, constraintsBase: 12 })
    const out = nextBrief(prev, routed({ relation: 'refine', goal: '', requirements: [EXCEL], constraints: [EXCEL], tasks: [{ title: 'Xuất file Excel', run: 'main', model: 'sonnet', effort: 'medium', kind: 'edit', covers: [1] }] }), EXCEL, 2)
    expect(out.brief.requirements).toContain(EXCEL)
    expect(out.brief.constraints).toContain(EXCEL)
    const at = (out.brief.requirements ?? []).indexOf(EXCEL) + 1
    expect(out.brief.tasks.find(t => t.title === 'Xuất file Excel')?.covers).toEqual([at])
    expect(out.brief.requirements?.slice(0, 30)).toEqual(REQUIREMENTS)
  })

  test('request tiếp nối kế tiếp nêu các mục ở phần tràn', () => {
    const prev = makeBrief({ requirements: [...REQUIREMENTS, EXCEL], requirementsBase: 30, constraints: [...CONSTRAINTS, EXCEL], constraintsBase: 12 })
    const request = routerRequest({ text: 'tiếp', prev, ran: 'opus/high', policy: OPEN, model: 'claude-haiku-5-5' })
    expect(request.prompt).toContain(EXCEL)
  })

  test('phần tràn đầy (10 mục) thì mục mới bị bỏ kèm số mục bị bỏ', () => {
    const full = [...REQUIREMENTS, ...Array.from({ length: 10 }, (_, i) => `Tràn ${i + 1}`)]
    const prev = makeBrief({ requirements: full, requirementsBase: 40 })
    const out = nextBrief(prev, routed({ relation: 'refine', goal: '', requirements: [EXCEL] }), EXCEL, 2) as ReturnType<typeof nextBrief> & { dropped?: number }
    expect(out.brief.requirements).toEqual(full)
    expect(out.dropped).toBe(1)
  })
})

describe('0.7.5 R1: phần tràn qua nhiều lượt tiếp nối', () => {
  test('mục đã ở phần tràn còn nguyên ở lượt tiếp nối sau, mục mới cũng vào phần tràn', () => {
    // Mục tràn là quy định model nên không bị thay (M3); mục mới không có chỗ thay nên vào phần tràn.
    const prev = makeBrief({ constraints: [...CONSTRAINTS, 'Việc kiểm số liệu chạy opus'], constraintsBase: 12 })
    const out = nextBrief(prev, routed({ relation: 'continue', goal: '', constraints: ['Tràn 2'] }), 'tiếp', 2)
    expect(out.brief.constraints).toEqual([...CONSTRAINTS, 'Việc kiểm số liệu chạy opus', 'Tràn 2'])
  })

  test('mục tiếp nối ở phần tràn không bị mục tiếp nối mới hơn thay (S1, vòng rà soát 4): cả hai còn', () => {
    const prev = makeBrief({ constraints: [...CONSTRAINTS, 'Tràn 1'], constraintsBase: 12 })
    const out = nextBrief(prev, routed({ relation: 'continue', goal: '', constraints: ['Tràn 2'] }), 'tiếp', 2)
    expect(out.brief.constraints).toEqual([...CONSTRAINTS, 'Tràn 1', 'Tràn 2'])
    expect(out.replaced).toEqual([])
  })

  test('trần ràng buộc là 12: 11 mục rồi thêm một mục thì không thay mục nào', () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `Mục ${i + 1}`)
    const out = nextBrief(makeBrief({ constraints: eleven, constraintsBase: 0 }), routed({ relation: 'continue', goal: '', constraints: ['Mục mới'] }), 'tiếp', 2)
    expect(out.brief.constraints).toEqual([...eleven, 'Mục mới'])
    expect(out.replaced).toEqual([])
  })
})

describe('0.7.5 R1: phiên với prompt 32.000 ký tự', () => {
  test('prompt đầy 30 yêu cầu (12 ràng buộc ở ca nextBrief trên), rồi "BẮT BUỘC xuất file Excel": có việc phủ, có trong request kế tiếp', {}, async ($, on) => {
    const seen = base(on, { router: request => (request.includes(EXCEL) && !request.includes('Bối cảnh chung') ? REFINE : FIRST) })
    expect(PROMPT_32K.length).toBe(32_000)
    await submit($, PROMPT_32K)
    await submit($, EXCEL)
    const context = (seen.contexts[1] ?? []).join('\n')
    expect(context).toContain('Xuất file Excel')
    expect(context).not.toContain(`Yêu cầu chưa có việc nào phủ (đừng bỏ sót khi lập checklist): ${EXCEL}`)
    await submit($, 'làm tiếp')
    expect(seen.routed[2] ?? '').toContain(EXCEL)
    expect(String((await conductor($, 'status')).text)).not.toContain('không giữ được')
  })

  test('cả phần tràn đầy: cảnh báo nêu số mục không giữ được, hiện ở /conductor status', {}, async ($, on) => {
    const many = plan({ relation: 'refine', goal: '', requirements: Array.from({ length: 12 }, (_, i) => `Tinh chỉnh ${i + 1}`) })
    base(on, { router: request => (request.includes('thêm 12 yêu cầu') ? many : FIRST) })
    await submit($, PROMPT_32K)
    await submit($, 'thêm 12 yêu cầu')
    const status = String((await conductor($, 'status')).text)
    expect(status).toContain('2 mục của prompt tiếp nối không giữ được')
    const pane = await $.ui.mount(PANE)
    const texts = (await pane.findAll({ type: 'Text' })).map(e => e.text)
    await pane.unmount()
    expect(texts.some(t => typeof t === 'string' && t.includes('2 mục của prompt tiếp nối không giữ được'))).toBe(true)
  })
})
