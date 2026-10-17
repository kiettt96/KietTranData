// 0.6.1 mục 4: tám chỗ thiếu test từ 0.5.6, mỗi chỗ có đột biến 061-Q riêng (scripts/mutants.ts).

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { PlanStep } from '../../types'
import { isMutation, newEvidenceLog, noteEvidence, suggestCheckCommands } from '../../hooks/lib/drift'
import { nextLine, renderBulk } from '../../hooks/lib/text'
import { bash, edit } from '../support/commands'
import { COMPLEX_PROMPT, base, conductor, submit } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const heredoc = (head: string, body: string) => `${head} <<'EOF'\n${body}\nEOF`
const mutates = (command: string) => isMutation(bash(command))

/** Mục tiêu có bước 1 xong, bước 2 đang chờ (và tùy chọn bước 3 còn mở). */
async function goalWithWaiting($: Engine, withOpen: boolean) {
  await submit($, COMPLEX_PROMPT)
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Chạy migration' }, { title: 'Đối soát số dòng' }, ...(withOpen ? [{ title: 'Viết báo cáo' }] : [])] })
  await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
  await $.tool.call({ tool: PLAN, action: 'update', step: 2, status: 'waiting', note: 'chờ job nền xong' })
}

describe('0.6.1 mục 4: thay mục tiêu khi checklist cũ còn bước đang chờ', () => {
  test('/conductor goal: bước waiting được tính là bước cần lưu và được báo cho Claude (061-Q1)', {}, async ($, on) => {
    base(on)
    await goalWithWaiting($, false)
    const out = await conductor($, 'goal Viết hàm parseDate cho ngày ISO, có unit test')
    expect((out.context ?? []).join('\n')).toContain('Checklist cũ còn 1 bước đang chờ đã được lưu')
  })

  test('prompt mục tiêu mới: toast nêu đúng số bước mở và số bước đang chờ (061-Q2)', {}, async ($, on) => {
    const seen = base(on)
    await goalWithWaiting($, true)
    await submit($, 'Viết hàm slugify(text) bằng TypeScript, có unit test.')
    expect(seen.toasts.some(t => t.includes('checklist cũ còn 1 bước mở và 1 bước đang chờ đã được lưu'))).toBe(true)
  })
})

describe('0.6.1 mục 4: dòng cuối của kết quả plan', () => {
  const step = (id: number, title: string, status: PlanStep['status']): PlanStep => ({ id, title, status })

  test('hết bước mở: dòng Đang chờ chỉ liệt kê bước waiting, không có bước blocked (061-Q3)', () => {
    const line = nextLine([step(1, 'Sửa', 'done'), step(2, 'Thiếu quyền deploy', 'blocked'), step(3, 'Chờ CI', 'waiting')])
    expect(line).toContain('Đang chờ: 3. Chờ CI')
    expect(line).not.toContain('Thiếu quyền deploy')
  })

  test('renderBulk không có ghi chú chung thì không in "Ghi chú:" (061-Q4)', () => {
    const plan = [step(1, 'a', 'skipped'), step(2, 'b', 'skipped'), step(3, 'c', 'todo')]
    expect(renderBulk(plan, [1, 2], 'skipped', '')).not.toContain('Ghi chú')
    expect(renderBulk(plan, [1, 2], 'skipped', 'ngoài phạm vi')).toContain('Ghi chú: ngoài phạm vi')
  })
})

describe('0.6.1 mục 4: lệnh nội dòng chỉ đọc', () => {
  test('ống |& vào python heredoc vẫn là ghi, như ống | (061-Q5)', () => {
    expect(mutates(heredoc('python3 -', 'print(1)'))).toBe(false)
    expect(mutates(`echo hi | ${heredoc('python3 -', 'print(1)')}`)).toBe(true)
    expect(mutates(`echo hi |& ${heredoc('python3 -', 'print(1)')}`)).toBe(true)
  })

  test('số toán tử heredoc không khớp số thân heredoc: không gán thân nào, lệnh là ghi (061-Q6)', () => {
    expect(mutates(`${heredoc('python3 -', 'print(1)')}\necho <<H`)).toBe(true)
  })

  test('cờ -tabs và -bail của sqlite3 là cờ chỉ đọc (061-Q7a, 061-Q7b)', () => {
    expect(mutates('sqlite3 -tabs data.db "SELECT id FROM items"')).toBe(false)
    expect(mutates('sqlite3 -bail data.db "SELECT id FROM items"')).toBe(false)
    expect(mutates('sqlite3 -init setup.sql data.db "SELECT 1"')).toBe(true)
  })
})

describe('0.6.1 mục 4: gợi ý checkCommands', () => {
  function logOf(...runs: string[]) {
    const log = newEvidenceLog(1)
    noteEvidence(log, edit())
    for (const run of runs) noteEvidence(log, bash(run))
    return log
  }

  test('lệnh script không có dấu / ở đầu (tra PATH) không được gợi ý; có ./ thì được (061-Q8)', () => {
    expect(suggestCheckCommands(logOf('check_totals.sh --final'))).toEqual([])
    expect(suggestCheckCommands(logOf('./check_totals.sh --final'))).toEqual(['./check_totals.sh'])
  })
})
