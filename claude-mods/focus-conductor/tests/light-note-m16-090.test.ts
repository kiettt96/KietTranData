// 0.9.0 vòng 2 M16: câu dặn của mục tiêu nhỏ (light và khối lượng nhỏ, hay depth none) không còn bảo không cần checklist, vì có prompt đòi
// checklist: việc nhỏ thì làm trực tiếp, chỉ lập checklist khi prompt yêu cầu, vẫn kiểm tra kết quả trước khi trả lời. Context của mod chỉ có
// bản tiếng Việt (briefContext không theo ngôn ngữ giao diện), nên câu mới chỉ có bản vi.

import { describe, expect, test } from 'claude-code/testing'
import { briefContext } from '../hooks/lib/text'
import { makeBrief } from './support/commands'

const OLD = 'Việc nhỏ: làm trực tiếp, không cần checklist; vẫn kiểm tra kết quả trước khi trả lời.'

describe('0.9.0 vòng 2 M16: câu của mục tiêu light', () => {
  test('câu mới không còn cụm "không cần checklist", nói chỉ lập checklist khi prompt yêu cầu', () => {
    const text = briefContext(makeBrief({ depth: 'light', volume: 'small', tasks: [] }), { family: 'sonnet', effort: 'medium' })
    expect(text).not.toContain('không cần checklist')
    expect(text).toContain('chỉ lập checklist khi prompt yêu cầu')
    expect(text).toContain('kiểm tra kết quả trước khi trả lời')
  })
  test('số ký tự của câu không vượt câu cũ quá 20 ký tự', () => {
    const text = briefContext(makeBrief({ depth: 'light', volume: 'small', tasks: [] }), { family: 'sonnet', effort: 'medium' })
    const line = text.split('\n').find(l => l.startsWith('Việc nhỏ:')) ?? ''
    expect(line).not.toBe('')
    expect(line.length).toBeLessThanOrEqual(OLD.length + 20)
  })
})
