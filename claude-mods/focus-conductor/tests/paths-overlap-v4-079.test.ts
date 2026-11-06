// 0.7.9 vòng 2 V4: hai phần của một việc tách sửa chung file khi đường dẫn của chúng giao nhau sau khi chuẩn hóa: glob giao với mọi đường
// dẫn dưới phần thư mục trước ký tự glob đầu tiên; đường dẫn tuyệt đối dưới thư mục gốc phiên đổi thành tương đối (không biết gốc thì cùng
// đuôi là giao); `.` và `..` được giải; không phân biệt hoa thường.

import { describe, expect, test } from 'claude-code/testing'
import { parseRoute, pathsOverlap } from '../hooks/lib/router'
import type { Policy, RouterPlan } from '../hooks/lib/router'
import { plan, task } from './support/engine'

const POLICY: Policy = { allowFable: false, blocked: new Set(), session: null, forks: 3 }

describe('0.7.9 V4: bốn dạng đường dẫn giao nhau', () => {
  test('glob: src/*.ts và src/a.ts', () => expect(pathsOverlap('src/*.ts', 'src/a.ts')).toBe(true))
  test('glob ở giữa: src/**/a.ts và src/x/a.ts', () => expect(pathsOverlap('src/**/a.ts', 'src/x/a.ts')).toBe(true))
  test('tuyệt đối và tương đối, biết gốc: /repo/src/a.ts và src/a.ts', () => expect(pathsOverlap('/repo/src/a.ts', 'src/a.ts', '/repo')).toBe(true))
  test('tuyệt đối và tương đối, không biết gốc: cùng đuôi là giao', () => expect(pathsOverlap('/repo/src/a.ts', 'src/a.ts')).toBe(true))
  test('có ..: src/../lib/a.ts và lib/a.ts', () => expect(pathsOverlap('src/../lib/a.ts', 'lib/a.ts')).toBe(true))
  test('khác hoa thường: Src/A.ts và src/a.ts', () => expect(pathsOverlap('Src/A.ts', 'src/a.ts')).toBe(true))
})

describe('0.7.9 V4: các ca không giao giữ nguyên', () => {
  test('a/b và a/bc', () => expect(pathsOverlap('a/b', 'a/bc')).toBe(false))
  test('src/a.ts và lib/a.ts', () => expect(pathsOverlap('src/a.ts', 'lib/a.ts')).toBe(false))
  test('glob khác thư mục: lib/*.ts và src/a.ts', () => expect(pathsOverlap('lib/*.ts', 'src/a.ts')).toBe(false))
  test('tuyệt đối ngoài gốc phiên: /other/src/a.ts và src/a.ts với gốc /repo', () => expect(pathsOverlap('/other/src/a.ts', 'src/a.ts', '/repo')).toBe(false))
  test('src/pay và src/payment', () => expect(pathsOverlap('src/pay', 'src/payment')).toBe(false))
})

describe('0.7.9 V4: parseRoute bỏ split có hai phần sửa chung file theo gốc phiên', () => {
  test('/repo/src/pay/a.ts và src/pay/a.ts với gốc /repo: split bị bỏ', () => {
    const reply = plan({
      goal: 'Đổi tên hàm tính phí',
      depth: 'substantial',
      volume: 'large',
      main: { model: 'sonnet', effort: 'medium' },
      tasks: [
        task('Đổi tên hàm tính phí', 'main', 'sonnet', 'medium', {
          depth: 'substantial',
          volume: 'large',
          split: [
            { title: 'Module thanh toán', files: ['/repo/src/pay/a.ts'] },
            { title: 'Module kho', files: ['src/pay/a.ts'] },
          ],
        }),
      ],
    })
    const parsed = parseRoute(JSON.stringify(reply), { ...POLICY, root: '/repo' }) as RouterPlan
    expect(parsed.tasks[0]?.split).toBeUndefined()
  })
})
