// 0.9.0 B3 (tích hợp): khi kế hoạch chưa duyệt, luồng chính ghi được vào tệp trạng thái router đọc từ prompt (B1), không gồm nơi ghi phụ;
// tệp ngoài danh sách vẫn bị từ chối; router không trả danh sách thì như 0.8.9. Câu dặn lập kế hoạch nêu đúng các nơi ghi được (thêm không
// quá 120 ký tự); trần PLANNING_CHARS nâng đúng bằng tổng hạn mức của B3, B6, B10 (120 + 120 + 160). Dựng lại H1 cho Write.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import * as A from '../../hooks/lib/approval'
import { base, plan, submit } from '../support/engine'
import type { Json } from '../support/engine'

const WORK = '/work/run'
const STATE = [`${WORK}/KE-HOACH.md`, `${WORK}/TIEN-DO.md`, `${WORK}/DIEM-DUNG.md`]
const BIG = (over: Json = {}) => plan({ goal: 'Sửa thống kê', depth: 'substantial', volume: 'medium', kind: 'edit', requirements: ['Sửa thống kê'], ...over })
const DENY = 'Kế hoạch chưa được duyệt'
type Out = { deny?: string }
const write = ($: Engine, path: string) => $.tool.call({ tool: 'Write', file_path: path, content: 'x' } as never) as Promise<Out>
const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never) as Promise<Out>

function setup(on: Parameters<typeof base>[0], reply: Json) {
  const seen = base(on, { router: request => (request.startsWith('Requirements:') ? { missing: [], extra: [], issues: [] } : reply), root: '/work/repo' })
  on('tool.call', { tool: 'Write' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: '' }))
  return seen
}

describe('0.9.0 B3: cổng duyệt kế hoạch cho ghi tệp trạng thái', () => {
  test('Write vào KE-HOACH.md, TIEN-DO.md và echo > DIEM-DUNG.md qua khi chưa duyệt; src/a.ts và nơi sao lưu vẫn bị từ chối', {}, async ($, on) => {
    setup(on, BIG({ stateFiles: STATE, sideWrites: ['/work/backup'] }))
    await submit($, 'Sửa thống kê')
    expect((await write($, `${WORK}/KE-HOACH.md`)).deny).toBeUndefined()
    expect((await write($, `${WORK}/TIEN-DO.md`)).deny).toBeUndefined()
    expect((await bash($, `echo x > ${WORK}/DIEM-DUNG.md`)).deny).toBeUndefined()
    expect((await write($, '/work/repo/src/a.ts')).deny ?? '').toContain(DENY)
    expect((await write($, `${WORK}/KHAC.md`)).deny ?? '').toContain(DENY)
    expect((await bash($, 'cp src/a.ts /work/backup/a.ts')).deny ?? '').toContain(DENY)
  })

  test('router không trả danh sách: như 0.8.9, Write vào tệp không phải tệp trạng thái (GHI-CHU.md) bị từ chối', {}, async ($, on) => {
    setup(on, BIG())
    await submit($, 'Sửa thống kê')
    expect((await write($, `${WORK}/GHI-CHU.md`)).deny ?? '').toContain(DENY)
  })

  test('câu dặn lập kế hoạch nêu các tệp trạng thái ghi được; thêm không quá 120 ký tự; không có danh sách thì như 0.8.9', {}, async ($, on) => {
    const seen = setup(on, BIG({ stateFiles: STATE }))
    await submit($, 'Sửa thống kê')
    const planning = (seen.contexts.at(-1) ?? []).find(c => c.includes('Việc lớn: lập kế hoạch')) ?? ''
    expect(planning).toContain('KE-HOACH.md')
    expect(planning).toContain('TIEN-DO.md')
    expect(planning).toContain('DIEM-DUNG.md')
    expect(planning.length - A.planningContext().length).toBeLessThanOrEqual(120)
    expect(planning.length).toBeLessThanOrEqual(A.PLANNING_CHARS)
  })

  test('câu nêu tệp trạng thái nhiều tệp tên dài vẫn không quá 120 ký tự', () => {
    const many = Array.from({ length: 8 }, (_, i) => `/w/tep-trang-thai-rat-dai-so-${i}.md`)
    const line = A.planningStateLine(many)
    expect(line.length).toBeLessThanOrEqual(120)
    expect(line).toContain('tep-trang-thai-rat-dai-so-0.md')
  })

  test('trần PLANNING_CHARS là 600 + 120 + 120 + 160', () => {
    expect(A.PLANNING_CHARS).toBe(1000)
  })
})
