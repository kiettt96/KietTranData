// 0.7.8 G7: DISCIPLINE mục 5 dặn prompt giao subagent phải tự đứng được và luồng chính đối chiếu kết quả subagent với tiêu chí
// trước khi đóng bước. Mục system prompt vẫn một mục, scope session (không phá cache giữa các turn).

import { describe, expect, test } from 'claude-code/testing'
import { DISCIPLINE } from '../../hooks/lib/text'
import { base } from '../support/engine'

const HANDOFF =
  'Prompt giao subagent phải tự đứng được: nêu mục tiêu cuối, việc cụ thể, ràng buộc và phạm vi file liên quan, tiêu chí xong và dạng kết quả trả về.'
const REVIEW = 'Nhận kết quả subagent thì đối chiếu với tiêu chí đó trước khi đóng bước.'
const FACTS = { model: 'claude-sonnet-5-5', promptModel: 'claude-sonnet-5-5', surfaces: [], tools: [], outputStyle: null, traits: [] } as const

describe('0.7.8 G7: dặn giao subagent đủ thông tin và kiểm kết quả', () => {
  test('mục 5 kết thúc bằng hai câu mới; hai câu không quá 300 ký tự', () => {
    const five = DISCIPLINE.split('\n').find(line => line.startsWith('5. ')) ?? ''
    expect(five.endsWith(`${HANDOFF} ${REVIEW}`)).toBe(true)
    expect(` ${HANDOFF} ${REVIEW}`.length).toBeLessThanOrEqual(300)
  })

  test('prompt.compose vẫn một mục kỷ luật, scope session, chứa hai câu mới', {}, async ($, on) => {
    base(on)
    const result = await $.prompt.compose(FACTS)
    const mine = result.sections.filter(s => s.id === 'focus-conductor:discipline')
    expect(mine.length).toBe(1)
    expect(mine[0]?.scope).toBe('session')
    expect(mine[0]?.text).toContain(HANDOFF)
    expect(mine[0]?.text).toContain(REVIEW)
  })
})
