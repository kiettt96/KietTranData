// 0.9.0 C3: đội hình theo cỡ việc trong lời dặn router. none, light: không thêm audit, review, design. substantial, edit hay mixed: sau các
// việc build, một audit (khi biết lệnh kiểm) rồi một review, đứng cuối theo thứ tự đó. hard: thêm design đứng đầu khi đổi cấu trúc lớn hay chạm
// bảo mật, dữ liệu, và một design đánh giá sẵn sàng đứng cuối. Tra cứu là search, chạy kiểm là audit, sửa và soạn là build; việc không phải
// code giữ đội hình. Prompt đã quy định kiểm độc lập thì việc đó mang vai review hay audit, không thêm việc trùng. questions gồm cả quyết
// định nghiệp vụ, quyền, dữ liệu, chi phí. Catalog: haiku được chạy lệnh kiểm và báo cáo, không sửa file. Thêm không quá 2.000 ký tự so với
// lời dặn 0.8.9 (10.888) cho cả B1, B12, B13 và nhóm C.

import { describe, expect, test } from 'claude-code/testing'
import { agentSystem, routerSystem } from '../hooks/lib/router'

describe('0.9.0 C3: lời dặn router về đội hình', () => {
  const text = routerSystem()
  test('mẫu JSON của việc có role', () => {
    expect(text).toContain('"role": "design"|"review"|"build"|"search"|"audit"')
  })
  test('năm vai và luật theo cỡ việc', () => {
    for (const phrase of [
      'Team roles:',
      'depth none or light: no added audit, review or design tasks',
      'depth substantial or hard, kind edit or mixed: tasks is never []: the work is build tasks (main or agent), then one audit task',
      'one audit task (only when a check command is known from the request or the project), then one review task, last',
      'depth hard: also one design task first when the request changes structure widely or touches security or data, and one design readiness task last, after the review',
      'do not add a duplicate',
      'business, permission, data or cost decisions',
    ]) expect(text, phrase).toContain(phrase)
  })
  test('catalog: haiku chạy lệnh kiểm và báo cáo, vẫn không sửa file', () => {
    expect(text).toContain('running checks and reporting pass or fail')
    expect(text).toContain('Never for work that changes files.')
  })
  test('router chấm subagent có role trong mẫu JSON', () => {
    expect(agentSystem()).toContain('"role": "design"|"review"|"build"|"search"|"audit"')
  })
  test('tổng phần thêm so với 0.8.9 không quá 2.000 ký tự, phần của nhóm C không quá 1.500', () => {
    expect(text.length - 10888).toBeLessThanOrEqual(2000)
    const team = text.slice(text.indexOf('Team roles:'), text.indexOf('Reading the request:'))
    const groupC = [team, '; also running checks and reporting pass or fail', ' (including business, permission, data or cost decisions the request leaves open)', ' "role": "design"|"review"|"build"|"search"|"audit",']
    expect(groupC.reduce((sum, part) => sum + (text.includes(part) ? part.length : 0), 0)).toBeLessThanOrEqual(1500)
  })
})
