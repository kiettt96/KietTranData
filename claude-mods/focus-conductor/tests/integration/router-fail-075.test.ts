// 0.7.5 B3: router lỗi ở prompt tiếp nối chỉ bỏ lựa chọn model luồng chính; phân việc đã có và trạng thái giao của từng việc
// (việc chưa giao, đang chạy, đã xong) vẫn giữ.

import { describe, expect, test } from 'claude-code/testing'
import { DEFAULT_ROUTER, FOUR, base, conductor, step, submit } from '../support/engine'

const failOn = (word: string) => (request: string) => (request.includes(word) ? null : DEFAULT_ROUTER(request))

describe('0.7.5 B3: router lỗi ở prompt tiếp nối', () => {
  test('việc ghi giao subagent chưa giao vẫn được nhắc sau khi router lỗi', {}, async ($, on) => {
    base(on, { router: failOn('làm tiếp') })
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, FOUR)
    await submit($, 'làm tiếp phần còn lại')
    const edit = await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
    expect((edit.context ?? []).join('\n')).toContain('Việc 1 (haiku/low), 2 (sonnet/medium), 4 (sonnet/medium)')
  })

  test('phân việc trên /conductor status vẫn còn; khối gửi Claude nói phân việc đã có vẫn giữ', {}, async ($, on) => {
    const seen = base(on, { router: failOn('làm tiếp') })
    await submit($, FOUR)
    await submit($, 'làm tiếp phần còn lại')
    const status = String((await conductor($, 'status')).text)
    expect(status).toContain('Đổi tên userId thành accountId')
    const context = seen.contexts[1]?.join('\n') ?? ''
    expect(context).toContain('Router không đọc được prompt này')
    expect(context).toContain('phân việc đã có của mục tiêu vẫn giữ')
    expect(context).not.toContain('không còn hiệu lực')
  })

  test('lựa chọn model luồng chính bị bỏ: turn chạy model của phiên', {}, async ($, on) => {
    const seen = base(on, { router: failOn('làm tiếp') })
    await submit($, FOUR)
    await submit($, 'làm tiếp phần còn lại')
    expect(await step($, seen, { turnId: 't2' })).toEqual({ model: 'claude-sonnet-5-5', effort: 'medium' })
  })
})
