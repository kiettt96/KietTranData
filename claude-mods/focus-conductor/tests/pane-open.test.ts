// 0.7.2 điểm 4: quyết định tự mở pane (hàm thuần). Đường người dùng tự đóng pane do engine phát ui.close với origin person, mà bộ
// kiểm thử không phát được, nên được kiểm ở đây bằng hàm thuần.

import { describe, expect, test } from 'claude-code/testing'
import { PANE_ROWS, isPersonClose, shouldAutoOpenPane } from '../hooks/lib/pane'

const base = { enabled: true, goalId: 3, closedGoal: -1, isOpen: false }

describe('0.7.2 4: shouldAutoOpenPane', () => {
  test('bật, chưa đóng, chưa mở: mở', () => {
    expect(shouldAutoOpenPane(base)).toBe(true)
  })
  test('option tắt: không mở', () => {
    expect(shouldAutoOpenPane({ ...base, enabled: false })).toBe(false)
  })
  test('pane đã mở: không mở lại', () => {
    expect(shouldAutoOpenPane({ ...base, isOpen: true })).toBe(false)
  })
  test('người dùng đã đóng pane trong đúng mục tiêu này: không mở lại', () => {
    expect(shouldAutoOpenPane({ ...base, closedGoal: 3 })).toBe(false)
  })
  test('người dùng đóng pane ở mục tiêu trước: mục tiêu mới mở lại', () => {
    expect(shouldAutoOpenPane({ ...base, closedGoal: 2 })).toBe(true)
  })
})

describe('0.7.2 4: isPersonClose', () => {
  test('chỉ lần đóng của người dùng được nhớ; plugin tự đóng hay gỡ plugin thì không', () => {
    expect(isPersonClose({ kind: 'person' })).toBe(true)
    expect(isPersonClose({ kind: 'plugin' })).toBe(false)
    expect(isPersonClose({ kind: 'unload' })).toBe(false)
  })
})

describe('0.7.2 4: kích thước', () => {
  test('pane tự mở vừa phải, không chiếm cả màn hình khi nằm trên prompt', () => {
    expect(PANE_ROWS).toBe(16)
  })
})
