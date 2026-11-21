// 0.9.0 vòng 3 N5: bước Kiểm của cổng đóng và của pane không chuyển sang chưa đạt vì lệnh đỏ từ nền; lần chạy đỏ đó không được tính là lần
// kiểm đạt ở cổng nào và không làm bằng chứng cho verified. A1 (tsc chạy lại đỏ ở luồng chính) và D (subagent "Kiểm độc lập: " chạy lại tsc
// đỏ) có lượt duyệt ĐẠT: lần Stop đầu chỉ còn lần đòi của N4, lần sau rỗng. Chỉ có lệnh đỏ từ nền, không lệnh nào đạt sau thay đổi cuối: vẫn
// bị chặn vì chưa có lần kiểm đạt, như trước sửa.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { BASE_OPTS, TSC, baseOpen, baseSetup, closeAll, editSample, reviewSample, runKiem, runTsc, stopSample } from '../support/baseline-red'
import { PLAN_TOOL, paneText } from '../support/closing-sample'

const NO_PASS = 'chưa có lần kiểm đạt sau thay đổi cuối'
const PANE_FAIL = 'Lần kiểm gần nhất chưa đạt'
/** Kết quả plan update verified trên lần chạy tsc đỏ, đo trên mã trước bản sửa (2e3c736 cộng N4). */
const VERIFIED = "Checklist (1/3 đã đóng):\n[x] 2. Việc 2: kiểu [nghiệm thu: `bunx tsc -p tsconfig.json`] (bunx tsc -p tsconfig.json: Found 27 errors)\nBước tiếp theo: 1. Việc 1: tách hàm\n[focus-conductor] Bước được lưu là done, chưa tính là đã kiểm tra: lệnh kiểm tra `bunx tsc -p tsconfig.json` đã lỗi hoặc không xác nhận được là đạt. Kiểm theo cách người dùng quy định (lệnh kiểm có sẵn của dự án hay của prompt, đọc lại kết quả) sau thay đổi cuối cùng; không tạo test hay script kiểm mới nếu người dùng không yêu cầu. Lệnh kiểm mod nhận ra (trình chạy test, lệnh kiểm riêng người dùng đã khai cho mod; kiểm tĩnh như type-check, lint, build không tính) chạy đạt thì mod tự nâng bước done thành verified, không cần chép lệnh vào evidence. Việc chỉ đọc, chưa sửa gì thì nêu lệnh hay file đã đọc.\n[focus-conductor] Tiêu chí nghiệm thu của bước 2: `bunx tsc -p tsconfig.json`. Đối chiếu bằng chứng với tiêu chí này; chưa đạt thì mở lại bước (doing)."

/** Lượt "Kiểm độc lập: " (opus) chạy lại tsc trong subagent rồi trả ĐẠT. */
async function reviewTsc($: Engine) {
  const id = 'r1'
  const description = 'Kiểm độc lập: thống kê'
  await $.tool.call({ tool: 'Agent', tool_use_id: id, description, prompt: 'Rà.' } as never)
  await $.agent.spawn({ prompt: 'Rà.', description, tool_use_id: id } as never)
  await $.tool.call({ tool: 'Bash', command: TSC, agentId: `a-${id}` } as never)
  await $.turn.complete({ turnId: `x-${id}`, agentId: `a-${id}`, answer: 'ĐẠT', durationMs: 5, isAborted: false, reason: 'answer', usage: { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 10 } } as never)
}

describe('0.9.0 vòng 3 N5: cổng đóng bỏ qua lệnh đỏ từ nền', () => {
  test('A1: kiem đạt sau sửa, tsc chạy lại đỏ, duyệt ĐẠT: pane không ghi lần kiểm chưa đạt, Stop đầu không đòi lần kiểm đạt, Stop sau rỗng', BASE_OPTS(), async ($, on) => {
    const sample = baseSetup(on)
    await baseOpen($, sample)
    await runTsc($)
    await editSample($)
    await runKiem($)
    await runTsc($)
    await closeAll($)
    await reviewSample($)
    expect(await paneText($)).not.toContain(PANE_FAIL)
    expect(await stopSample($)).not.toContain(NO_PASS)
    expect(await stopSample($)).toBe('')
  })

  test('D: subagent Kiểm độc lập chạy lại tsc đỏ rồi trả ĐẠT: pane không ghi lần kiểm chưa đạt, Stop đầu không đòi lần kiểm đạt, Stop sau rỗng', BASE_OPTS(), async ($, on) => {
    const sample = baseSetup(on)
    await baseOpen($, sample)
    await runTsc($)
    await editSample($)
    await runKiem($)
    await closeAll($)
    await reviewTsc($)
    expect(await paneText($)).not.toContain(PANE_FAIL)
    expect(await stopSample($)).not.toContain(NO_PASS)
    expect(await stopSample($)).toBe('')
  })

  test('chỉ có lệnh đỏ từ nền, không lệnh nào đạt sau thay đổi cuối: vẫn bị chặn vì chưa có lần kiểm đạt', BASE_OPTS(), async ($, on) => {
    const sample = baseSetup(on)
    await baseOpen($, sample)
    await runTsc($)
    await editSample($)
    await runTsc($)
    await closeAll($)
    await reviewSample($)
    expect(await stopSample($)).toContain(NO_PASS)
  })

  test('plan update verified dựa trên lần chạy tsc đỏ từ nền: kết quả giống hệt trước sửa', BASE_OPTS(), async ($, on) => {
    const sample = baseSetup(on)
    await baseOpen($, sample)
    await runTsc($)
    await editSample($)
    await runTsc($)
    const out = (await $.tool.call({ tool: PLAN_TOOL, action: 'update', step: 2, status: 'verified', evidence: `${TSC}: Found 27 errors` } as never)) as { result?: string }
    expect(out.result).toBe(VERIFIED)
  })
})
