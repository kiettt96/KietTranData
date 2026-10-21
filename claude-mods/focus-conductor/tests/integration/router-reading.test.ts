// 0.7.0 điểm 7, phần nối dây ở prompt.submit: kiểm lại một lần khi router liệt kê quá 8 yêu cầu, bước đang mở của checklist hiện
// tại đi kèm request, và yêu cầu chưa có việc nào phủ được nhắc cho Claude (không nhắc ở lượt chỉ đối chiếu).

import { describe, expect, test } from 'claude-code/testing'
import { base, plan, submit, task } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'
const reqs = (n: number) => Array.from({ length: n }, (_, i) => `Yêu cầu ${i + 1}`)
const ctx = (seen: { contexts: string[][] }, i = 0) => (seen.contexts[i] ?? []).join('\n')

describe('0.7.0 7: kiểm lại khi quá nhiều yêu cầu (nối dây)', () => {
  // 0.7.2: kiểm lại chỉ khi quá 8 yêu cầu mà còn yêu cầu không việc nào phủ (trước đó mỗi khi quá 8 yêu cầu).
  const gappy = (goal: string, n: number) =>
    plan({ goal, requirements: reqs(n), depth: 'substantial', tasks: [task('Việc', 'main', 'sonnet', 'medium', { covers: Array.from({ length: n - 1 }, (_, i) => i + 1) })] })

  test('9 yêu cầu còn một yêu cầu chưa phủ: router được hỏi hai lượt, lượt hai kèm câu trả lời trước', {}, async ($, on) => {
    let n = 0
    const seen = base(on, { router: () => gappy(`Lần ${(n += 1)}`, 9) })
    await submit($, 'Cập nhật skill lên v10, đối chiếu đủ các mục')
    expect(seen.routed.length).toBe(2)
    expect(seen.routed[1]).toContain('<previous_answer>')
    expect(seen.routed[1]).toContain('every requirement')
    // Lượt kiểm lại được dùng.
    expect(ctx(seen)).toContain('Mục tiêu cuối: Lần 2')
  })

  test('9 yêu cầu đã phủ đủ: chỉ một lượt', {}, async ($, on) => {
    const seen = base(on, { router: () => plan({ goal: 'Một lượt', requirements: reqs(9), tasks: [task('Việc', 'main', 'sonnet', 'medium', { covers: Array.from({ length: 9 }, (_, i) => i + 1) })] }) })
    await submit($, 'Cập nhật skill lên v10')
    expect(seen.routed.length).toBe(1)
  })

  test('8 yêu cầu: chỉ một lượt', {}, async ($, on) => {
    const seen = base(on, { router: () => plan({ goal: 'Một lượt', requirements: reqs(8) }) })
    await submit($, 'Cập nhật skill lên v10')
    expect(seen.routed.length).toBe(1)
  })
})

describe('0.7.0 7: bước đang mở đi kèm request của router', () => {
  test('prompt tiếp nối: request có các bước còn mở; request đầu (chưa có checklist) thì không', {}, async ($, on) => {
    const seen = base(on)
    await submit($, 'sửa typo trong README')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Đọc tài liệu v10' }, { title: 'Sửa skill' }] })
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await submit($, 'Làm tiếp phần còn lại')
    expect(seen.routed[0]).not.toContain('Open checklist steps')
    expect(seen.routed[1]).toContain('Open checklist steps')
    expect(seen.routed[1]).toContain('Sửa skill')
    expect(seen.routed[1]).not.toContain('Đọc tài liệu v10')
  })
})

describe('0.7.0 7: nhắc yêu cầu chưa có việc nào phủ', () => {
  const pieces = (covers: number[][]) => covers.map((c, i) => task(`Việc ${i + 1}`, 'main', 'sonnet', 'medium', { covers: c }))

  test('yêu cầu 2 không việc nào phủ: context nhắc đúng yêu cầu đó', {}, async ($, on) => {
    const seen = base(on, { router: () => plan({ goal: 'Mục tiêu', depth: 'substantial', requirements: ['R1 giữ API', 'R2 viết test'], tasks: pieces([[1]]) }) })
    await submit($, 'làm hai việc')
    expect(ctx(seen)).toContain('Yêu cầu chưa có việc nào phủ')
    expect(ctx(seen)).toContain('R2 viết test')
    expect(ctx(seen)).not.toContain('R1 giữ API')
  })

  test('đã phủ đủ: không có dòng nhắc', {}, async ($, on) => {
    const seen = base(on, { router: () => plan({ goal: 'Mục tiêu', depth: 'substantial', requirements: ['R1', 'R2'], tasks: pieces([[1], [2]]) }) })
    await submit($, 'làm hai việc')
    expect(ctx(seen)).not.toContain('Yêu cầu chưa có việc nào phủ')
  })

  test('lượt chỉ đối chiếu: không nhắc (yêu cầu thuộc prompt đính kèm, không phải việc của lượt này)', {}, async ($, on) => {
    const seen = base(on, { router: () => plan({ goal: 'Đối chiếu', reference: true, kind: 'answer', depth: 'substantial', requirements: ['R1', 'R2'], tasks: pieces([[1]]) }) })
    await submit($, 'chỉ để đối chiếu, đừng chạy: làm hai việc')
    expect(ctx(seen)).not.toContain('Yêu cầu chưa có việc nào phủ')
  })

  test('prompt tiếp nối thêm yêu cầu mới mà chưa việc nào phủ: nhắc ở context tiếp nối', {}, async ($, on) => {
    const seen = base(on, {
      router: request =>
        request.startsWith('Làm tiếp')
          ? plan({ relation: 'continue', goal: '', depth: 'substantial', requirements: ['R3 cập nhật README'], tasks: [] })
          : plan({ goal: 'Mục tiêu', depth: 'substantial', requirements: ['R1', 'R2'], tasks: pieces([[1], [2]]) }),
    })
    await submit($, 'làm hai việc')
    await submit($, 'Làm tiếp, thêm cập nhật README')
    expect(ctx(seen, 1)).toContain('Yêu cầu chưa có việc nào phủ')
    expect(ctx(seen, 1)).toContain('R3 cập nhật README')
  })
})
