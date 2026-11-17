// 0.9.0 B13: lời dặn router coi mỗi dòng mang mã của một bảng hay danh sách mục việc (M1, A2, B10) là một việc riêng như đề mục có mã, và
// không còn cụm "at most 6" ở constraints (mod đã bỏ trần ràng buộc từ 0.8.9). Tổng phần lời dặn thêm của B1, B12, B13 không quá 500 ký tự
// so với lời dặn của 0.8.9 (10.888 ký tự).

import { describe, expect, test } from 'claude-code/testing'
import { routerSystem } from '../hooks/lib/router'

describe('0.9.0 B13: lời dặn router', () => {
  test('dòng có mã của bảng hay danh sách mục việc là việc riêng', () => {
    const text = routerSystem()
    expect(text).toContain('every row of a table or list of work items that starts with a code (M1, A2, B10) is its own task')
  })
  test('constraints không còn trần 6', () => {
    expect(routerSystem()).not.toContain('at most 6 hard rules')
  })
  test('B1, B12, B13 thêm không quá 500 ký tự so với 0.8.9 (trừ phần của nhóm C)', () => {
    const text = routerSystem()
    const team = text.slice(text.indexOf('Team roles:'), text.indexOf('Reading the request:'))
    const groupC = [team, '; also running checks and reporting pass or fail', ' (including business, permission, data or cost decisions the request leaves open)', ' "role": "design"|"review"|"build"|"search"|"audit",']
    const withoutC = groupC.reduce((sum, part) => sum - (text.includes(part) ? part.length : 0), text.length)
    expect(withoutC - 10888).toBeLessThanOrEqual(500)
  })
})
