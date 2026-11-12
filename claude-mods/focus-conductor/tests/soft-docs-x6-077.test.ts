// 0.7.7 X6: turn chỉ ghi tài liệu (.md, .markdown, .txt, không phân biệt hoa thường) và đã Read lại từng file sau lần ghi cuối thì cảnh báo
// chưa kiểm hạ xuống mức nhẹ: không toast, không vào band hay "Cần chú ý", pane ghi mờ. Đọc lại là bằng chứng yếu: không đổi isVerified,
// checks hay luật verified. Thiếu một điều kiện (đích không đọc được, lệnh lạ, file không phải tài liệu, chưa đọc lại) thì như cũ.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { newTracker, observe, summarize, trackVerification } from '../hooks/lib/drift'
import { attentionItems } from '../hooks/ui/attention'
import * as S from '../hooks/lib/state'
import { bash, edit, makeBrief } from './support/commands'
import { COMPLEX_PROMPT, PANE, base, submit } from './support/engine'

const brief = makeBrief()
const read = (path: string) => ({ tool: 'Read', input: { file_path: path }, isError: false, isReadOnly: true })
type Call = ReturnType<typeof bash> | ReturnType<typeof edit> | ReturnType<typeof read>
const finding = (calls: readonly Call[]) => {
  const tracker = newTracker('t')
  for (const call of calls) observe(tracker, call, brief, [])
  return { tracker, found: summarize(tracker, brief, []).find(f => f.kind === 'unverified') }
}
const SOFT = (n: number) => `Turn có ${n} thay đổi tài liệu, đã đọc lại sau lần ghi cuối, chưa có lệnh kiểm`

describe('0.7.7 X6: cảnh báo nhẹ khi chỉ sửa tài liệu và đã đọc lại', () => {
  test('ba Edit .md, đọc lại đủ: nhẹ, đúng câu; isVerified và checks không đổi', () => {
    const { tracker, found } = finding([edit('/p/a.md'), edit('/p/b.md'), edit('/p/c.md'), read('/p/a.md'), read('/p/b.md'), read('/p/c.md')])
    expect(found?.isSoft).toBe(true)
    expect(found?.text).toBe(SOFT(3))
    expect(tracker.isVerified).toBe(false)
    expect(tracker.checks).toBe(0)
  })

  test('chỉ đọc lại hai trên ba: thường', () => {
    expect(finding([edit('/p/a.md'), edit('/p/b.md'), edit('/p/c.md'), read('/p/a.md'), read('/p/b.md')]).found?.isSoft).toBeUndefined()
  })

  test('hai .md và một .ts, đọc lại đủ: thường', () => {
    expect(finding([edit('/p/a.md'), edit('/p/b.md'), edit('/p/c.ts'), read('/p/a.md'), read('/p/b.md'), read('/p/c.ts')]).found?.isSoft).toBeUndefined()
  })

  test('Edit, Read, rồi Edit lại không đọc: thường', () => {
    expect(finding([edit('/p/a.md'), read('/p/a.md'), edit('/p/a.md')]).found?.isSoft).toBeUndefined()
  })

  test('Bash heredoc ghi /p/a.md rồi Read: nhẹ', () => {
    expect(finding([bash("cat > /p/a.md <<'EOF'\nx\nEOF"), read('/p/a.md')]).found?.isSoft).toBe(true)
  })

  test('Bash ghi a.md bằng đường dẫn tương đối khi không biết thư mục làm việc: thường', () => {
    expect(finding([bash("cat > a.md <<'EOF'\nx\nEOF"), read('a.md')]).found?.isSoft).toBeUndefined()
  })

  test('python3 gen.py cùng Edit a.md và Read a.md: thường (lệnh lạ không đọc được đích)', () => {
    expect(finding([bash('python3 gen.py'), edit('/p/a.md'), read('/p/a.md')]).found?.isSoft).toBeUndefined()
  })

  test('subagent Edit b.md, luồng chính Read b.md: nhẹ', () => {
    const tracker = newTracker('t')
    trackVerification(tracker, edit('/p/b.md'), 'agent-1')
    observe(tracker, read('/p/b.md'), brief, [])
    expect(summarize(tracker, brief, []).find(f => f.kind === 'unverified')?.isSoft).toBe(true)
  })

  test('npm test đạt rồi Edit và Read a.md: nhẹ (nhánh sau lần kiểm cuối), câu đếm thay đổi sau lần kiểm', () => {
    const { found } = finding([edit('/p/x.ts'), bash('npm test', '12 passing (3ms)'), edit('/p/a.md'), read('/p/a.md')])
    expect(found?.isSoft).toBe(true)
    expect(found?.text).toBe(SOFT(1))
  })

  test('A.MD nhẹ, a.mdx thường; .markdown và .txt nhẹ', () => {
    expect(finding([edit('/p/A.MD'), read('/p/A.MD')]).found?.isSoft).toBe(true)
    expect(finding([edit('/p/a.mdx'), read('/p/a.mdx')]).found?.isSoft).toBeUndefined()
    expect(finding([edit('/p/a.markdown'), edit('/p/b.txt'), read('/p/a.markdown'), read('/p/b.txt')]).found?.isSoft).toBe(true)
  })

  test('Core từ 0.7.6 (cảnh báo không có isSoft) vẫn vào Cần chú ý; cảnh báo nhẹ thì không', () => {
    const at = 10
    const core = S.normalizeCore({ ...S.EMPTY_CORE, brief: { ...brief, at: 0 }, warnings: [{ at, kind: 'unverified', text: 'Turn có 1 thay đổi nhưng không chạy bước kiểm tra nào' }, { at, kind: 'unverified', text: SOFT(1), isSoft: true }] } as never)
    const texts = attentionItems(core, 'vi').map(item => item.text)
    expect(texts.some(t => t.startsWith('Turn có 1 thay đổi nhưng'))).toBe(true)
    expect(texts.some(t => t.includes('thay đổi tài liệu'))).toBe(false)
  })
})

describe('0.7.7 X6: tích hợp', () => {
  test('ba Edit .md đọc lại đủ: không toast, band không có dòng, pane có dòng cảnh báo nhẹ', { options: { planApproval: 'off' } }, async ($: Engine, on) => {
    const seen = base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Read' }, () => ({ result: 'nội dung' }))
    on('turn.complete', () => ({ text: '' }))
    await submit($, COMPLEX_PROMPT)
    for (const f of ['a', 'b', 'c']) await $.tool.call({ tool: 'Edit', file_path: `docs/${f}.md`, old_string: 'a', new_string: 'b' } as never)
    for (const f of ['a', 'b', 'c']) await $.tool.call({ tool: 'Read', file_path: `docs/${f}.md` } as never)
    await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as never)
    expect(seen.toasts.some(t => t.includes('thay đổi'))).toBe(false)
    const band = await $.ui.mount({ plugin: 'focus-conductor', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 3, bodyColumns: 80, scroll: { offset: 0, bodyRows: 6 }, view: {} } })
    expect(await band.find({ type: 'Text', text: /thay đổi tài liệu/ })).toBeUndefined()
    await band.unmount()
    const pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: /thay đổi tài liệu, đã đọc lại/ })).toBeDefined()
    await pane.unmount()
  })
})
