// (khung chép từ approval-n2-082) 0.8.2 N2: việc lớn (substantial hay hard, edit hay mixed) phải lập kế hoạch, được router rà và chờ người dùng duyệt trước khi sửa file.
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


// 0.9.0 B12 (tích hợp, nối tiếp approval-n2-082, approval-r-083, approval-k3-085): duyệt một lần.
// a. Tin có ý duyệt đến khi mục tiêu đang presented, hoặc đang planning mà checklist đã lưu: tính là duyệt, kể cả gửi giữa lượt. Đang
//    planning mà chưa qua lượt rà: ghi "đã duyệt trước"; lượt rà kế tiếp không còn chỗ sửa thì tự chuyển approved, còn chỗ sửa thì trình lại.
// b. Đã approved thì giữ qua điểm dừng, chạy tiếp, nén ngữ cảnh và các đợt việc sau của cùng mục tiêu.
// c. Tin duyệt kèm chỉnh nhỏ: duyệt và áp chỉnh trong cùng lượt.
// d. Request rà kế hoạch gửi danh sách yêu cầu sau khi đã gộp mọi tin bổ sung.
const APPROVE = follow({ intent: 'approve' })
const FIX = { missing: ['Thêm test cho phí'], extra: [], issues: [] }

describe('0.9.0 B12 a: duyệt khi đang lập kế hoạch', () => {
  test('planning, checklist đã lưu, chưa rà: "ok duyệt" ghi đã duyệt trước; lượt rà sạch thì tự approved, Edit qua', OPTIONS, async ($, on) => {
    const { approvals } = setup(on, [BIG(), APPROVE], [CLEAN])
    await submit($, 'Sửa luồng thanh toán')
    await turn($, 't1')
    await setPlan($)
    await submit($, 'ok duyệt')
    expect((await edit($)).deny ?? '').toContain('chưa được duyệt')
    expect(await stop($)).toBe('')
    expect(approvals()).toContain('approved')
    expect(approvals()).not.toContain('presented')
    expect((await edit($)).deny).toBeUndefined()
  })
  test('đã duyệt trước mà lượt rà còn chỗ sửa: chặn một lần, rồi trình lại (presented), chưa approved', OPTIONS, async ($, on) => {
    const { approvals } = setup(on, [BIG(), APPROVE], [FIX, CLEAN])
    await submit($, 'Sửa luồng thanh toán')
    await turn($, 't1')
    await setPlan($)
    await submit($, 'ok duyệt')
    expect(await stop($)).not.toBe('')
    expect(await stop($)).toBe('')
    expect(approvals().at(-1)).toBe('presented')
    expect((await edit($)).deny ?? '').toContain('chưa được duyệt')
  })
  test('planning đã qua lượt rà (còn chỗ sửa) rồi "ok duyệt": approved ngay', OPTIONS, async ($, on) => {
    const { approvals } = setup(on, [BIG(), APPROVE], [FIX])
    await submit($, 'Sửa luồng thanh toán')
    await turn($, 't1')
    await setPlan($)
    expect(await stop($)).not.toBe('')
    await submit($, 'ok duyệt')
    expect(approvals().at(-1)).toBe('approved')
    expect((await edit($)).deny).toBeUndefined()
  })
  test('presented, tin duyệt gửi giữa lượt (prompt.submit có turnId): approved', OPTIONS, async ($, on) => {
    const { approvals } = setup(on, [BIG(), APPROVE], [CLEAN])
    await presented($)
    await turn($, 't2')
    await $.prompt.submit({ text: 'ok duyệt', wait: false, origin: { kind: 'composer' } as never, turnId: 't2' })
    expect(approvals().at(-1)).toBe('approved')
  })
  test('planning chưa có checklist: "ok duyệt" không tính là duyệt', OPTIONS, async ($, on) => {
    const { approvals } = setup(on, [BIG(), APPROVE], [CLEAN])
    await submit($, 'Sửa luồng thanh toán')
    await submit($, 'ok duyệt')
    expect(approvals()).not.toContain('approved')
    expect((await edit($)).deny ?? '').toContain('chưa được duyệt')
  })
})

describe('0.9.0 B12 b: đã duyệt thì giữ', () => {
  test('approved giữ qua chạy tiếp, nén ngữ cảnh và đợt việc sau (plan set mới) của cùng mục tiêu', OPTIONS, async ($, on) => {
    const { approvals } = setup(on, [BIG(), APPROVE, follow({ intent: 'resume' }), follow({ intent: 'task', tasks: [] })], [CLEAN])
    await presented($)
    await submit($, 'ok duyệt')
    await submit($, 'chạy tiếp')
    await $.session.compact({ trigger: 'auto' } as never).catch(() => undefined)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Đợt 2: dọn mã', check: 'test đạt' }] })
    await submit($, 'làm đợt 2')
    expect(approvals().at(-1)).toBe('approved')
    expect((await edit($)).deny).toBeUndefined()
  })
})

describe('0.9.0 B12 c: duyệt kèm chỉnh nhỏ', () => {
  test('tin duyệt kèm một yêu cầu nhỏ: approved trong cùng lượt và yêu cầu mới vào mục tiêu', OPTIONS, async ($, on) => {
    const { seen, approvals } = setup(on, [BIG(), follow({ intent: 'approve', requirements: ['Đổi tên bước 2 thành Viết test phí'] })], [CLEAN])
    await presented($)
    await submit($, 'ok duyệt, đổi tên bước 2 thành Viết test phí')
    expect(approvals().at(-1)).toBe('approved')
    expect(lastContext(seen.contexts)).toContain('Đổi tên bước 2 thành Viết test phí')
  })
})

describe('0.9.0 B12 d: request rà kế hoạch dùng yêu cầu đã gộp', () => {
  test('tin bổ sung thêm yêu cầu trước lượt rà: request rà có yêu cầu đó', OPTIONS, async ($, on) => {
    const { seen } = setup(on, [BIG(), follow({ intent: 'amend', requirements: ['Ghi nhật ký phí'], tasks: [] })], [CLEAN])
    await submit($, 'Sửa luồng thanh toán')
    await submit($, 'thêm ghi nhật ký phí')
    await turn($, 't1')
    await setPlan($)
    await stop($)
    const review = seen.routed.find(r => r.startsWith(REVIEW_MARK)) ?? ''
    expect(review).toContain('Ghi nhật ký phí')
  })
})
