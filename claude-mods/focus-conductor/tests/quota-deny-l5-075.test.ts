// 0.7.5 L5 (vòng sửa 2): câu từ chối khi dừng có pauseAllowPaths nêu đường dẫn được ghi TRƯỚC, rồi mới "Không gọi tool nào khác";
// câu về đường dẫn đủ chữ (Bash có mọi đường dẫn đích nằm trong danh sách đó). Không có pauseAllowPaths và subagent: như cũ.

import { describe, expect, test } from 'claude-code/testing'
import { quotaDenyText } from '../hooks/lib/text'

const REASONS = [{ kind: 'five_hour' as const, percentUsed: 97, thresholdRemainingPct: 5 }]
const PATHS = ['.checkpoint/', '/tmp/ck']

describe('0.7.5 L5: câu từ chối có pauseAllowPaths', () => {
  test('đường dẫn được ghi đứng trước "Không gọi tool nào khác"', () => {
    const text = quotaDenyText(REASONS, false, false, PATHS)
    expect(text).toContain('pauseAllowPaths: .checkpoint/, /tmp/ck')
    expect(text.indexOf('pauseAllowPaths: .checkpoint/, /tmp/ck')).toBeLessThan(text.indexOf('Không gọi tool nào khác'))
    expect(text).toContain('Không gọi tool nào khác')
  })

  test('câu về đường dẫn đủ chữ: Write, Edit, Bash có mọi đường dẫn đích nằm trong danh sách đó', () => {
    const text = quotaDenyText(REASONS, false, false, PATHS)
    expect(text).toContain('Được ghi vào các đường dẫn của pauseAllowPaths: .checkpoint/, /tmp/ck (bằng Write, Edit, hay Bash có mọi đường dẫn đích nằm trong danh sách đó)')
  })

  test('"Không gọi tool nào khác" nói rõ ngoại lệ là các đường dẫn đó, rồi tới hướng dẫn checkpoint', () => {
    const text = quotaDenyText(REASONS, false, false, PATHS)
    expect(text.indexOf('Không gọi tool nào khác')).toBeLessThan(text.indexOf('action "checkpoint"'))
    expect(text).toContain('Không gọi tool nào khác ngoài việc ghi vào các đường dẫn đó và tool plan')
  })
})

describe('0.7.5 L5: các trường hợp còn lại giữ nguyên', () => {
  test('không có pauseAllowPaths: "Không gọi tool nào khác." đứng ngay sau lý do, không nhắc pauseAllowPaths', () => {
    const text = quotaDenyText(REASONS, false, false)
    expect(text).toContain('. Không gọi tool nào khác. Gọi ')
    expect(text).not.toContain('pauseAllowPaths')
  })

  test('subagent: kết thúc ngay, không nhắc pauseAllowPaths', () => {
    const text = quotaDenyText(REASONS, false, true, PATHS)
    expect(text).toContain('Subagent không gọi tool nào khác')
    expect(text).not.toContain('pauseAllowPaths')
  })
})
