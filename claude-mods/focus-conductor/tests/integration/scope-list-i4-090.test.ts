// 0.9.0 vòng 2, kiểm độc lập vòng 1 lỗi 4 và 11: phép đo file mới của M13 tắt cả lượt khi phạm vi có một mục là file (hay đường dẫn chưa có),
// vì một lần `$.fs.list` bị từ chối làm cả danh sách null; và bản chụp trước lượt chỉ được xoá khi có câu trả lời của mục tiêu đang mở, nên đủ
// 100 lượt không hoàn tất thì M13 tắt cho phần còn lại của tiến trình.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { SAMPLE_OPTS, callTool, closeAll, editSample, openSample, runCheck, sampleGoal, sampleSetup, stopSample } from '../support/closing-sample'

/** Thư mục /repo giả: tệp có sẵn, cộng tệp mà lệnh `python3 tao.py` tạo ra. */
function repoFs(on: On, created: string, notDir = '') {
  const entries = new Map([['thong-ke.sh', 1], ['README.md', 1]])
  on('fs.list', (_$, e, next) => {
    const ev = e as { path?: string }
    if (notDir !== '' && ev.path === notDir) throw new Error('ENOTDIR: not a directory')
    if (ev.path === '/repo') return { value: [...entries].map(([name, size]) => ({ name, kind: 'file', size, mtimeMs: size, isLink: false })) } as never
    return next(e)
  })
  return { create: () => entries.set(created, 1), touch: (name: string) => entries.set(name, (entries.get(name) ?? 0) + 7) }
}
async function reviewRun($: Engine, id: string, onRun: () => void, answer: string) {
  const description = 'Kiểm độc lập: thống kê'
  await $.tool.call({ tool: 'Agent', tool_use_id: id, description, prompt: 'Rà.' } as never)
  await $.agent.spawn({ prompt: 'Rà.', description, tool_use_id: id } as never)
  await $.tool.call({ tool: 'Bash', command: 'python3 tao.py', agentId: `a-${id}` } as never)
  onRun()
  await $.turn.complete({ turnId: `x-${id}`, agentId: `a-${id}`, answer, durationMs: 5, isAborted: false, reason: 'answer', usage: { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 10 } } as never)
}

describe('0.9.0 vòng 2 I4: phép đo file mới không tắt lặng lẽ', () => {
  test('phạm vi có một mục là file và một thư mục: lượt duyệt tạo /repo/moi.txt vẫn bị bắt', SAMPLE_OPTS(), async ($, on) => {
    const fs = repoFs(on, 'moi.txt', '/repo/thong-ke.sh')
    const sample = sampleSetup(on, sampleGoal({ scope: ['/repo/thong-ke.sh', '/repo'] }))
    await openSample($, sample)
    await editSample($)
    await runCheck($)
    await closeAll($)
    await reviewRun($, 'i4a', fs.create, 'ĐẠT')
    const block = await stopSample($)
    expect(block).toContain('duyệt độc lập')
    expect(block).toContain('moi.txt')
  })

  test('100 lượt duyệt không hoàn tất trước đó: lượt mới tạo /repo/moi.txt vẫn bị bắt', SAMPLE_OPTS(), async ($, on) => {
    const fs = repoFs(on, 'moi.txt')
    const sample = sampleSetup(on)
    await openSample($, sample)
    await editSample($)
    await runCheck($)
    await closeAll($)
    for (let k = 0; k < 100; k++) {
      const description = 'Kiểm độc lập: thống kê'
      await $.tool.call({ tool: 'Agent', tool_use_id: `bo-${k}`, description, prompt: 'Rà.' } as never)
      await $.agent.spawn({ prompt: 'Rà.', description, tool_use_id: `bo-${k}` } as never)
    }
    await reviewRun($, 'i4b', fs.create, 'ĐẠT')
    expect(await stopSample($)).toContain('moi.txt')
  })
})
