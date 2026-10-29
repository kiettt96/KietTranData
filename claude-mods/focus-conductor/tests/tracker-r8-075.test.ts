// 0.7.5 R8 (vòng rà soát 3): khi chỉ còn thay đổi của subagent chưa được kiểm, câu cuối turn nêu số thay đổi của subagent, không
// báo "0 thay đổi sau lần kiểm tra cuối chưa được kiểm tra lại".

import { describe, expect, test } from 'claude-code/testing'
import { newTracker, summarize, trackVerification } from '../hooks/lib/drift'
import { makeBrief } from './support/commands'

const edit = (path: string) => ({ tool: 'Edit', input: { file_path: path }, isError: false, isReadOnly: false })
const bash = (command: string, output = '12 passed') => ({ tool: 'Bash', input: { command }, isError: false, isReadOnly: false, output })
const brief = makeBrief({ tier: 'complex' })
const unverified = (tracker: ReturnType<typeof newTracker>) => summarize(tracker, brief, []).find(f => f.kind === 'unverified')?.text

describe('0.7.5 R8: câu cuối turn khi còn thay đổi của subagent chưa kiểm', () => {
  test('luồng chính đã kiểm đạt, subagent ghi 3 file sau đó: nêu 3 thay đổi của subagent', () => {
    const tracker = newTracker('t')
    trackVerification(tracker, edit('/repo/src/a.ts'))
    trackVerification(tracker, bash('npm test'))
    for (const name of ['x', 'y', 'z']) trackVerification(tracker, edit(`/repo/src/${name}.ts`), 'agent-1')
    const text = unverified(tracker)
    expect(text).toContain('3 thay đổi của subagent')
    expect(text).not.toContain('0 thay đổi')
  })

  test('nhiều subagent: cộng thay đổi chưa kiểm của mọi subagent', () => {
    const tracker = newTracker('t')
    trackVerification(tracker, edit('/repo/src/a.ts'))
    trackVerification(tracker, bash('npm test'))
    trackVerification(tracker, edit('/repo/src/x.ts'), 'agent-1')
    trackVerification(tracker, edit('/repo/src/y.ts'), 'agent-1')
    trackVerification(tracker, edit('/repo/src/z.ts'), 'agent-2')
    expect(unverified(tracker)).toContain('3 thay đổi của subagent')
  })

  test('subagent kiểm đạt phần của chính nó: chỉ còn thay đổi của subagent kia', () => {
    const tracker = newTracker('t')
    trackVerification(tracker, edit('/repo/src/a.ts'))
    trackVerification(tracker, bash('npm test'))
    trackVerification(tracker, edit('/repo/src/x.ts'), 'agent-1')
    trackVerification(tracker, edit('/repo/src/y.ts'), 'agent-1')
    trackVerification(tracker, edit('/repo/src/z.ts'), 'agent-2')
    trackVerification(tracker, bash('npm test'), 'agent-1')
    expect(unverified(tracker)).toContain('1 thay đổi của subagent')
  })

  test('cả luồng chính lẫn subagent còn thay đổi chưa kiểm: nêu cả hai số', () => {
    const tracker = newTracker('t')
    trackVerification(tracker, edit('/repo/src/a.ts'))
    trackVerification(tracker, bash('npm test'))
    trackVerification(tracker, edit('/repo/src/b.ts'))
    trackVerification(tracker, edit('/repo/src/c.ts'))
    trackVerification(tracker, edit('/repo/src/x.ts'), 'agent-1')
    const text = unverified(tracker)
    expect(text).toContain('2 thay đổi của luồng chính')
    expect(text).toContain('1 thay đổi của subagent')
  })

  test('chỉ thay đổi của luồng chính: câu cũ; luồng chính kiểm đạt xóa cả phần của subagent', () => {
    const tracker = newTracker('t')
    trackVerification(tracker, edit('/repo/src/a.ts'))
    trackVerification(tracker, bash('npm test'))
    trackVerification(tracker, edit('/repo/src/b.ts'))
    expect(unverified(tracker)).toBe('1 thay đổi sau lần kiểm tra cuối chưa được kiểm tra lại')
    trackVerification(tracker, edit('/repo/src/x.ts'), 'agent-1')
    trackVerification(tracker, bash('npm test'))
    expect(unverified(tracker)).toBeUndefined()
    trackVerification(tracker, edit('/repo/src/c.ts'))
    expect(unverified(tracker)).toBe('1 thay đổi sau lần kiểm tra cuối chưa được kiểm tra lại')
  })

  test('chưa chạy bước kiểm tra nào: câu cũ về số thay đổi của turn', () => {
    const tracker = newTracker('t')
    trackVerification(tracker, edit('/repo/src/x.ts'), 'agent-1')
    expect(unverified(tracker)).toBe('Turn có 1 thay đổi nhưng không chạy bước kiểm tra nào')
  })
})
