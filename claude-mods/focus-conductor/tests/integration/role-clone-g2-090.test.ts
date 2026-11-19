// 0.9.0 vòng 2, G2: vai chỉ đọc (lượt "Kiểm độc lập: ") chạy được git clone có đích là đường dẫn tuyệt đối trong thư mục tạm; đích ngoài thư
// mục tạm vẫn bị từ chối; git clone không nêu đích giữ kết quả như trước. Lệnh tái hiện lấy từ kiểm độc lập lần 1 của vòng 2 (dòng K2).

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { SAMPLE_OPTS, callTool, editSample, openSample, sampleSetup } from '../support/closing-sample'

async function reviewer($: Engine, id: string) {
  const description = 'Kiểm độc lập: thống kê'
  await $.tool.call({ tool: 'Agent', tool_use_id: id, description, prompt: 'Rà.' } as never)
  await $.agent.spawn({ prompt: 'Rà.', description, tool_use_id: id } as never)
  return `a-${id}`
}

describe('0.9.0 vòng 2 G2: git clone của vai chỉ đọc vào thư mục tạm', () => {
  test('hai lệnh tái hiện được chạy: đích tuyệt đối trong /tmp và trong thư mục mktemp', SAMPLE_OPTS(), async ($, on) => {
    const sample = sampleSetup(on)
    await openSample($, sample)
    await editSample($)
    const id = await reviewer($, 'g2a')
    expect((await callTool($, { tool: 'Bash', command: 'git clone -q /repo /tmp/ra-soat/r', agentId: id })).deny).toBeUndefined()
    expect((await callTool($, { tool: 'Bash', command: 'D=$(mktemp -d) && git clone -q /repo "$D/r"', agentId: id })).deny).toBeUndefined()
  })
  test('đích ngoài thư mục tạm vẫn bị từ chối', SAMPLE_OPTS(), async ($, on) => {
    const sample = sampleSetup(on)
    await openSample($, sample)
    await editSample($)
    const id = await reviewer($, 'g2b')
    expect((await callTool($, { tool: 'Bash', command: 'git clone -q /repo /repo/ban-sao', agentId: id })).deny ?? '').toContain('chỉ đọc')
  })
  test('git clone không nêu đích: giữ kết quả như trước bản sửa', SAMPLE_OPTS(), async ($, on) => {
    const sample = sampleSetup(on)
    await openSample($, sample)
    await editSample($)
    const id = await reviewer($, 'g2c')
    // Đo trên mã trước bản sửa: bị từ chối với câu của vai duyệt chỉ đọc (bộ phân loại không đọc được đích).
    expect((await callTool($, { tool: 'Bash', command: 'git clone -q /repo', agentId: id })).deny ?? '').toContain('Vai duyệt chỉ đọc')
  })
})

// G2b (kiểm độc lập vòng 2 lần 2): chỉ nhận git clone khi mọi tùy chọn thuộc danh sách cho phép, đích là đối số vị trí cuối cùng và là
// đường dẫn tuyệt đối trong thư mục tạm; mọi dạng khác bị từ chối như trên main.
describe('0.9.0 vòng 2 G2b: git clone chỉ với tùy chọn cho phép', () => {
  const cases: [string, boolean][] = [
    ['git clone --depth 1 /tmp/src /repo/dst', false],
    ['git clone --depth 1 /repo /tmp/x/r', true],
    ['git clone --separate-git-dir /repo/g /tmp/src /tmp/x/r', false],
    ['git clone --tuy-chon-la v /tmp/src /tmp/x/r', false],
    ['git clone -b main /tmp/src /tmp/x/r', true],
    ['git clone /tmp/src', false],
  ]
  cases.forEach(([command, allowed], i) => {
    test(`${allowed ? 'được chạy' : 'bị từ chối'}: ${command}`, SAMPLE_OPTS(), async ($, on) => {
      const sample = sampleSetup(on)
      await openSample($, sample)
      await editSample($)
      const id = await reviewer($, `g2b${i}`)
      const deny = (await callTool($, { tool: 'Bash', command, agentId: id })).deny
      if (allowed) expect(deny).toBeUndefined()
      else expect(deny ?? '').toContain('chỉ đọc')
    })
  })
})
