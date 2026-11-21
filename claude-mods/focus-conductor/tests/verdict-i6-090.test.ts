// 0.9.0 vòng 2, kiểm độc lập vòng 1 lỗi 10 và 7: bộ đọc kết luận. Chiều cho qua sai: nhãn mức lỗi cao có giá trị "không" kèm chữ khác
// ("Critical: không rõ") bị coi là phủ định; câu đầu cắt ở dấu `;` nên "ĐẠT, Lớn: 0; Nghiêm trọng: 2" là đạt. Chiều chặn thừa: số đếm 0 theo
// mẫu báo cáo của vai duyệt ("0 lỗi lớn", "Critical 0", "critical issues: 0", "critical (0)") không được nhận là phủ định như ý định M3.

import { describe, expect, test } from 'claude-code/testing'
import { verdictOf } from '../hooks/lib/verdict'

const v = (text: string) => verdictOf(text)?.verdict ?? null

describe('0.9.0 vòng 2 I6: mức lỗi cao sau từ đạt', () => {
  for (const text of ['PASS, Critical: không rõ', 'ĐẠT, Lớn: không chắc', 'ĐẠT, Lớn: 0; Nghiêm trọng: 2', 'PASS, critical: 0; major: 1']) {
    test(`chưa đạt: ${text}`, () => {
      expect(v(text)).toBe('fail')
    })
  }
  for (const text of ['ĐẠT, 0 lỗi nghiêm trọng, 0 lỗi lớn', 'ĐẠT, 0 lỗi lớn', 'PASS: Critical 0, Major 0', 'PASS, critical issues: 0', 'PASS, critical (0)', 'ĐẠT, Lớn: không', 'PASS, Critical: 0, Major: 0']) {
    test(`đạt: ${text}`, () => {
      expect(v(text)).toBe('pass')
    })
  }
})
