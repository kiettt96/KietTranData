// 0.9.0 vòng 2 M22: mẫu 071-M10 sống qua cả bộ ở lượt L5. Khi luồng chính sửa file sau lần test đạt, bước tự nâng hạ về
// done; status line phải vẽ lại ngay, không còn giữ "· 1✓" của trước lần sửa. Khi đội hình bật, refreshTeam cũng vẽ lại status line
// sau lần sửa (bước đóng đổi), nên ca chính tắt closingReview để chỉ còn đường vẽ lại của lần hạ bước.

import { describe, expect, test } from 'claude-code/testing'
import { COMPLEX_PROMPT, base, submit } from '../support/engine'

const PLAN = 'mcp__focus-conductor__plan'

describe('0.9.0 M22: status line khi hạ bước tự nâng', () => {
  test('closingReview off, sửa file sau lần test đạt: status line mới nhất không còn số bước verified', { options: { planApproval: 'off', closingReview: 'off' } }, async ($, on) => {
    const seen = base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: '12 pass' }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }, { title: 'Kiểm' }] })
    await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    expect(seen.statuses.at(-1)).toContain('1✓')
    await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'b', new_string: 'c' })
    expect(seen.statuses.at(-1)).toBeDefined()
    expect(seen.statuses.at(-1)).not.toContain('1✓')
  })


  test('sửa file sau lần test đạt: đội hình bật: status line mới nhất cũng không còn số bước verified', { options: { planApproval: 'off' } }, async ($, on) => {
    const seen = base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: '12 pass' }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }, { title: 'Kiểm' }] })
    await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    expect(seen.statuses.at(-1)).toContain('1✓')
    await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'b', new_string: 'c' })
    expect(seen.statuses.at(-1)).toBeDefined()
    expect(seen.statuses.at(-1)).not.toContain('1✓')
  })
})
