// 0.7.9 vòng 2 V1d: với công cụ kiểm tĩnh, lần đạt chỉ phủ lần lỗi khi tập cờ của hai lệnh bằng nhau, sau khi bỏ cờ trung tính (--pretty, --color,
// --no-color, --format, -f, --cache, --cache-location, --noEmit, --quiet, cùng giá trị đi kèm) và cờ phạm vi (-p, --project: so riêng). Cờ khác, kể cả
// giá trị của nó (--max-warnings 1000 so với 0), làm lần đạt là phép kiểm khác. Lỗ này có từ trước 0.7.9 cho cờ nới lỏng như --max-warnings.

import { describe, expect, test } from 'claude-code/testing'
import { coversFailure } from '../hooks/lib/drift/evidence'

const covers = (pass: string, fail: string) => coversFailure({ check: 'static', command: pass }, { check: 'static', command: fail })

describe('0.7.9 V1d: tập cờ khác nhau thì lần đạt không phủ lần lỗi', () => {
  const cases: Array<[string, string]> = [
    ['tsc --noEmit --skipLibCheck', 'tsc --noEmit'],
    ['eslint --max-warnings 1000 .', 'eslint --max-warnings 0 .'],
    ['eslint --no-eslintrc .', 'eslint .'],
    ['eslint -c x.cfg src', 'eslint src'],
    ['eslint --max-warnings=1000 .', 'eslint --max-warnings=0 .'],
    ['mypy --ignore-missing-imports .', 'mypy .'],
  ]
  for (const [pass, fail] of cases) {
    test(`${pass} đạt không phủ ${fail} lỗi`, () => expect(covers(pass, fail)).toBe(false))
  }
})

describe('0.7.9 V1d: cờ trung tính và cờ phạm vi không làm tập cờ khác nhau', () => {
  const cases: Array<[string, string]> = [
    ['tsc -p .', 'tsc --noEmit'],
    ['npx tsc --noEmit --pretty false', 'npx tsc --noEmit'],
    ['eslint --format json .', 'eslint .'],
    ['eslint -f json --quiet src', 'eslint src'],
    ['eslint --cache --cache-location .cache/eslint .', 'eslint .'],
    ['eslint --color .', 'eslint --no-color .'],
    ['eslint --max-warnings 0 src', 'eslint --max-warnings 0 src/ui'],
  ]
  for (const [pass, fail] of cases) {
    test(`${pass} đạt phủ ${fail} lỗi`, () => expect(covers(pass, fail)).toBe(true))
  }
})
