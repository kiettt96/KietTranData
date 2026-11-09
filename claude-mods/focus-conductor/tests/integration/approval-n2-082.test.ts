// 0.8.2 N2: việc lớn (substantial hay hard, edit hay mixed) phải lập kế hoạch, được router rà và chờ người dùng duyệt trước khi sửa file.
// Chặn ở tool.call của luồng chính khi planning hay presented; rà ở classic.Stop tối đa planReviewRounds lượt; hỏi làm rõ một lần mỗi
// mục tiêu; duyệt bằng intent approve, /conductor approve (chỉ người gõ) hay ExitPlanMode khi người dùng bấm duyệt. Mục tiêu nhẹ, loại
// answer, planApproval off hay skipApproval: không chặn, không chèn gì.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Core } from '../../types'
import * as S from '../../hooks/lib/state'
import { parseRoute } from '../../hooks/lib/router'
import type { Policy } from '../../hooks/lib/router'
import { PANE, RUN, base, plan, submit } from '../support/engine'
import { attentionItems } from '../../hooks/ui/attention'
import type { Json } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const LOG = '/tmp/fc-approval-n2-082.jsonl'
const OPTIONS = { options: { enforceChecklist: true, decisionLog: LOG } }
const withOptions = (extra: Json) => ({ options: { enforceChecklist: true, decisionLog: LOG, ...extra } })
/** Lượt rà kế hoạch đi qua cùng hook model với router đọc prompt: phần request của nó bắt đầu bằng dòng này. */
const REVIEW_MARK = 'Requirements:'

const BIG = (over: Json = {}) => plan({ goal: 'Sửa luồng thanh toán', depth: 'substantial', volume: 'medium', kind: 'edit', requirements: ['Sửa hàm tính phí', 'Thêm test cho phí'], ...over })
const follow = (over: Json) => plan({ relation: 'continue', goal: '', ...over })
const CLEAN = { missing: [], extra: [], issues: [] }
const QUESTIONS = ['Giữ API cũ hay đổi chữ ký hàm (giữ, đổi)?', 'Phí làm tròn lên hay xuống (lên, xuống, ngân hàng)?']

function setup(on: On, prompts: Array<Json | null>, reviews: Array<Json | null> = []) {
  const counts = { prompt: 0, review: 0 }
  const seen = base(on, {
    router: request => {
      if (request.startsWith(REVIEW_MARK)) {
        const reply = reviews.length === 0 ? null : (reviews[Math.min(counts.review, reviews.length - 1)] ?? null)
        counts.review += 1
        return reply
      }
      const reply = prompts[Math.min(counts.prompt, prompts.length - 1)] ?? null
      counts.prompt += 1
      return reply
    },
  })
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Write' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Read' }, () => ({ result: 'nội dung' }))
  on('tool.call', { tool: /^Grep$/ }, () => ({ result: 'src/phi.ts' }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: 'xong' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: '' }))
  // Tầng dưới của session.start (như engine nạp lại mod): mod đăng ký tool plan và lệnh /conductor ở đó.
  on('tool.register', () => ({ value: { tool: 'mcp__focus-conductor__plan' } }) as never)
  on('command.register', () => ({ value: { command: 'conductor' } }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('classic.Stop', () => ({}))
  on('classic.PostToolUse', () => ({}))
  on('turn.complete', () => ({ text: '' }))
  const writes: string[] = []
  on('fs.write', (_$, e) => {
    writes.push(e.text)
    return { value: undefined }
  })
  const lines = () => (writes[writes.length - 1] ?? '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
  const approvals = () => lines().filter(l => l['kind'] === 'approval').map(l => String(l['status']))
  return { seen, counts, lines, approvals }
}

const edit = ($: Engine) => $.tool.call({ tool: 'Edit', file_path: 'src/phi.ts', old_string: 'a', new_string: 'b' } as never)
const stop = async ($: Engine) => String(((await $.classic.Stop({ stop_hook_active: false } as never)) as { block?: string }).block ?? '')
const turn = ($: Engine, id: string) => $.turn.start({ text: 'việc', turnId: id })
const setPlan = ($: Engine) => $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa hàm tính phí', check: 'test phí đạt' }, { title: 'Thêm test cho phí', check: 'test mới chạy' }] })
const lastContext = (contexts: string[][]) => (contexts.at(-1) ?? []).join('\n')
const exitPlanMode = ($: Engine, mode?: string) =>
  $.classic.PostToolUse({ tool_name: 'ExitPlanMode', tool_input: {}, tool_response: {}, tool_use_id: 'tu-plan', ...(mode !== undefined ? { permission_mode: mode } : {}) } as never)
const run = ($: Engine, args: string, origin: Json = { kind: 'composer' }) => $.command.run({ command: 'conductor', args, origin, presentation: RUN.presentation } as never)

/** Mục tiêu lớn đã lập checklist ở turn t1 và đã trình (lượt rà đạt). */
async function presented($: Engine) {
  await submit($, 'Sửa luồng thanh toán')
  await turn($, 't1')
  await setPlan($)
  expect(await stop($)).toBe('')
}

describe('0.8.2 N2: chặn sửa file khi kế hoạch chưa duyệt', () => {
  test('mục tiêu substantial, edit: Edit bị từ chối khi planning; ghi .claude/plans/a.md, Read, Grep qua; context dặn lập kế hoạch', OPTIONS, async ($, on) => {
    const { seen } = setup(on, [BIG()])
    await submit($, 'Sửa luồng thanh toán')
    expect(lastContext(seen.contexts)).toContain('chờ duyệt trước khi sửa file')
    const block = (seen.contexts.at(-1) ?? []).find(c => c.includes('chờ duyệt trước khi sửa file')) ?? ''
    expect(block.length).toBeLessThanOrEqual(600)
    const denied = await edit($)
    expect(denied.deny).toContain('chưa được duyệt')
    expect((denied.deny ?? '').length).toBeLessThanOrEqual(200)
    expect((await $.tool.call({ tool: 'Write', file_path: '/srv/du-an/.claude/plans/a.md', content: 'kế hoạch' } as never)).deny).toBeUndefined()
    expect((await $.tool.call({ tool: 'Write', file_path: '.claude/plans/a.md', content: 'kế hoạch' } as never)).deny).toBeUndefined()
    expect((await $.tool.call({ tool: 'Read', file_path: 'src/phi.ts' } as never)).deny).toBeUndefined()
    expect((await $.tool.call({ tool: 'Grep', pattern: 'phi' } as never)).deny).toBeUndefined()
    expect((await $.tool.call({ tool: 'Bash', command: 'echo x > src/phi.ts' } as never)).deny).toContain('chưa được duyệt')
    expect((await $.tool.call({ tool: 'Bash', command: 'cat src/phi.ts' } as never)).deny).toBeUndefined()
    expect((await $.tool.call({ tool: PLAN, action: 'show' })).deny).toBeUndefined()
  })

  test('subagent Explore được giao khi planning; general-purpose hay Agent không ghi subagent_type bị từ chối', OPTIONS, async ($, on) => {
    setup(on, [BIG()])
    await submit($, 'Sửa luồng thanh toán')
    expect((await $.tool.call({ tool: 'Agent', tool_use_id: 'tu1', description: 'Tìm chỗ gọi phí', prompt: 'Tìm chỗ gọi phí', subagent_type: 'Explore' } as never)).deny).toBeUndefined()
    expect((await $.tool.call({ tool: 'Agent', tool_use_id: 'tu2', description: 'Sửa phí', prompt: 'Sửa phí', subagent_type: 'general-purpose' } as never)).deny).toContain('Explore')
    expect((await $.tool.call({ tool: 'Agent', tool_use_id: 'tu3', description: 'Sửa phí', prompt: 'Sửa phí' } as never)).deny).toContain('Explore')
  })

  test('subagent sửa file khi planning: không bị chặn (chỉ luồng chính)', OPTIONS, async ($, on) => {
    setup(on, [BIG()])
    await submit($, 'Sửa luồng thanh toán')
    expect((await $.tool.call({ tool: 'Edit', file_path: 'src/phi.ts', old_string: 'a', new_string: 'b', agentId: 'a-1' } as never)).deny).toBeUndefined()
  })
})

describe('0.8.2 N2: không thuộc diện duyệt thì như trước', () => {
  const cases: Array<[string, Json, Json]> = [
    ['mục tiêu light', BIG({ depth: 'light' }), {}],
    ['kind answer', BIG({ kind: 'answer' }), {}],
    ['planApproval off', BIG(), { planApproval: 'off' }],
    ['skipApproval true', BIG({ skipApproval: true }), {}],
  ]
  for (const [name, route, extra] of cases) {
    test(`${name}: không chặn, không chèn đoạn dặn`, withOptions(extra), async ($, on) => {
      const { seen } = setup(on, [route])
      await submit($, 'Sửa luồng thanh toán')
      expect(lastContext(seen.contexts)).not.toContain('chờ duyệt')
      expect((await edit($)).deny).toBeUndefined()
      expect((await $.tool.call({ tool: 'Agent', tool_use_id: 'tu1', description: 'Sửa phí', prompt: 'Sửa phí', subagent_type: 'general-purpose' } as never)).deny).toBeUndefined()
    })
  }
})

describe('0.8.2 N2: hỏi làm rõ một lần', () => {
  test('router trả hai câu hỏi: dặn hỏi bằng AskUserQuestion, Stop không chặn (cả G1); câu trả lời bị xếp new 0,5 thì giữ mục tiêu; không hỏi lần hai', OPTIONS, async ($, on) => {
    const { seen, lines } = setup(on, [BIG({ questions: QUESTIONS }), plan({ goal: 'Giữ API cũ, làm tròn lên', confidence: 0.5, depth: 'substantial', kind: 'edit', questions: QUESTIONS })])
    await submit($, 'Sửa luồng thanh toán')
    const asked = lastContext(seen.contexts)
    expect(asked).toContain('AskUserQuestion')
    expect(asked).toContain(QUESTIONS[0])
    expect(asked).not.toContain('Lập checklist bằng tool plan')
    await turn($, 't1')
    // Turn thực thi (plan set rỗng là cập nhật checklist) mà checklist trống: G1 vẫn không chặn trong turn hỏi.
    await $.tool.call({ tool: PLAN, action: 'set', steps: [] })
    expect(await stop($)).toBe('')
    await submit($, 'giữ, lên')
    const answered = lastContext(seen.contexts)
    expect(lines().some(l => l['kind'] === 'answer-held')).toBe(true)
    expect(answered).not.toContain('AskUserQuestion')
    expect(answered).toContain('Lập checklist bằng tool plan')
    // Mục tiêu giữ nguyên: vẫn chặn sửa file.
    expect((await edit($)).deny).toContain('chưa được duyệt')
    const route = lines().filter(l => l['kind'] === 'route').at(-1)
    expect(route?.['intent']).toBe('amend')
  })

  test('câu trả lời: router chắc chắn mục tiêu mới và prompt không nhắc mục tiêu thì lập mục tiêu mới', OPTIONS, async ($, on) => {
    const { seen } = setup(on, [BIG({ questions: QUESTIONS }), plan({ goal: 'Viết trang giới thiệu', confidence: 0.95, depth: 'light', kind: 'edit' })])
    await submit($, 'Sửa luồng thanh toán')
    await submit($, 'viết trang giới thiệu công ty')
    expect(lastContext(seen.contexts)).toContain('Viết trang giới thiệu')
    expect((await edit($)).deny).toBeUndefined()
  })

  test('router nhận dòng awaiting answer ở tin kế tiếp', OPTIONS, async ($, on) => {
    const { seen } = setup(on, [BIG({ questions: QUESTIONS }), follow({ intent: 'amend' })])
    await submit($, 'Sửa luồng thanh toán')
    await submit($, 'giữ, lên')
    expect(seen.routed.at(-1)).toContain('awaits the answers')
  })
})

describe('0.8.2 N2: rà kế hoạch ở Stop', () => {
  test('router rà trả missing [2]: chặn, lượt 1; lượt hai rỗng: cho kết thúc, presented', OPTIONS, async ($, on) => {
    const { approvals, counts, seen } = setup(on, [BIG()], [{ missing: [2], extra: [], issues: [] }, CLEAN])
    await submit($, 'Sửa luồng thanh toán')
    await turn($, 't1')
    await setPlan($)
    const first = await stop($)
    expect(first).toContain('lượt 1/2')
    expect(first).toContain('Thêm test cho phí')
    expect(first.length).toBeLessThanOrEqual(1000)
    expect(await stop($)).toBe('')
    expect(counts.review).toBe(2)
    expect(approvals().at(-1)).toBe('presented')
    expect(seen.statuses.at(-1)).toContain('chờ duyệt kế hoạch')
    // Đã trình: vẫn chặn sửa file tới khi duyệt.
    expect((await edit($)).deny).toContain('chưa được duyệt')
  })

  test('planReviewRounds 2, cả hai lượt còn chỗ sửa: chặn hai lần, lần hai dặn ghi chỗ còn sót; Stop kế tiếp cho kết thúc, không gọi router lần ba', OPTIONS, async ($, on) => {
    const { approvals, counts } = setup(on, [BIG()], [{ missing: [], extra: [1], issues: ['Bước 1 thiếu check dùng được'] }])
    await presentedBlocked($)
    const first = await stop($)
    expect(first).toContain('lượt 1/2')
    expect(first).not.toContain('lượt rà cuối')
    const second = await stop($)
    expect(second).toContain('lượt 2/2')
    expect(second).toContain('lượt rà cuối')
    expect(second).toContain('còn sót')
    expect(await stop($)).toBe('')
    expect(counts.review).toBe(2)
    expect(approvals().at(-1)).toBe('presented')
  })

  test('planReviewRounds 1: một lượt rà, còn chỗ sửa thì chặn một lần rồi cho kết thúc', withOptions({ planReviewRounds: 1 }), async ($, on) => {
    const { counts, approvals } = setup(on, [BIG()], [{ missing: [1], extra: [], issues: [] }])
    await presentedBlocked($)
    expect(await stop($)).toContain('lượt rà cuối')
    expect(await stop($)).toBe('')
    expect(counts.review).toBe(1)
    expect(approvals().at(-1)).toBe('presented')
  })

  test('router rà lỗi API: cho kết thúc, presented, có cảnh báo', OPTIONS, async ($, on) => {
    const { approvals, lines } = setup(on, [BIG()], [null])
    await presentedBlocked($)
    expect(await stop($)).toBe('')
    expect(approvals().at(-1)).toBe('presented')
    expect(lines().some(l => l['kind'] === 'plan-review' && l['missing'] === null)).toBe(true)
    const pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: /không rà được kế hoạch/ })).toBeDefined()
    await pane.unmount()
    expect(await stop($)).toBe('')
  })

  test('checklist trống ở Stop: G1 chặn như cũ, không gọi router rà', OPTIONS, async ($, on) => {
    const { counts } = setup(on, [BIG()], [CLEAN])
    await submit($, 'Sửa luồng thanh toán')
    await turn($, 't1')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [] })
    expect(await stop($)).not.toBe('')
    expect(counts.review).toBe(0)
  })
})

/** Mục tiêu lớn, checklist đã lập ở turn t1, chưa Stop lần nào. */
async function presentedBlocked($: Engine) {
  await submit($, 'Sửa luồng thanh toán')
  await turn($, 't1')
  await setPlan($)
}

describe('0.8.2 N2: sau khi trình', () => {
  test('intent approve: mở chặn, context một dòng kế hoạch đã duyệt; router nhận dòng awaiting approval', OPTIONS, async ($, on) => {
    const { seen, approvals } = setup(on, [BIG(), follow({ intent: 'approve' })], [CLEAN])
    await presented($)
    await submit($, 'ok duyệt')
    expect(seen.routed.filter(r => !r.includes(REVIEW_MARK)).at(-1)).toContain('awaits the user')
    expect(lastContext(seen.contexts)).toContain('Kế hoạch đã duyệt')
    expect((await edit($)).deny).toBeUndefined()
    expect(approvals().at(-1)).toBe('approved')
  })

  test('intent amend: về planning, vẫn chặn, dặn sửa kế hoạch; lượt rà tính lại từ 1', OPTIONS, async ($, on) => {
    const { seen, approvals } = setup(on, [BIG(), follow({ intent: 'amend' })], [CLEAN, { missing: [1], extra: [], issues: [] }])
    await presented($)
    await submit($, 'thêm cả phần hoàn tiền')
    expect(approvals().at(-1)).toBe('planning')
    expect(lastContext(seen.contexts)).toContain('Lập checklist bằng tool plan')
    expect((await edit($)).deny).toContain('chưa được duyệt')
    await turn($, 't2')
    await setPlan($)
    expect(await stop($)).toContain('lượt 1/2')
  })

  test('intent status: giữ presented, vẫn chặn', OPTIONS, async ($, on) => {
    setup(on, [BIG(), follow({ intent: 'status' })], [CLEAN])
    await presented($)
    await submit($, 'tới đâu rồi')
    expect((await edit($)).deny).toContain('chưa được duyệt')
  })

  test('/conductor approve gõ từ composer: mở chặn; gọi từ plugin: từ chối kèm giải thích', OPTIONS, async ($, on) => {
    setup(on, [BIG()], [CLEAN])
    await presented($)
    const refused = String((await run($, 'approve', { kind: 'plugin', name: 'khác' })).text)
    expect(refused).toContain('Chỉ nhận /conductor approve do người gõ')
    expect((await edit($)).deny).toContain('chưa được duyệt')
    expect(String((await run($, 'approve')).text)).toContain('Đã duyệt')
    expect((await edit($)).deny).toBeUndefined()
  })

  test('hot reload giữa presented: trạng thái giữ nguyên (session.start và vòng JSON của Core)', OPTIONS, async ($, on) => {
    setup(on, [BIG()], [CLEAN])
    await presented($)
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: true } as never)
    expect((await edit($)).deny).toContain('chưa được duyệt')
    const core = S.withApproval({ goalId: 4, status: 'presented', rounds: 2, asked: true })(S.EMPTY_CORE)
    const reloaded = S.normalizeCore(JSON.parse(JSON.stringify(core)) as Partial<Core>)
    expect(reloaded.approval).toEqual({ goalId: 4, status: 'presented', rounds: 2, asked: true })
    expect(S.normalizeCore({} as Partial<Core>).approval).toEqual({ goalId: -1, status: 'none', rounds: 0, asked: false })
  })

  test('mục tiêu đã approved, tin amend: không chặn lại', OPTIONS, async ($, on) => {
    setup(on, [BIG(), follow({ intent: 'approve' }), follow({ intent: 'amend' })], [CLEAN])
    await presented($)
    await submit($, 'ok duyệt')
    await submit($, 'thêm cả phần hoàn tiền')
    expect((await edit($)).deny).toBeUndefined()
  })

  test('ExitPlanMode với permission_mode default: mở chặn', OPTIONS, async ($, on) => {
    setup(on, [BIG()], [CLEAN])
    await presented($)
    await exitPlanMode($, 'default')
    expect((await edit($)).deny).toBeUndefined()
  })

  for (const mode of ['auto', 'bypassPermissions', undefined]) {
    test(`ExitPlanMode với permission_mode ${mode ?? 'vắng'}: không mở chặn`, OPTIONS, async ($, on) => {
      setup(on, [BIG()], [CLEAN])
      await presented($)
      await exitPlanMode($, mode)
      expect((await edit($)).deny).toContain('chưa được duyệt')
    })
  }

  test('band: mục cần chú ý "Chờ duyệt kế hoạch" khi presented, ngay sau tạm dừng', () => {
    const brief = { goalId: 2, at: 0, tasks: [], isReference: false } as never
    const items = attentionItems({ ...S.EMPTY_CORE, brief, approval: { goalId: 2, status: 'presented', rounds: 1, asked: false } } as Core, 'vi', { paused: true, notice: null })
    expect(items.map(i => i.kind).slice(0, 2)).toEqual(['pause', 'approval'])
    expect(items[1]?.text).toBe('Chờ duyệt kế hoạch')
    expect(attentionItems({ ...S.EMPTY_CORE, brief, approval: { goalId: 2, status: 'presented', rounds: 1, asked: false } } as Core, 'en')[0]?.text).toBe('Plan awaiting approval')
  })
})

describe('0.8.2 N2: parseRoute', () => {
  const OPEN: Policy = { allowFable: false, blocked: new Set(), session: null }
  test('questions kẹp 3 câu, 200 ký tự; skipApproval chỉ khi true', () => {
    const parsed = parseRoute(JSON.stringify(plan({ questions: ['a'.repeat(300), 'b', 'c', 'd'], skipApproval: 'yes' })), OPEN)
    expect(parsed?.questions?.length).toBe(3)
    expect(parsed?.questions?.[0]?.length).toBe(200)
    expect(parsed?.skipApproval).toBeUndefined()
    expect(parseRoute(JSON.stringify(plan({ skipApproval: true })), OPEN)?.skipApproval).toBe(true)
  })
})
