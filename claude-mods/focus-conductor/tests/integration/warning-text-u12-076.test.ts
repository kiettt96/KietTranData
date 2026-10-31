// 0.7.6 U12: câu cảnh báo hiển thị trên band và pane bằng tiếng Việt thường ("deep" thành "rất sâu", "verified" thành "đã kiểm chứng",
// "evidence" thành "bằng chứng"). Chỉ đổi lúc vẽ: câu đã lưu, câu gửi router và context chèn cho Claude giữ nguyên.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { PANE, base, plan, submit } from '../support/engine'

const BAND = { plugin: 'focus-conductor', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 6, bodyColumns: 160, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as const
const PLAN = 'mcp__focus-conductor__plan'

async function textsOf($: Engine, target: typeof BAND | typeof PANE) {
  const ui = await $.ui.mount(target as never)
  const texts = (await ui.findAll({ type: 'Text' })).map(e => e.text ?? '')
  await ui.unmount()
  return texts.join('\n')
}

describe('0.7.6 U12: câu cảnh báo hiển thị bằng tiếng Việt thường', () => {
  test('vượt ngân sách của việc deep: band và pane ghi "rất sâu"; context chèn cho Claude vẫn như cũ', async ($, on) => {
    base(on, { router: () => plan({ goal: 'Đổi cấu trúc thư mục dữ liệu', depth: 'hard', volume: 'large' }) })
    on('tool.call', { tool: 'Read' }, () => ({ result: 'nội dung' }))
    await submit($, 'Đổi cấu trúc thư mục dữ liệu theo đề xuất')
    await $.turn.start({ text: 'làm', turnId: 'u12' } as never)
    let context = ''
    for (let i = 0; i < 100; i++) context += ((await $.tool.call({ tool: 'Read', file_path: `src/f${i}.ts` } as never)).context ?? []).join('\n')
    expect(context).toContain('vượt mức dự kiến cho việc deep')
    for (const target of [BAND, PANE]) {
      const shown = await textsOf($, target)
      expect(shown).toContain('cho việc rất sâu')
      expect(shown).not.toContain('cho việc deep')
    }
  })

  test('bước ghi verified bị hạ: band và pane ghi "đã kiểm chứng", "bằng chứng", "lưu là xong"', async ($, on) => {
    base(on, { router: () => plan({ goal: 'Sửa lỗi đăng nhập', depth: 'substantial', volume: 'medium' }) })
    await submit($, 'Sửa lỗi đăng nhập trong module xác thực')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa lỗi' }, { title: 'Chạy test' }] } as never)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: 'npm test: 12 pass' } as never)
    for (const target of [BAND, PANE]) {
      const shown = await textsOf($, target)
      expect(shown).toContain('Bước 1 ghi đã kiểm chứng nhưng')
      expect(shown).toContain('bằng chứng')
      expect(shown).toContain('lưu là xong')
      expect(shown).not.toMatch(/ghi verified|evidence|lưu là done/)
    }
  })

  test('uiLanguage en: câu giữ nguyên', { options: { uiLanguage: 'en' } }, async ($, on) => {
    base(on, { router: () => plan({ goal: 'Fix login', depth: 'substantial', volume: 'medium' }) })
    await submit($, 'Fix the login bug in the auth module')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Fix' }, { title: 'Test' }] } as never)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: 'npm test: 12 pass' } as never)
    expect(await textsOf($, PANE)).toContain('ghi verified nhưng')
  })
})
