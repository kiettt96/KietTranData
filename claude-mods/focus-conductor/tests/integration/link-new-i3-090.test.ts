// 0.9.0 vòng 2, kiểm độc lập vòng 1 lỗi 3: vai chỉ đọc ghi qua liên kết mềm khi tệp đích chưa có (stat từ chối nên không có realPath) hay
// khi liên kết được tạo ngay trong cùng lệnh. Tệp chưa có thì giải thư mục cha rồi nối tên, như khai báo kiểu của engine chỉ dẫn; lệnh vừa
// tạo liên kết mềm vừa ghi mức definite thì không kiểm được đích thật nên từ chối.

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

/** /tmp/ra-soat/thu-muc là liên kết mềm tới /repo/src; tệp bên trong chưa có nên stat của chính tệp bị từ chối. */
function linkedDir(on: On) {
  on('fs.stat', (_$, e, next) => {
    const ev = e as { path?: string }
    if (ev.path === '/tmp/ra-soat/thu-muc') return { value: { kind: 'dir', size: 0, mtimeMs: 1, isLink: true, realPath: '/repo/src' } } as never
    if (ev.path?.startsWith('/tmp/ra-soat/thu-muc/')) throw new Error('ENOENT: no such file or directory')
    return next(e)
  })
}

describe('0.9.0 vòng 2 I3: liên kết mềm tới đích chưa có', () => {
  test('Write tệp mới trong thư mục liên kết tới /repo/src: bị từ chối', SAMPLE_OPTS(), async ($, on) => {
    linkedDir(on)
    const sample = sampleSetup(on)
    await openSample($, sample)
    await editSample($)
    const id = await reviewer($, 'i3-1')
    const deny = (await callTool($, { tool: 'Write', file_path: '/tmp/ra-soat/thu-muc/moi.ts', content: 'x', agentId: id })).deny
    expect(deny ?? '').toContain('chỉ đọc')
  })

  test('Bash ghi tệp mới trong thư mục liên kết tới /repo/src: bị từ chối', SAMPLE_OPTS(), async ($, on) => {
    linkedDir(on)
    const sample = sampleSetup(on)
    await openSample($, sample)
    await editSample($)
    const id = await reviewer($, 'i3-2')
    const deny = (await callTool($, { tool: 'Bash', command: 'echo x > /tmp/ra-soat/thu-muc/moi.ts', agentId: id })).deny
    expect(deny ?? '').toContain('chỉ đọc')
  })

  test('Bash tạo liên kết mềm rồi ghi qua nó trong cùng lệnh: bị từ chối', SAMPLE_OPTS(), async ($, on) => {
    const sample = sampleSetup(on)
    await openSample($, sample)
    await editSample($)
    const id = await reviewer($, 'i3-3')
    const deny = (await callTool($, { tool: 'Bash', command: 'ln -sf /repo/thong-ke.sh /tmp/l && echo x > /tmp/l', agentId: id })).deny
    expect(deny ?? '').toContain('chỉ đọc')
  })

  test('đối chứng: ghi tệp mới trong thư mục tạm thường: được chạy', SAMPLE_OPTS(), async ($, on) => {
    linkedDir(on)
    const sample = sampleSetup(on)
    await openSample($, sample)
    await editSample($)
    const id = await reviewer($, 'i3-4')
    expect((await callTool($, { tool: 'Bash', command: 'echo x > /tmp/ra-soat/ket-qua.txt', agentId: id })).deny).toBeUndefined()
    expect((await callTool($, { tool: 'Write', file_path: '/tmp/ra-soat/ket-qua.txt', content: 'x', agentId: id })).deny).toBeUndefined()
  })
})
