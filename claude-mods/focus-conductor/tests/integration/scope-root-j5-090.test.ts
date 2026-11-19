// 0.9.0 vòng 2, kiểm độc lập vòng 2 lỗi 7: thư mục `coverage` và `build` bị bỏ qua ở mọi độ sâu khi đo file mới, nên lượt có vai kiểm tạo
// `src/coverage/moi.ts` (thư mục mã nguồn thật tên coverage) không bị bắt. Hai tên này chỉ bỏ qua ở tầng ngay dưới gốc phạm vi.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { SAMPLE_OPTS, closeAll, editSample, openSample, runCheck, sampleSetup, stopSample } from '../support/closing-sample'

/** Cây /repo giả có thư mục con; `grow` thêm file vào một thư mục (tạo thư mục nếu chưa có). */
function treeFs(on: On) {
  const dirs = new Map<string, Map<string, number>>([['/repo', new Map([['thong-ke.sh', 1]])]])
  on('fs.list', (_$, e, next) => {
    const ev = e as { path?: string }
    const here = dirs.get(String(ev.path))
    if (here === undefined) return next(e)
    const kids = [...dirs.keys()].filter(d => d.startsWith(`${ev.path}/`) && !d.slice(String(ev.path).length + 1).includes('/')).map(d => ({ name: d.slice(String(ev.path).length + 1), kind: 'dir', size: 0, mtimeMs: 0, isLink: false }))
    return { value: [...[...here].map(([name, size]) => ({ name, kind: 'file', size, mtimeMs: size, isLink: false })), ...kids] } as never
  })
  return {
    grow: (dir: string, name: string) => {
      const parts = dir.split('/')
      for (let k = 2; k <= parts.length; k++) if (!dirs.has(parts.slice(0, k).join('/'))) dirs.set(parts.slice(0, k).join('/'), new Map())
      const here = dirs.get(dir) as Map<string, number>
      here.set(name, (here.get(name) ?? 0) + 3)
    },
  }
}
async function reviewRun($: Engine, id: string, onRun: () => void, answer: string) {
  const description = 'Kiểm độc lập: thống kê'
  await $.tool.call({ tool: 'Agent', tool_use_id: id, description, prompt: 'Rà.' } as never)
  await $.agent.spawn({ prompt: 'Rà.', description, tool_use_id: id } as never)
  await $.tool.call({ tool: 'Bash', command: 'python3 tao.py', agentId: `a-${id}` } as never)
  onRun()
  await $.turn.complete({ turnId: `x-${id}`, agentId: `a-${id}`, answer, durationMs: 5, isAborted: false, reason: 'answer', usage: { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 10 } } as never)
}

describe('0.9.0 vòng 2 J5: coverage và build chỉ bỏ qua ở gốc phạm vi', () => {
  for (const dir of ['/repo/src/coverage', '/repo/src/build']) {
    test(`lượt duyệt tạo ${dir}/moi.ts: cổng vẫn chặn`, SAMPLE_OPTS(), async ($, on) => {
      const fs = treeFs(on)
      const sample = sampleSetup(on)
      await openSample($, sample)
      await editSample($)
      await runCheck($)
      await closeAll($)
      await reviewRun($, `j5-${dir.length}`, () => fs.grow(dir, 'moi.ts'), 'ĐẠT')
      expect(await stopSample($)).toContain('moi.ts')
    })
  }
  test('đối chứng: lượt duyệt sinh /repo/coverage/lcov.info: cổng cho qua', SAMPLE_OPTS(), async ($, on) => {
    const fs = treeFs(on)
    const sample = sampleSetup(on)
    await openSample($, sample)
    await editSample($)
    await runCheck($)
    await closeAll($)
    await reviewRun($, 'j5-goc', () => fs.grow('/repo/coverage', 'lcov.info'), 'ĐẠT')
    expect(await stopSample($)).toBe('')
  })
})
