// 0.9.0 vòng 3 N10: toàn luồng của lệnh kiểm đỏ từ nền, dùng nguyên văn đầu ra thật của `bunx tsc -p tsconfig.json` trên mã của PR này (27
// lỗi có sẵn, tests/fixtures/tsc-head-090.ts). Nền có lệnh đỏ, sửa, lệnh của bước đạt, tsc chạy lại cùng đầu ra, subagent "Kiểm độc lập: "
// chạy lại tsc rồi trả nhãn kết luận chen từ, Stop lần một chặn đúng một lần với lý do của N4, Stop lần hai rỗng; pane và /conductor status
// có dòng của N7. Phủ N1, N2, N3, N4, N5, N7, N8.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { BASE_OPTS, TSC, baseOpen, baseSetup, closeAll, editSample, runKiem, runTsc, stopSample } from '../support/baseline-red'
import { paneText, runCommand } from '../support/closing-sample'
import { TSC_HEAD_090 } from '../fixtures/tsc-head-090'

const ANSWER = 'Kết luận kiểm độc lập: đạt kèm lỗi nhẹ (1 lỗi nhẹ)'

/** Lượt "Kiểm độc lập: " (opus) chạy lại tsc trong subagent rồi trả ANSWER. */
async function reviewTsc($: Engine) {
  const id = 'f1'
  const description = 'Kiểm độc lập: thống kê'
  await $.tool.call({ tool: 'Agent', tool_use_id: id, description, prompt: 'Rà.' } as never)
  await $.agent.spawn({ prompt: 'Rà.', description, tool_use_id: id } as never)
  await $.tool.call({ tool: 'Bash', command: TSC, agentId: `a-${id}` } as never)
  await $.turn.complete({ turnId: `x-${id}`, agentId: `a-${id}`, answer: ANSWER, durationMs: 5, isAborted: false, reason: 'answer', usage: { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 10 } } as never)
}

describe('0.9.0 vòng 3 N10: toàn luồng lệnh kiểm đỏ từ nền', () => {
  test('nền tsc đỏ (đầu ra thật), sửa, kiểm, duyệt, kết thúc', BASE_OPTS(), async ($, on) => {
    const sample = baseSetup(on)
    Object.defineProperty(sample.outputs, TSC, { get: () => ({ text: TSC_HEAD_090, isError: true }), enumerable: true, configurable: true })
    await baseOpen($, sample)
    const first = await runTsc($)
    expect((first.context ?? []).some(line => line.includes('đỏ từ trước khi có thay đổi'))).toBe(true)
    await editSample($)
    await runKiem($)
    const again = await runTsc($)
    expect((again.context ?? []).join('\n')).not.toContain('Sửa lỗi kiểm: ')
    await closeAll($)
    await reviewTsc($)
    const pane = await paneText($, 40, 80)
    expect(pane).toContain(`đỏ từ nền: \`${TSC}\``)
    expect(pane).toContain('Duyệt: đạt')
    const status = await runCommand($, 'status')
    expect(status).toContain('Lệnh kiểm đỏ từ nền')
    const once = await stopSample($)
    expect(once).toContain('Lệnh kiểm đỏ từ nền')
    expect(once).not.toContain('Còn lệnh kiểm chưa đạt')
    expect(once).not.toContain('chưa có lần kiểm đạt')
    expect(once).not.toContain('chưa có duyệt độc lập')
    expect(await stopSample($)).toBe('')
  })
})
