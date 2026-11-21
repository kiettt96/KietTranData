// Mục tiêu mẫu của vòng 3 (lệnh kiểm đỏ từ nền): mục tiêu substantial loại edit, planApproval off, ba bước; bước 1 có lệnh
// `bash tests/kiem.sh` (đạt), bước 2 có lệnh `bunx tsc -p tsconfig.json` trả lỗi ngay lần chạy đầu. Dữ liệu là của mục tiêu mẫu.

import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { CHECK, PLAN_TOOL, callTool, closeAll, editSample, offerAgent, reviewSample, sampleGoal, sampleSetup, stopSample } from './closing-sample'
import type { Sample } from './closing-sample'
import { step, submit } from './engine'
import type { Json } from './engine'

export const TSC = 'bunx tsc -p tsconfig.json'
export const TSC_OUT = (count: number) => `src/a.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.\n\nFound ${count} errors in 2 files.\n`
export const BASE_STEPS = [{ title: 'Việc 1: tách hàm', check: `\`${CHECK}\`` }, { title: 'Việc 2: kiểu', check: `\`${TSC}\`` }, { title: 'Việc 3: báo cáo' }]
export const BASE_OPTS = (over: Json = {}) => ({ options: { planApproval: 'off', ...over } })

export type BaseSample = Sample & { count: number | null }
/** Dòng lỗi của tsc không kèm dòng tổng kết số đếm. */
export const TSC_NO_COUNT = "src/a.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.\n"
/**
 * Engine giả của mục tiêu mẫu; `tsc` trả lỗi với số đếm `count` (đổi được giữa các lần chạy): 0 là chạy đạt, null là lỗi không có dòng
 * tổng kết số đếm.
 */
export function baseSetup(on: On, reply: Json = sampleGoal()): BaseSample {
  const sample = sampleSetup(on, reply) as BaseSample
  sample.count = 27
  const out = () => (sample.count === 0 ? { text: '' } : { text: sample.count === null ? TSC_NO_COUNT : TSC_OUT(sample.count), isError: true })
  Object.defineProperty(sample.outputs, TSC, { get: out, enumerable: true, configurable: true })
  return sample
}
/** Mở mục tiêu mẫu với ba bước của vòng 3; `offer` false thì không mời agent nào (cổng đóng không áp). */
export async function baseOpen($: Engine, sample: Sample, steps: ReadonlyArray<Record<string, unknown>> = BASE_STEPS, offer = true) {
  if (offer) await offerAgent($)
  await submit($, 'Sửa thống kê')
  await $.tool.call({ tool: PLAN_TOOL, action: 'set', steps } as never)
  await $.turn.start({ text: 'Sửa thống kê', turnId: 't1' })
  await step($, sample.seen, { turnId: 't1' })
}
export const runTsc = ($: Engine) => callTool($, { tool: 'Bash', command: TSC })
export const runKiem = ($: Engine) => callTool($, { tool: 'Bash', command: CHECK })
export const stopActive = async ($: Engine) => String(((await $.classic.Stop({ stop_hook_active: true } as never)) as { block?: string }).block ?? '')
export { closeAll, editSample, reviewSample, stopSample }
