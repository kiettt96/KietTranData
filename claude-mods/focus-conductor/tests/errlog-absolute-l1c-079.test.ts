// 0.7.9 vòng 2: ghim mẫu 079-L1c. Đường dẫn tuyệt đối không đuôi tệp (thư mục) thành <path> bằng chính bước đường dẫn tuyệt đối của normalizeMessage;
// bước đường dẫn tương đối của V7 chỉ nhận token có đuôi tệp hoặc bắt đầu bằng ./ hay ../, nên che mất mẫu khi test chỉ dùng tệp có đuôi.

import { describe, expect, test } from 'claude-code/testing'
import { normalizeMessage } from '../hooks/lib/errlog'

describe('normalizeMessage: đường dẫn tuyệt đối không đuôi tệp', () => {
  test('thư mục kiểu macOS /Users/name/proj', () => expect(normalizeMessage('/Users/name/proj')).toBe('<path>'))
  test('ổ đĩa Windows C:\\Users\\name\\proj', () => expect(normalizeMessage('C:\\Users\\name\\proj')).toBe('<path>'))
  test('thư mục nhà ~/work/acme', () => expect(normalizeMessage('~/work/acme')).toBe('<path>'))
  test('sau dấu bằng: cwd=/home/u/acme giữ nhãn cwd=', () => expect(normalizeMessage('cwd=/home/u/acme')).toBe('cwd=<path>'))
  test('giữa câu: open /Users/name/proj failed', () => expect(normalizeMessage('open /Users/name/proj failed')).toBe('open <path> failed'))
})
