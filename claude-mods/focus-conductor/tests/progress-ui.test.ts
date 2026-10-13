// Test thanh tiến độ đổi màu theo giai đoạn (hooks/ui/style.ts): ngưỡng giai đoạn, màu của từng giai đoạn, độ rộng
// thanh, đầu thanh và phần còn lại. Là hàm thuần nên không cần engine; phần vẽ lên band và pane nằm ở hooks.test.ts.

import { describe, expect, test } from 'claude-code/testing'

import type { PlanStep, StepStatus } from '../types'
import { labels } from '../hooks/ui/labels'
import { ALMOST_FROM, PHASE_HUE, START_BELOW, barRuns, phaseOf, plannedRuns } from '../hooks/ui/style'
import type { Phase } from '../hooks/ui/style'

/** Kế hoạch `total` bước: `closed` bước đầu đã đóng, bước kế tiếp mang trạng thái `next`, các bước sau còn chờ. */
function planOf(total: number, closed: number, next: StepStatus = 'doing', closedAs: StepStatus = 'done'): PlanStep[] {
  return Array.from({ length: total }, (_, i) => ({
    id: i + 1,
    title: `Bước ${i + 1}`,
    status: i < closed ? closedAs : i === closed ? next : 'todo',
  }))
}

const textOf = (runs: ReadonlyArray<{ text: string }>) => runs.map(r => r.text).join('')
const cellsOf = (runs: ReadonlyArray<{ text: string }>) => [...textOf(runs)].length

describe('giai đoạn theo tỷ lệ bước đã đóng', () => {
  test('kế hoạch 8 bước đi qua đủ bốn giai đoạn, ngưỡng 25% và 75% tính vào giai đoạn sau', () => {
    const phases = Array.from({ length: 9 }, (_, closed) => phaseOf(planOf(8, closed)))
    expect(phases).toEqual(['start', 'start', 'active', 'active', 'active', 'active', 'almost', 'almost', 'done'])
  })

  test('ngưỡng là 25% và 75%', () => {
    expect([START_BELOW, ALMOST_FROM]).toEqual([0.25, 0.75])
  })

  test('chưa bước nào bắt đầu thì chưa phải "mới bắt đầu", và kế hoạch rỗng cũng vậy', () => {
    expect(phaseOf(planOf(8, 0, 'todo'))).toBe('idle')
    expect(phaseOf([])).toBe('idle')
  })

  test('bước bị chặn cũng tính là đã bắt đầu', () => {
    expect(phaseOf(planOf(8, 0, 'blocked'))).toBe('start')
  })

  test('bước đã kiểm chứng và bước bỏ qua đều là bước đã đóng', () => {
    const plan = planOf(8, 6, 'doing', 'verified')
    plan[1]!.status = 'skipped'
    plan[2]!.status = 'done'
    expect(phaseOf(plan)).toBe('almost')
    expect(phaseOf(planOf(8, 8, 'done', 'skipped'))).toBe('done')
  })

  test('kế hoạch ngắn vẫn đi qua đủ giai đoạn: từ 3 bước, còn đúng một bước là sắp xong', () => {
    expect(Array.from({ length: 4 }, (_, closed) => phaseOf(planOf(3, closed)))).toEqual(['start', 'active', 'almost', 'done'])
    expect(Array.from({ length: 5 }, (_, closed) => phaseOf(planOf(4, closed)))).toEqual(['start', 'active', 'active', 'almost', 'done'])
  })

  test('kế hoạch 1 và 2 bước không có giai đoạn sắp xong riêng', () => {
    expect(Array.from({ length: 2 }, (_, closed) => phaseOf(planOf(1, closed)))).toEqual(['start', 'done'])
    expect(Array.from({ length: 3 }, (_, closed) => phaseOf(planOf(2, closed)))).toEqual(['start', 'active', 'done'])
  })

  test('kế hoạch dài không nhảy giai đoạn: 9 trên 18 bước vẫn đang thực hiện', () => {
    expect(phaseOf(planOf(18, 9))).toBe('active')
    expect(phaseOf(planOf(18, 17))).toBe('almost')
  })
})

describe('màu theo giai đoạn', () => {
  test('xanh dương mới bắt đầu, cam đang thực hiện, vàng sắp xong, xanh lá hoàn thành; chưa bắt đầu thì mờ', () => {
    expect(PHASE_HUE).toEqual({ idle: 'inactive', start: 'ide', active: 'claude', almost: 'warning', done: 'success' })
  })

  test('năm giai đoạn, năm màu khác nhau', () => {
    expect(new Set(Object.values(PHASE_HUE)).size).toBe(5)
  })

  test('phần đã đóng của thanh mang màu của giai đoạn hiện tại', () => {
    const fillOf = (total: number, closed: number) => barRuns(planOf(total, closed), 20)[0]
    expect(fillOf(8, 1)).toMatchObject({ color: 'ide' })
    expect(fillOf(8, 3)).toMatchObject({ color: 'claude' })
    expect(fillOf(8, 7)).toMatchObject({ color: 'warning' })
    expect(fillOf(8, 8)).toMatchObject({ color: 'success', text: '━'.repeat(20) })
  })

  test('xong hết thì thanh đầy một màu xanh lá, không còn đầu thanh hay khoảng trống', () => {
    const runs = barRuns(planOf(5, 5), 12)
    expect(runs).toEqual([{ text: '━'.repeat(12), color: 'success' }])
  })

  test('chưa bước nào đóng thì không có ô tô màu ở phần đã đóng', () => {
    const runs = barRuns(planOf(6, 0, 'todo'), 12)
    expect(textOf(runs)).not.toContain('━')
    expect(runs).toEqual([{ text: '╌'.repeat(12), color: 'subtle' }])
  })
})

describe('thanh tiến độ', () => {
  test('rộng đúng số ô yêu cầu ở mọi tiến độ, trạng thái bước kế tiếp và độ rộng', () => {
    for (const total of [1, 2, 3, 5, 8, 12, 40]) {
      for (let closed = 0; closed <= total; closed++) {
        for (const next of ['todo', 'doing', 'blocked'] as const) {
          for (const cells of [3, 6, 8, 20, 24]) {
            const runs = barRuns(planOf(total, closed, next), cells)
            expect(cellsOf(runs), `${closed}/${total} ${next} ${cells} ô`).toBe(cells)
          }
        }
      }
    }
  })

  test('đã đóng được một bước thì thấy ít nhất một ô tô màu, dù kế hoạch rất dài', () => {
    const runs = barRuns(planOf(40, 1), 6)
    expect(runs[0]).toMatchObject({ color: 'ide', text: '━' })
  })

  test('chưa xong thì luôn còn chỗ cho đầu thanh hoặc khoảng trống, dù gần xong', () => {
    const runs = barRuns(planOf(40, 39, 'todo'), 6)
    expect(textOf(runs)).toBe('━━━━━╌')
  })

  test('đầu thanh: ◐ cùng màu giai đoạn khi đang làm, ■ vàng khi bị chặn, không có khi chỉ chờ', () => {
    const doing = barRuns(planOf(8, 3, 'doing'), 16)
    expect(doing.map(r => r.text)).toEqual(['━━━━━━', '◐', '╌╌╌╌╌╌╌╌╌'])
    expect(doing[1]).toMatchObject({ color: 'claude', bold: true })

    const blocked = barRuns(planOf(8, 3, 'blocked'), 16)
    expect(blocked[1]).toMatchObject({ text: '■', color: 'warning', bold: true })

    const waiting = barRuns(planOf(8, 3, 'todo'), 16)
    expect(waiting.map(r => r.text)).toEqual(['━━━━━━', '╌╌╌╌╌╌╌╌╌╌'])
  })

  test('đầu thanh theo màu của giai đoạn: xanh dương lúc mới bắt đầu, vàng lúc sắp xong', () => {
    expect(barRuns(planOf(8, 1, 'doing'), 16)[1]).toMatchObject({ text: '◐', color: 'ide' })
    expect(barRuns(planOf(8, 7, 'doing'), 16)[1]).toMatchObject({ text: '◐', color: 'warning' })
  })

  test('phần còn lại là nét đứt mờ, hình dạng khác phần đã đóng nên đọc được cả khi không có màu', () => {
    const runs = barRuns(planOf(8, 2, 'doing'), 16)
    expect(runs.at(-1)).toMatchObject({ text: '╌'.repeat(11), color: 'subtle' })
    expect(textOf(runs)).toBe('━━━━◐' + '╌'.repeat(11))
  })

  test('không vẽ khi kế hoạch rỗng hoặc chỗ quá hẹp', () => {
    expect(barRuns([], 12)).toEqual([])
    expect(barRuns(planOf(4, 1), 2)).toEqual([])
  })

  test('ô ○ của việc router dự kiến: cách nhau khi đủ chỗ, sát nhau khi hẹp, không vượt số ô', () => {
    expect(textOf(plannedRuns(4, 24))).toBe('○ ○ ○ ○')
    expect(textOf(plannedRuns(4, 5))).toBe('○○○○')
    expect(cellsOf(plannedRuns(30, 10))).toBe(10)
    expect(plannedRuns(0, 10)).toEqual([])
    expect(plannedRuns(4, 0)).toEqual([])
  })
})

describe('tên giai đoạn', () => {
  const PHASES: Phase[] = ['idle', 'start', 'active', 'almost', 'done']

  test('tiếng Việt dùng đúng các từ: mới bắt đầu, đang thực hiện, sắp xong, hoàn thành', () => {
    const vi = labels('vi').phase
    expect([vi.start, vi.active, vi.almost, vi.done]).toEqual(['mới bắt đầu', 'đang thực hiện', 'sắp xong', 'hoàn thành'])
  })

  test('mỗi giai đoạn có tên riêng ở cả hai ngôn ngữ', () => {
    for (const lang of ['vi', 'en'] as const) {
      const names = PHASES.map(p => labels(lang).phase[p])
      expect(names.every(n => n.length > 0), lang).toBe(true)
      expect(new Set(names).size, lang).toBe(PHASES.length)
    }
  })
})
