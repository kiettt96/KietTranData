// 0.9.0 A (thay C3 của lời dặn router): router chỉ đọc prompt; luật đội hình do mod áp (hooks/lib/team.ts). Lời dặn không còn khối "Team
// roles", câu "tasks is never []" và trường role; giữ B1, B12, B13 và câu mở rộng questions (nghiệp vụ, quyền, dữ liệu, chi phí). Lời dặn
// chấm subagent trùng 0.8.9 từng byte (không còn role).

import { describe, expect, test } from 'claude-code/testing'
import { agentSystem, routerSystem } from '../hooks/lib/router'

describe('0.9.0 A: lời dặn router sau khi gỡ đội hình', () => {
  const text = routerSystem()
  test('không còn luật đội hình và trường role', () => {
    for (const phrase of ['Team roles', 'tasks is never []', 'audit task', 'review task', 'design task', '"role"', 'running checks and reporting pass or fail']) expect(text, phrase).not.toContain(phrase)
    expect(agentSystem()).not.toContain('"role"')
  })
  test('giữ câu mở rộng questions', () => {
    expect(text).toContain('business, permission, data or cost decisions')
  })
  test('định nghĩa light như 0.8.9', () => {
    expect(text).toContain('light = a small, well-defined change or lookup;')
  })
  test('phần thêm so với 0.8.9 (B1, B12, B13 và câu questions) không quá 600 ký tự', () => {
    expect(text.length - 10888).toBeLessThanOrEqual(600)
  })
})
