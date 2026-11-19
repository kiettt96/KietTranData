// 0.9.0 vòng 2, kiểm độc lập vòng 2 lỗi 1: vai chỉ đọc ghi qua liên kết mềm treo. Engine trả stat của liên kết treo với isLink mà không có
// realPath; mod coi như tệp chưa có, đi lên thư mục cha và trả chính liên kết, nên ghi được ra ngoài thư mục tạm. Sửa theo chiều an toàn
// (quyết định của chủ mod 19/11/2026): không đọc được đích thật của liên kết thì coi là ngoài thư mục tạm và từ chối. Lệnh tạo liên kết
// mềm dạng `ln -v -s`, `/bin/ln -s`, `cp -s` cùng lệnh ghi cũng bị từ chối như `ln -s`.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { SAMPLE_OPTS, callTool, editSample, openSample, sampleSetup } from '../support/closing-sample'

async function reviewer($: Engine, id: string) {
  const description = 'Kiểm độc lập: thống kê'
  await $.tool.call({ tool: 'Agent', tool_use_id: id, description, prompt: 'Rà.' } as never)
  await $.agent.spawn({ prompt: 'Rà.', description, tool_use_id: id } as never)
  return `a-${id}`
}

/** /tmp/l là liên kết mềm treo: stat trả isLink, không có realPath. */
function dangling(on: On) {
  on('fs.stat', (_$, e, next) => {
    const ev = e as { path?: string }
    if (ev.path === '/tmp/l') return { value: { kind: 'other', size: 0, mtimeMs: 1, isLink: true } } as never
    return next(e)
  })
}

async function denyOf($: Engine, on: On, id: string, input: Record<string, unknown>) {
  dangling(on)
  const sample = sampleSetup(on)
  await openSample($, sample)
  await editSample($)
  const agentId = await reviewer($, id)
  return (await callTool($, { ...input, agentId })).deny ?? ''
}

describe('0.9.0 vòng 2 J1: liên kết mềm treo và các dạng tạo liên kết', () => {
  test('Write vào liên kết treo /tmp/l: bị từ chối', SAMPLE_OPTS(), async ($, on) => {
    expect(await denyOf($, on, 'j1-1', { tool: 'Write', file_path: '/tmp/l', content: 'x' })).toContain('chỉ đọc')
  })
  test('Bash echo hi > /tmp/l (liên kết treo): bị từ chối', SAMPLE_OPTS(), async ($, on) => {
    expect(await denyOf($, on, 'j1-2', { tool: 'Bash', command: 'echo hi > /tmp/l' })).toContain('chỉ đọc')
  })
  for (const [k, command] of [
    ['3', 'ln -v -s /repo/src/new.ts /tmp/m && echo hi > /tmp/m'],
    ['4', '/bin/ln -s /repo/src/new.ts /tmp/m; echo hi > /tmp/m'],
    ['5', 'cp -s /repo/src/new.ts /tmp/m; echo hi > /tmp/m'],
  ] as const) {
    test(`tạo liên kết rồi ghi trong cùng lệnh: bị từ chối: ${command}`, SAMPLE_OPTS(), async ($, on) => {
      expect(await denyOf($, on, `j1-${k}`, { tool: 'Bash', command })).toContain('chỉ đọc')
    })
  }
  test('đối chứng: ghi tệp thường trong thư mục tạm: được chạy', SAMPLE_OPTS(), async ($, on) => {
    expect(await denyOf($, on, 'j1-6', { tool: 'Bash', command: 'echo hi > /tmp/ket-qua.txt' })).toBe('')
  })
})
