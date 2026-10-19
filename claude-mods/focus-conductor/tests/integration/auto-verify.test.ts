// 0.7.0 điểm 5: "Đã kiểm chứng" do mod tự nâng. Mục tiêu đã có sửa file, một lệnh TEST (hành vi) chạy đạt sau thay đổi cuối thì mọi
// bước `done` thành `verified`; có thay đổi mới sau đó thì hạ về `done`; kiểm tĩnh không bao giờ tự nâng; mục tiêu chỉ tra cứu giữ
// luật cũ. `verified` do Claude ghi chỉ cần đã có lệnh test đạt sau thay đổi cuối, không còn đòi chép từng chữ lệnh.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { COMPLEX_PROMPT, base, spawnTool, submit } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const edit = ($: Engine, path = 'src/a.ts', agentId?: string) =>
  $.tool.call({ tool: 'Edit', file_path: path, old_string: 'a', new_string: 'b', ...(agentId ? { agentId } : {}) } as never)
const bash = ($: Engine, command: string, agentId?: string) => $.tool.call({ tool: 'Bash', command, ...(agentId ? { agentId } : {}) } as never)
const show = async ($: Engine) => String((await $.tool.call({ tool: PLAN, action: 'show' })).result)

/** Edit và Bash do "engine" trả lời: `npm test` đạt, `npm test -- --fail` lỗi, kiểm tĩnh đạt. */
function hooks(on: On) {
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Read' }, () => ({ result: 'nội dung' }))
  on('tool.call', { tool: 'Bash' }, (_$, e) => (String((e as { command?: string }).command).includes('--fail') ? { result: '2 fail', isError: true } : { result: '12 pass' }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
  on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: `a-${e.tool_use_id}` }))
  on('turn.complete', () => ({ text: '' }))
}

async function goal($: Engine, on: On) {
  base(on)
  hooks(on)
  await submit($, COMPLEX_PROMPT)
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }, { title: 'Kiểm' }] })
}

describe('0.7.0 5: tự nâng done thành verified', () => {
  test('lệnh test đạt sau thay đổi cuối: bước done thành verified, bước chưa đóng giữ nguyên', {}, async ($, on) => {
    await goal($, on)
    await edit($)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    expect(await show($)).toContain('[x] 1. Sửa')
    await bash($, 'npm test')
    const text = await show($)
    expect(text).toContain('[v] 1. Sửa')
    expect(text).toContain('[ ] 2. Kiểm')
  })

  test('đóng bước sau khi test đã đạt: lưu verified ngay, không cần evidence', {}, async ($, on) => {
    await goal($, on)
    await edit($)
    await bash($, 'npm test')
    const out = String((await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })).result)
    expect(out).toContain('[v] 1. Sửa')
  })

  test('đóng lần lượt hai bước sau khi test đã đạt: cả hai thành verified', {}, async ($, on) => {
    await goal($, on)
    await edit($)
    await bash($, 'npm test')
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await $.tool.call({ tool: PLAN, action: 'update', step: 2, status: 'done' })
    const text = await show($)
    expect(text).toContain('[v] 1. Sửa')
    expect(text).toContain('[v] 2. Kiểm')
  })

  test('Claude ghi verified với evidence không chép lệnh: được nhận khi đã có test đạt sau thay đổi cuối', {}, async ($, on) => {
    await goal($, on)
    await edit($)
    await bash($, 'npm test')
    const out = String((await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: 'đã chạy bộ kiểm thử, đạt' })).result)
    expect(out).toContain('[v] 1. Sửa')
    expect(out).not.toContain('chưa tính là đã kiểm tra')
  })

  test('đối chứng: verified khi chưa có test nào đạt sau thay đổi cuối vẫn bị hạ về done', {}, async ($, on) => {
    await goal($, on)
    await edit($)
    const out = String((await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: 'đã xem lại mã' })).result)
    expect(out).toContain('[x] 1. Sửa')
    expect(out).toContain('chưa tính là đã kiểm tra')
  })

  test('lệnh test chạy trước thay đổi cuối thì chưa đủ; chạy lại sau đó thì nâng', {}, async ($, on) => {
    await goal($, on)
    await edit($)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await bash($, 'npm test')
    await edit($, 'src/b.ts')
    expect(await show($)).toContain('[x] 1. Sửa')
    await bash($, 'npm test')
    expect(await show($)).toContain('[v] 1. Sửa')
  })
})

describe('0.7.0 5: hạ lại khi có thay đổi mới', () => {
  test('bước tự nâng thành verified, sửa thêm thì về done, test lại thì nâng lại', {}, async ($, on) => {
    await goal($, on)
    await edit($)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await bash($, 'npm test')
    expect(await show($)).toContain('[v] 1. Sửa')
    await edit($, 'src/c.ts')
    expect(await show($)).toContain('[x] 1. Sửa')
    await bash($, 'npm test')
    expect(await show($)).toContain('[v] 1. Sửa')
  })

  test('subagent sửa file trong mục tiêu cũng hạ bước tự nâng về done', {}, async ($, on) => {
    await goal($, on)
    await spawnTool($, 'u1', 'Sửa file phụ', 'Sửa src/x.ts')
    await edit($)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await bash($, 'npm test')
    expect(await show($)).toContain('[v] 1. Sửa')
    await edit($, 'src/x.ts', 'a-u1')
    expect(await show($)).toContain('[x] 1. Sửa')
  })

  test('bước verified do Claude ghi (evidence được nhận) không bị mod hạ khi sửa tiếp', {}, async ($, on) => {
    await goal($, on)
    await edit($)
    await bash($, 'npm test')
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: 'npm test: 12 pass' })
    await edit($, 'src/d.ts')
    expect(await show($)).toContain('[v] 1. Sửa')
  })

  test('Claude ghi lại verified cho bước đã được mod tự nâng: thành verified của Claude, sửa tiếp không hạ', {}, async ($, on) => {
    await goal($, on)
    await edit($)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await bash($, 'npm test')
    expect(await show($)).toContain('[v] 1. Sửa')
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: 'npm test: 12 pass' })
    await edit($, 'src/f.ts')
    expect(await show($)).toContain('[v] 1. Sửa')
  })

  test('bước tự nâng và bước verified của Claude cùng tồn tại: sửa tiếp chỉ hạ bước tự nâng', {}, async ($, on) => {
    await goal($, on)
    await edit($)
    await bash($, 'npm test')
    // Bước 1 do Claude ghi verified (có test đạt); bước 2 đóng bằng done và được mod tự nâng ngay.
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: 'npm test: 12 pass' })
    await $.tool.call({ tool: PLAN, action: 'update', step: 2, status: 'done' })
    const before = await show($)
    expect(before).toContain('[v] 1. Sửa')
    expect(before).toContain('[v] 2. Kiểm')
    await edit($, 'src/g.ts')
    const after = await show($)
    expect(after).toContain('[v] 1. Sửa')
    expect(after).toContain('[x] 2. Kiểm')
  })

  test('Claude đổi trạng thái bước tự nâng: dấu tự nâng bị bỏ, sửa tiếp không hạ bước đã đổi', {}, async ($, on) => {
    await goal($, on)
    await edit($)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await bash($, 'npm test')
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'doing' })
    expect(await show($)).toContain('[~] 1. Sửa')
    await edit($, 'src/e.ts')
    expect(await show($)).toContain('[~] 1. Sửa')
  })
})

describe('0.7.0 5: điều kiện để tự nâng', () => {
  test('kiểm tĩnh (type-check, validate) không bao giờ tự nâng', {}, async ($, on) => {
    await goal($, on)
    await edit($)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await bash($, 'tsc --noEmit')
    await bash($, 'claude plugin validate .')
    expect(await show($)).toContain('[x] 1. Sửa')
  })

  test('lệnh test lỗi không nâng', {}, async ($, on) => {
    await goal($, on)
    await edit($)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await bash($, 'npm test -- --fail')
    expect(await show($)).toContain('[x] 1. Sửa')
  })

  test('mục tiêu chưa có sửa file (chỉ tra cứu): test đạt không tự nâng', {}, async ($, on) => {
    await goal($, on)
    await $.tool.call({ tool: 'Read', file_path: 'src/a.ts' })
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await bash($, 'npm test')
    expect(await show($)).toContain('[x] 1. Sửa')
  })

  test('mục tiêu chưa có sửa file: verified kèm evidence nhắc file đã đọc vẫn được nhận như trước', {}, async ($, on) => {
    await goal($, on)
    await $.tool.call({ tool: 'Read', file_path: 'src/a.ts' })
    const out = String((await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: 'đã đọc src/a.ts, đúng' })).result)
    expect(out).toContain('[v] 1. Sửa')
  })

  test('bước đang làm hoặc chưa làm không bị nâng', {}, async ($, on) => {
    await goal($, on)
    await edit($)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'doing' })
    await bash($, 'npm test')
    const text = await show($)
    expect(text).toContain('[~] 1. Sửa')
    expect(text).toContain('[ ] 2. Kiểm')
  })

  test('mode off: không theo dõi, không tự nâng', { options: {} }, async ($, on) => {
    base(on)
    hooks(on)
    await submit($, COMPLEX_PROMPT)
    await $.command.run({ command: 'conductor', args: 'mode off', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as never)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] })
    await edit($)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await bash($, 'npm test')
    expect(await show($)).not.toContain('[v]')
  })
})
