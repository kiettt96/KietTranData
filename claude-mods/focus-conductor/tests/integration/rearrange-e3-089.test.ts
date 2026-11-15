// 0.8.9 vòng 3 E3 (tích hợp): việc chờ giao bị bỏ thì rời danh sách chờ giao. Lời nhắc việc còn chờ giao (strictDelegation block) và
// /conductor status không còn nêu việc đó.

import { describe, expect, test } from 'claude-code/testing'
import { base, conductor, plan, submit, task } from '../support/engine'

const OPTS = { options: { planApproval: 'off', strictDelegation: 'block' } }
const TITLE = 'Soát chính tả phần phụ lục'
const FIRST = plan({
  goal: 'Hoàn thiện bộ tài liệu hướng dẫn',
  depth: 'hard',
  volume: 'large',
  kind: 'edit',
  tasks: [...Array.from({ length: 14 }, (_, i) => task(`Chương ${i + 1}`, 'main', 'sonnet', 'medium')), task(TITLE, 'agent', 'haiku', 'low')],
})
const DROP = plan({ relation: 'refine', intent: 'amend', goal: '', arrange: { order: [], drop: [{ task: 15, why: 'phụ lục đã soát xong' }], merge: [] } })

describe('0.8.9 vòng 3 E3: việc chờ giao bị bỏ rời danh sách chờ giao', () => {
  test('việc 15 chờ giao bị bỏ: lời nhắc việc còn chờ giao và /conductor status không còn việc 15', OPTS, async ($, on) => {
    base(on, { router: request => (request.includes('thôi soát') ? DROP : FIRST) })
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, 'Hoàn thiện bộ tài liệu hướng dẫn')
    const edit = async () => JSON.stringify((await $.tool.call({ tool: 'Edit', file_path: 'docs/a.md', old_string: 'a', new_string: 'b' } as never)) ?? {})
    expect(await edit()).toContain('Việc 15')
    expect(String((await conductor($, 'status')).text)).toContain(`15. ${TITLE}: chờ giao`)
    await submit($, 'thôi soát phụ lục')
    expect(await edit()).not.toContain('Việc 15')
    expect(String((await conductor($, 'status')).text)).not.toContain(`15. ${TITLE}: chờ giao`)
  })
})
