// 0.9.0 vòng 2 M8: thay thế tiến trình `<( )` tìm trên chuỗi đã che nháy. Dấu `)` trong nháy bên trong `<( )` không làm lệch đích ghi; lệnh ở
// `check` của bước có `<( )` chỉ đọc không bị sổ thay đổi đếm là lệnh ghi không rõ đích; `<( )` có lệnh ghi bên trong vẫn là ghi.

import { describe, expect, test } from 'claude-code/testing'
import { classifyBash } from '../hooks/lib/drift/classify'
import { SAMPLE_OPTS, callTool, editSample, openSample, sampleSetup } from './support/closing-sample'

const DIFF = 'diff <(sort a.txt) <(sort b.txt)'

describe('0.9.0 vòng 2 M8: thay thế tiến trình có nháy', () => {
  test('diff <(echo "a)b") /repo/a: không có đích ghi /repo/a)', () => {
    const out = classifyBash('diff <(echo "a)b") /repo/a', '/repo')
    expect(out.paths).not.toContain('/repo/a)')
    expect(out.effects.filter(e => e.kind === 'write')).toEqual([])
  })
  test('cp <(printf "x)y") /repo/a: đích ghi đúng là /repo/a', () => {
    expect(classifyBash('cp <(printf "x)y") /repo/a', '/repo').paths).toEqual(['/repo/a'])
  })
  test('<(tee /repo/x) có lệnh ghi bên trong: vẫn là ghi', () => {
    const out = classifyBash('cat <(tee /repo/x)', '/repo')
    expect(out.effects.some(e => e.kind === 'write')).toBe(true)
  })
  test(`bước có check \`${DIFF}\`, chạy đúng lệnh đó: sổ thay đổi không tăng số lệnh ghi không rõ đích`, SAMPLE_OPTS(), async ($, on) => {
    let unknown = -1
    on('state.set', (_$, e, next) => {
      const ev = e as { key?: string; value?: { changed?: { unknown?: number } } }
      if (ev.key === 'core' && typeof ev.value?.changed?.unknown === 'number') unknown = ev.value.changed.unknown
      return next(e)
    })
    const sample = sampleSetup(on)
    sample.outputs[DIFF] = { text: '' }
    await openSample($, sample, [{ title: 'Việc 1: so hai tệp', check: `\`${DIFF}\`` }])
    await editSample($)
    const before = unknown
    await callTool($, { tool: 'Bash', command: DIFF })
    expect(unknown).toBe(before)
  })
})
