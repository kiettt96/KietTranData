// 0.9.0 B2 (tích hợp): ghi vào tệp trạng thái hay nơi ghi phụ router đọc từ prompt (B1) không sinh cảnh báo ngoài phạm vi, không vào mục
// lệch phạm vi của band, không tính vào file đã đổi của mục tiêu. Đường dẫn khác giữ nguyên hành vi. Dựng lại H3 cho Write và cp.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { base, plan, spawnTool, submit } from '../support/engine'
import { applyHome, isSidePath } from '../../hooks/lib/drift/scope'

const BAND = { plugin: 'focus-conductor', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isCollapsed: false, isWorking: true, maxRows: 6, bodyColumns: 160, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as const
const PLAN = 'mcp__focus-conductor__plan'
const WORK = '/work/run'
const GOAL = plan({
  goal: 'Sửa thống kê',
  depth: 'substantial',
  volume: 'small',
  scope: ['src/thong-ke.sh'],
  stateFiles: [`${WORK}/KE-HOACH.md`, `${WORK}/TIEN-DO.md`, `${WORK}/DIEM-DUNG.md`],
  sideWrites: ['/work/backup'],
})
type Out = { context?: string[] }
const ctx = (r: Out) => (r.context ?? []).join('\n')
async function bandTexts($: Engine) {
  const ui = await $.ui.mount(BAND)
  const texts = (await ui.findAll({ type: 'Text' })).map(e => e.text ?? '')
  await ui.unmount()
  return texts.join('\n')
}

describe('0.9.0 B2: tệp trạng thái và nơi ghi phụ không lệch phạm vi', () => {
  test('Write vào TIEN-DO.md và cp vào nơi sao lưu: không cảnh báo ngoài phạm vi, band không có mục lệch phạm vi', { options: { planApproval: 'off' } }, async ($, on) => {
    const seen = base(on, { router: () => GOAL, root: '/work/repo' })
    on('tool.call', { tool: 'Write' }, () => ({ result: 'đã ghi' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: '' }))
    await submit($, 'Sửa thống kê trong src/thong-ke.sh')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] } as never)
    const w = (await $.tool.call({ tool: 'Write', file_path: `${WORK}/TIEN-DO.md`, content: 'x' } as never)) as Out
    expect(ctx(w)).not.toContain('ngoài phạm vi')
    const c = (await $.tool.call({ tool: 'Bash', command: 'cp src/thong-ke.sh /work/backup/thong-ke.sh' } as never)) as Out
    expect(ctx(c)).not.toContain('ngoài phạm vi')
    expect(await bandTexts($)).not.toContain('ngoài phạm vi')
    expect(seen.toasts.some(t => t.includes('ngoài phạm vi'))).toBe(false)
  })

  test('file đã đổi của mục tiêu không gồm tệp trạng thái và nơi sao lưu', { options: { planApproval: 'off' } }, async ($, on) => {
    base(on, { router: () => GOAL, root: '/work/repo' })
    on('tool.call', { tool: 'Write' }, () => ({ result: 'đã ghi' }))
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: '' }))
    await submit($, 'Sửa thống kê trong src/thong-ke.sh')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] } as never)
    await $.tool.call({ tool: 'Edit', file_path: '/work/repo/src/thong-ke.sh', old_string: 'a', new_string: 'b' } as never)
    await $.tool.call({ tool: 'Write', file_path: `${WORK}/TIEN-DO.md`, content: 'x' } as never)
    await $.tool.call({ tool: 'Bash', command: 'cp src/thong-ke.sh /work/backup/thong-ke.sh' } as never)
    const out = (await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' } as never)) as Out & { result?: unknown }
    const text = [String(out.result ?? ''), ctx(out)].join('\n')
    expect(text).toContain('src/thong-ke.sh')
    expect(text).not.toContain('TIEN-DO.md')
    expect(text).not.toContain('/work/backup')
  })

  test('subagent ghi TIEN-DO.md: không cảnh báo ngoài phạm vi', { options: { planApproval: 'off', remindSubagents: true } }, async ($, on) => {
    base(on, { router: () => GOAL, root: '/work/repo' })
    on('tool.call', { tool: 'Write' }, () => ({ result: 'đã ghi' }))
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'đã giao' }))
    on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: `a-${e.tool_use_id}` }))
    await submit($, 'Sửa thống kê trong src/thong-ke.sh')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] } as never)
    await spawnTool($, 'u1', 'Ghi tiến độ', 'Ghi tiến độ vào tệp')
    const w = (await $.tool.call({ tool: 'Write', file_path: `${WORK}/TIEN-DO.md`, content: 'x', agentId: 'a-u1' } as never)) as Out
    expect(ctx(w)).not.toContain('ngoài phạm vi')
    const other = (await $.tool.call({ tool: 'Write', file_path: `${WORK}/KHAC.md`, content: 'x', agentId: 'a-u1' } as never)) as Out
    expect(ctx(other)).toContain('ngoài phạm vi')
  })

  test('đối chứng: Write vào đường dẫn khác ngoài phạm vi vẫn cảnh báo', { options: { planApproval: 'off' } }, async ($, on) => {
    base(on, { router: () => GOAL, root: '/work/repo' })
    on('tool.call', { tool: 'Write' }, () => ({ result: 'đã ghi' }))
    await submit($, 'Sửa thống kê trong src/thong-ke.sh')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] } as never)
    const w = (await $.tool.call({ tool: 'Write', file_path: `${WORK}/KHAC.md`, content: 'x' } as never)) as Out
    expect(ctx(w)).toContain('ngoài phạm vi')
  })
})

describe('0.9.0 B2: isSidePath', () => {
  const lists = { stateFiles: ['/work/run/TIEN-DO.md', 'DIEM-DUNG.md'], sideWrites: ['/work/backup', '~/sao-luu'] }
  test('bằng mục, nằm dưới thư mục, khớp tên tệp khi mục chỉ là tên', () => {
    expect(isSidePath('/work/run/TIEN-DO.md', lists)).toBe(true)
    expect(isSidePath('/work/backup/a/b.ts', lists)).toBe(true)
    expect(isSidePath('/x/DIEM-DUNG.md', lists)).toBe(true)
    expect(isSidePath('/work/backupx/a.ts', lists)).toBe(false)
    expect(isSidePath('/work/run/KHAC.md', lists)).toBe(false)
  })
  test('đường dẫn tương đối neo theo cwd rồi tới root', () => {
    expect(isSidePath('../run/TIEN-DO.md', lists, '/work/repo')).toBe(true)
    expect(isSidePath('TIEN-DO.md', { stateFiles: ['/work/run/TIEN-DO.md'] }, '/work/repo', '/work/run')).toBe(true)
    expect(isSidePath('GHI-CHU.md', { stateFiles: ['/work/run/GHI-CHU.md'] }, '/work/repo')).toBe(false)
  })
  test('mục ~/ khớp đường dẫn đã giải theo thư mục nhà', () => {
    applyHome('/home/me')
    try {
      expect(isSidePath('/home/me/sao-luu/x.md', lists)).toBe(true)
    } finally {
      applyHome(null)
    }
    expect(isSidePath('~/sao-luu/x.md', lists)).toBe(true)
  })
  test('which state chỉ xét tệp trạng thái; danh sách rỗng là không khớp', () => {
    expect(isSidePath('/work/backup/a.md', lists, null, null, 'state')).toBe(false)
    expect(isSidePath('/work/run/TIEN-DO.md', lists, null, null, 'state')).toBe(true)
    expect(isSidePath('/a.md', {})).toBe(false)
    expect(isSidePath('/a.md', null)).toBe(false)
  })
})
