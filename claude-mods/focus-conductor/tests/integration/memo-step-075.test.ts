// 0.7.5 M2 (vòng sửa 2): khóa nhớ kết quả router chấm subagent giữ mã bước và mã việc (BƯỚC N, Việc N, mã mục như K4.10) nên hai bước
// khác nhau không dùng chung kết quả; kết quả nhớ không mang số việc đã phân (taskIndex) sang lời gọi khác.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { agentMemoKey } from '../../hooks/lib/route'
import { base, plan, submit, task } from '../support/engine'

const FANOUT = 'subagent; mỗi agent có chi phí riêng'
const agent = ($: Engine, description: string) => $.tool.call({ tool: 'Agent', description, prompt: `${description} trong codebase` } as never)

describe('0.7.5 M2: khóa nhớ giữ mã bước và mã việc', () => {
  test('cùng bước, khác số lô: cùng khóa; khác mã bước hay mã việc: khác khóa', () => {
    const key = (d: string) => agentMemoKey(d, undefined, undefined, undefined)
    expect(key('BƯỚC 3: lọc tin lô 1')).toBe(key('BƯỚC 3: lọc tin lô 77'))
    expect(key('BƯỚC 3: lọc tin lô 1')).not.toBe(key('BƯỚC 9: lọc tin lô 1'))
    expect(key('Bước 3 lọc tin lô 1')).not.toBe(key('Bước 4 lọc tin lô 1'))
    expect(key('Việc 2: đổi tên lô 3')).not.toBe(key('Việc 5: đổi tên lô 3'))
    expect(key('K4.10 kiểm số liệu')).not.toBe(key('K4.11 kiểm số liệu'))
    expect(key('Lọc tin lô 1')).toBe(key('Lọc tin lô 2'))
  })
})

describe('0.7.5 M2: kết quả nhớ không mang số việc đã phân', () => {
  test('router nhận ra lời gọi đầu là việc 1; 7 lời gọi cùng dạng sau đó không được tính là việc 1 (cảnh báo fan-out ra)', {}, async ($, on) => {
    const seen = base(on, {
      router: () => plan({ goal: 'Dọn dữ liệu', depth: 'hard', volume: 'large', tasks: [task('Chuẩn hóa đơn vị tính', 'agent', 'sonnet', 'medium')] }),
      agent: () => ({ why: 'khớp việc 1', task: 1, model: 'sonnet', effort: 'medium', agent: 'general-purpose', depth: 'light', volume: 'small', kind: 'edit' }),
    })
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'xong' }))
    await submit($, 'Dọn dữ liệu')
    for (let n = 1; n <= 8; n++) await agent($, `Dọn dữ liệu lô ${n}`)
    expect(seen.agentRouted.length).toBe(1)
    expect(seen.toasts.some(t => t.includes(FANOUT))).toBe(true)
  })
})
