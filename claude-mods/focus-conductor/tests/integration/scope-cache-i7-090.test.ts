// 0.9.0 vòng 2, kiểm độc lập vòng 1 lỗi 8: phép đo file mới của M13 tính cả file do chính lệnh kiểm sinh ra (`__pycache__`,
// `.pytest_cache`) và tệp nhật ký quyết định mà mod ghi lại trong lúc lượt duyệt chạy, nên lượt duyệt chạy pytest không bao giờ được tính.

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

describe('0.9.0 vòng 2 I7: file do lệnh kiểm và do mod sinh ra', () => {
  test('lượt duyệt chạy pytest sinh __pycache__ và .pytest_cache rồi trả ĐẠT: cổng cho qua', SAMPLE_OPTS(), async ($, on) => {
    const fs = treeFs(on)
    const sample = sampleSetup(on)
    await openSample($, sample)
    await editSample($)
    await runCheck($)
    await closeAll($)
    await reviewRun($, 'i7a', () => {
      fs.grow('/repo/tests/__pycache__', 'test_a.cpython-312.pyc')
      fs.grow('/repo/.pytest_cache/v/cache', 'nodeids')
    }, 'ĐẠT')
    expect(await stopSample($)).toBe('')
  })

  test('tệp nhật ký quyết định trong dự án đổi trong lúc lượt duyệt chạy: cổng cho qua', SAMPLE_OPTS({ decisionLog: '/repo/quyet-dinh.jsonl' }), async ($, on) => {
    const fs = treeFs(on)
    const sample = sampleSetup(on)
    await openSample($, sample)
    await editSample($)
    await runCheck($)
    await closeAll($)
    fs.grow('/repo', 'quyet-dinh.jsonl')
    await reviewRun($, 'i7b', () => fs.grow('/repo', 'quyet-dinh.jsonl'), 'ĐẠT')
    expect(await stopSample($)).toBe('')
  })

  test('đối chứng: lượt duyệt tạo /repo/src/moi.ts: cổng vẫn chặn', SAMPLE_OPTS(), async ($, on) => {
    const fs = treeFs(on)
    const sample = sampleSetup(on)
    await openSample($, sample)
    await editSample($)
    await runCheck($)
    await closeAll($)
    await reviewRun($, 'i7c', () => fs.grow('/repo/src', 'moi.ts'), 'ĐẠT')
    expect(await stopSample($)).toContain('moi.ts')
  })
})
