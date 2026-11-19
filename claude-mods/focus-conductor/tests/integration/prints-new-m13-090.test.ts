// 0.9.0 vòng 2 M13: engine 2.1.296 có `$.fs.list`. Mod chụp danh sách file của phạm vi mục tiêu trước và sau mỗi lượt có vai chỉ đọc (và vai
// kiểm); file mới ngoài thư mục tạm làm kết luận của lượt đó không được tính, kèm cảnh báo nêu tên file. File mới trong thư mục tạm không
// ảnh hưởng.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { SAMPLE_OPTS, callTool, closeAll, editSample, openSample, runCheck, sampleSetup, stopSample } from '../support/closing-sample'

/** Thư mục /repo giả: tệp có sẵn, cộng tệp mà lệnh `python3 tao.py` tạo ra. */
function repoFs(on: On, created: string) {
  const entries = new Set(['thong-ke.sh', 'README.md'])
  on('fs.list', (_$, e, next) => {
    const ev = e as { path?: string }
    if (ev.path === '/repo') return { value: [...entries].map(name => ({ name, kind: 'file', size: 1, mtimeMs: 1, isLink: false })) } as never
    return next(e)
  })
  return { create: () => entries.add(created) }
}
async function reviewRun($: Engine, id: string, onRun: () => void, answer: string) {
  const description = 'Kiểm độc lập: thống kê'
  await $.tool.call({ tool: 'Agent', tool_use_id: id, description, prompt: 'Rà.' } as never)
  await $.agent.spawn({ prompt: 'Rà.', description, tool_use_id: id } as never)
  await $.tool.call({ tool: 'Bash', command: 'python3 tao.py', agentId: `a-${id}` } as never)
  onRun()
  await $.turn.complete({ turnId: `x-${id}`, agentId: `a-${id}`, answer, durationMs: 5, isAborted: false, reason: 'answer', usage: { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 10 } } as never)
}

describe('0.9.0 vòng 2 M13: dấu file phủ file mới', () => {
  test('lượt duyệt tạo /repo/moi.txt bằng lệnh mức possible rồi trả ĐẠT: cổng vẫn đòi duyệt, lý do nêu moi.txt', SAMPLE_OPTS(), async ($, on) => {
    const fs = repoFs(on, 'moi.txt')
    const sample = sampleSetup(on)
    await openSample($, sample)
    await editSample($)
    await runCheck($)
    await closeAll($)
    await reviewRun($, 'm13a', fs.create, 'ĐẠT')
    const block = await stopSample($)
    expect(block).toContain('duyệt độc lập')
    expect(block).toContain('moi.txt')
  })
  test('file mới chỉ trong thư mục tạm: không ảnh hưởng, cổng cho qua', SAMPLE_OPTS(), async ($, on) => {
    repoFs(on, 'khong-dung.txt')
    const sample = sampleSetup(on)
    await openSample($, sample)
    await editSample($)
    await runCheck($)
    await closeAll($)
    await reviewRun($, 'm13b', () => undefined, 'ĐẠT')
    expect(await stopSample($)).toBe('')
  })
})
