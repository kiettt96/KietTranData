// 0.9.0 vòng 2, U7: tiêu đề mục "Tiến độ từng việc" không có phần đếm khi mục tiêu không có việc đã phân (chỉ có việc Claude tự giao).

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { PANE, task } from '../support/engine'
import { SAMPLE_OPTS, editSample, openSample, sampleGoal, sampleSetup } from '../support/closing-sample'

/** Dòng tiêu đề của mục tiến độ từng việc ở `columns` cột (mount rồi gỡ). */
async function taskHeading($: Engine, columns: number): Promise<string> {
  const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: columns, scroll: { offset: 0, bodyRows: 40 } } } as never)
  const texts = (await pane.findAll({ type: 'Text' })).map(e => e.text ?? '')
  await pane.unmount()
  return texts.find(text => text.includes('Tiến độ từng việc')) ?? ''
}
async function startReview($: Engine) {
  const description = 'Kiểm độc lập: thống kê'
  await $.tool.call({ tool: 'Agent', tool_use_id: 'r1', description, prompt: 'Rà.' } as never)
  await $.agent.spawn({ prompt: 'Rà.', description, tool_use_id: 'r1' } as never)
}

describe('0.9.0 vòng 2 U7: tiêu đề Tiến độ từng việc', () => {
  test('không có việc đã phân, một lượt "Kiểm độc lập: " đang chạy: tiêu đề không kèm "0/0" ở 80 và 44 cột', SAMPLE_OPTS(), async ($, on) => {
    const sample = sampleSetup(on)
    await openSample($, sample)
    await editSample($)
    await startReview($)
    for (const columns of [80, 44]) {
      const heading = await taskHeading($, columns)
      expect(heading, `${columns} cột`).not.toBe('')
      expect(heading, `${columns} cột`).not.toContain('0/0')
    }
  })
  test('mục tiêu có việc đã phân: tiêu đề còn phần đếm như trước', SAMPLE_OPTS(), async ($, on) => {
    const sample = sampleSetup(on, sampleGoal({ tasks: [task('Việc 1: tách hàm', 'agent', 'sonnet', 'medium'), task('Việc 2: thêm cờ', 'main', 'sonnet', 'medium')] }))
    await openSample($, sample)
    await editSample($)
    await startReview($)
    expect(await taskHeading($, 80)).toContain('0/2')
    expect(await taskHeading($, 44)).toContain('0/2')
  })
})
