// 0.9.0 vòng 2 M12: `file -C` (ghi tệp magic đã biên dịch) và `rg --pre <lệnh>` (chạy lệnh bất kỳ) không còn là lệnh chỉ đọc; lượt
// "Kiểm độc lập: " chạy chúng ngoài thư mục tạm bị từ chối, `file <tệp>` và `rg <mẫu>` không cờ vẫn chạy. Engine 2.1.296 có
// `$.fs.stat(path, { resolve: true })` trả `realPath`: công cụ sửa file của vai chỉ đọc so theo đường dẫn thật, đích thật ngoài thư mục tạm
// thì từ chối.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { SAMPLE_OPTS, callTool, editSample, openSample, sampleSetup } from '../support/closing-sample'

async function reviewer($: Engine, id: string) {
  const description = 'Kiểm độc lập: thống kê'
  await $.tool.call({ tool: 'Agent', tool_use_id: id, description, prompt: 'Rà.' } as never)
  await $.agent.spawn({ prompt: 'Rà.', description, tool_use_id: id } as never)
  return `a-${id}`
}

describe('0.9.0 vòng 2 M12: lệnh ghi còn sót của vai chỉ đọc', () => {
  const cases: [string, boolean][] = [
    ['file -C -m /repo/magic', false],
    ['rg --pre ./tien-xu-ly.sh TODO /repo', false],
    ['rg --pre=./tien-xu-ly.sh TODO /repo', false],
    ['file /repo/thong-ke.sh', true],
    ['rg TODO /repo', true],
  ]
  cases.forEach(([command, allowed], i) => {
    test(`${allowed ? 'được chạy' : 'bị từ chối'}: ${command}`, SAMPLE_OPTS(), async ($, on) => {
      const sample = sampleSetup(on)
      await openSample($, sample)
      await editSample($)
      const id = await reviewer($, `m12-${i}`)
      const deny = (await callTool($, { tool: 'Bash', command, agentId: id })).deny
      if (allowed) expect(deny).toBeUndefined()
      else expect(deny ?? '').toContain('chỉ đọc')
    })
  })
  test('Write vào /tmp/ra-soat/lien-ket mà đích thật là /repo/thong-ke.sh: bị từ chối', SAMPLE_OPTS(), async ($, on) => {
    on('fs.stat', (_$, e, next) => {
      const ev = e as { path?: string }
      if (ev.path === '/tmp/ra-soat/lien-ket') return { value: { kind: 'file', size: 1, mtimeMs: 1, isLink: true, realPath: '/repo/thong-ke.sh' } } as never
      return next(e)
    })
    const sample = sampleSetup(on)
    await openSample($, sample)
    await editSample($)
    const id = await reviewer($, 'm12-link')
    const deny = (await callTool($, { tool: 'Write', file_path: '/tmp/ra-soat/lien-ket', content: 'x', agentId: id })).deny
    expect(deny ?? '').toContain('chỉ đọc')
  })
  test('Write vào /tmp/ra-soat/ghi-chu.txt không phải liên kết: được chạy', SAMPLE_OPTS(), async ($, on) => {
    const sample = sampleSetup(on)
    await openSample($, sample)
    await editSample($)
    const id = await reviewer($, 'm12-plain')
    expect((await callTool($, { tool: 'Write', file_path: '/tmp/ra-soat/ghi-chu.txt', content: 'x', agentId: id })).deny).toBeUndefined()
  })
})
