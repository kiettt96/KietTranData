// 0.7.3 điểm 1: lệnh kiểm tra riêng của dự án (checkCommands) khớp bền hơn với script python chạy bằng đường dẫn đầy đủ và
// cờ không nhận giá trị (`/usr/bin/python3 -B tests/a-check.py`), và khai được tiền tố thư mục (`python3 tests/`). Một chuẩn
// hóa dùng chung cho phân loại lệnh, đọc evidence của Claude và danh tính lệnh; danh tính vẫn nghiêm ngặt từng script.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { acceptsVerified, checkKindOf, classifyBash, evidenceStrength, isMutation, newEvidenceLog, noteEvidence } from '../hooks/lib/drift'
import * as drift from '../hooks/lib/drift'
import { COMPLEX_PROMPT, base, submit } from './support/engine'

const bashCall = (command: string) => ({ tool: 'Bash', input: { command }, isError: false, isReadOnly: false, output: '' })
const editCall = { tool: 'Edit', input: { file_path: '/repo/src/a.ts' }, isError: false, isReadOnly: false }
const mutates = (command: string) => isMutation(bashCall(command))
const declare = (raw: string) => drift.applyCheckCommands(drift.parseCheckCommands(raw))
const reset = () => drift.applyCheckCommands([])

/** Sửa một file, chạy các lệnh, rồi đối chiếu evidence: có được nhận là verified không. */
function accepted(runs: string[], evidence: string): boolean {
  const log = newEvidenceLog(1)
  noteEvidence(log, editCall)
  for (const run of runs) noteEvidence(log, bashCall(run))
  return acceptsVerified(evidenceStrength(evidence, log), log)
}

/** Chạy `fn` với danh sách khai `raw`, luôn trả lại danh sách rỗng sau đó. */
function withDeclared<T>(raw: string, fn: () => T): T {
  declare(raw)
  try {
    return fn()
  } finally {
    reset()
  }
}

describe('0.7.3 điểm 1: python chạy bằng đường dẫn đầy đủ và cờ không nhận giá trị', () => {
  const FULL = '/usr/bin/python3 -B tests/a-check.py'

  for (const declared of ['python3 tests/a-check.py', 'python3 tests/']) {
    test(`khai "${declared}": lệnh đầy đủ là kiểm tra chạy hành vi, không còn là ghi`, () => {
      withDeclared(declared, () => {
        expect(checkKindOf(FULL)).toBe('test')
        expect(mutates(FULL)).toBe(false)
        expect(classifyBash(FULL).effects.map(e => e.kind)).toEqual(['check'])
      })
    })
  }

  test('dạng chưa khai vẫn là ghi có thể (không đổi hành vi khi chưa khai)', () => {
    expect(checkKindOf(FULL)).toBeNull()
    expect(mutates(FULL)).toBe(true)
  })

  test('từng cờ không nhận giá trị của python được bỏ qua: -B -u -I -E -s -S -O -OO -q', () => {
    withDeclared('python3 tests/a-check.py', () => {
      for (const flag of ['-B', '-u', '-I', '-E', '-s', '-S', '-O', '-OO', '-q', '-B -u']) {
        expect(checkKindOf(`python3 ${flag} tests/a-check.py`), flag).toBe('test')
      }
    })
  })

  test('-c, -m và -W đổi nghĩa lệnh: không bị bỏ qua, và lệnh không là lệnh kiểm tra khi chỉ khai tiền tố thư mục', () => {
    withDeclared('python3 tests/', () => {
      for (const command of ['python3 -c "print(1)"', 'python3 -m json.tool tests/a.json', 'python3 -W error tests/a-check.py', 'python3 -X dev tests/a-check.py']) {
        expect(checkKindOf(command), command).toBeNull()
        expect(mutates(command), command).toBe(true)
      }
    })
  })

  test('tiền tố thư mục khớp mọi script dưới thư mục (kể cả thư mục con); thư mục khác và đoạn .. thì không', () => {
    withDeclared('python3 tests/', () => {
      expect(checkKindOf('python3 tests/a-check.py')).toBe('test')
      expect(checkKindOf('/usr/bin/python3 -B tests/sub/b-check.py --final')).toBe('test')
      expect(checkKindOf('python3 other/a-check.py')).toBeNull()
      expect(checkKindOf('python3 mytests/a-check.py')).toBeNull()
      expect(checkKindOf('python3 tests/../x.py')).toBeNull()
      expect(checkKindOf('python3 tests/sub/../../x.py')).toBeNull()
      expect(mutates('python3 tests/../x.py')).toBe(true)
    })
  })

  test('khai bằng đường dẫn đầy đủ và cờ cũng được chuẩn hóa như lệnh chạy', () => {
    withDeclared('/usr/bin/python3 -B tests/', () => {
      expect(checkKindOf('python3 tests/a-check.py')).toBe('test')
      expect(checkKindOf('/usr/local/bin/python3 -u tests/a-check.py')).toBe('test')
    })
  })

  test('python3.x chỉ bỏ phần thư mục, giữ nguyên tên: khai python3 thì python3.11 không khớp', () => {
    withDeclared('python3 tests/', () => {
      expect(checkKindOf('python3.11 tests/a-check.py')).toBeNull()
    })
    withDeclared('python3.11 tests/', () => {
      expect(checkKindOf('/opt/py/python3.11 -B tests/a-check.py')).toBe('test')
    })
  })
})

describe('0.7.3 điểm 1: chỉ python mới được bỏ phần thư mục của token đầu', () => {
  test('script tự chạy giữ so khớp nguyên đường dẫn: khai ./scripts/check.sh thì /tmp/check.sh và other/check.sh không là lệnh kiểm', () => {
    withDeclared('./scripts/check.sh', () => {
      expect(checkKindOf('./scripts/check.sh')).toBe('test')
      for (const command of ['/tmp/check.sh', 'other/check.sh', 'scripts/check.sh', '/repo/scripts/check.sh', './other/check.sh']) {
        expect(checkKindOf(command), command).toBeNull()
        expect(mutates(command), command).toBe(true)
      }
    })
  })

  test('lệnh không phải python không bị bỏ thư mục: khai mytool run thì /opt/bin/mytool run không khớp', () => {
    withDeclared('mytool run', () => {
      expect(checkKindOf('mytool run')).toBe('test')
      expect(checkKindOf('/opt/bin/mytool run')).toBeNull()
      expect(mutates('/opt/bin/mytool run')).toBe(true)
    })
  })

  test('danh tính: /tmp/check.sh không được nhận làm bằng chứng cho lần chạy ./scripts/check.sh và ngược lại', () => {
    withDeclared('./scripts/check.sh, /tmp/check.sh', () => {
      expect(accepted(['./scripts/check.sh'], '/tmp/check.sh: đạt')).toBe(false)
      expect(accepted(['/tmp/check.sh'], './scripts/check.sh: đạt')).toBe(false)
      expect(accepted(['./scripts/check.sh'], './scripts/check.sh: đạt')).toBe(true)
    })
  })

  test('danh tính: lệnh khác chạy bằng đường dẫn đầy đủ không đồng nhất với tên trần', () => {
    withDeclared('mytool run', () => {
      expect(accepted(['mytool run'], '/opt/bin/mytool run: đạt')).toBe(false)
    })
  })
})

describe('0.7.3 điểm 1: evidence của Claude và danh tính lệnh dùng cùng chuẩn hóa', () => {
  test('evidence ghi tên ngắn, lần chạy là đường dẫn đầy đủ kèm cờ: được nhận', () => {
    withDeclared('python3 tests/a-check.py', () => {
      expect(accepted(['/usr/bin/python3 -B tests/a-check.py'], 'python3 tests/a-check.py: đạt')).toBe(true)
    })
  })

  test('evidence ghi đường dẫn đầy đủ kèm cờ, lần chạy là tên ngắn: được nhận', () => {
    withDeclared('python3 tests/', () => {
      expect(accepted(['python3 tests/a-check.py'], '/usr/bin/python3 -B tests/a-check.py: đạt')).toBe(true)
    })
  })

  test('khai tiền tố thư mục nhưng danh tính vẫn nghiêm ngặt: nhắc script A không khớp lần chạy script B', () => {
    withDeclared('python3 tests/', () => {
      expect(accepted(['python3 tests/b-check.py'], 'tests/a-check.py: đạt')).toBe(false)
      expect(accepted(['python3 tests/b-check.py'], 'python3 tests/a-check.py: đạt')).toBe(false)
      expect(accepted(['/usr/bin/python3 -B tests/b-check.py'], 'python3 tests/a-check.py: đạt')).toBe(false)
      expect(accepted(['python3 tests/b-check.py'], 'python3 tests/b-check.py: đạt')).toBe(true)
    })
  })

  test('đối số khác nhau vẫn là danh tính khác: --final không khớp lệnh trần', () => {
    withDeclared('python3 tests/', () => {
      expect(accepted(['/usr/bin/python3 -B tests/a-check.py --final'], 'python3 tests/a-check.py: đạt')).toBe(false)
      expect(accepted(['/usr/bin/python3 -B tests/a-check.py --final'], 'python3 tests/a-check.py --final: đạt')).toBe(true)
    })
  })

  test('nhắc -c hay -m không đồng nhất với lần chạy script', () => {
    withDeclared('python3 tests/', () => {
      expect(accepted(['python3 tests/a-check.py'], 'python3 -m tests/a-check.py: đạt')).toBe(false)
    })
  })

  test('không nới isMutation: lệnh python chưa khai vẫn là ghi, kể cả khi nằm cạnh lệnh đã khai', () => {
    withDeclared('python3 tests/', () => {
      expect(mutates('python3 build/make-table.py')).toBe(true)
      expect(mutates('python3 -B scripts/export.py')).toBe(true)
    })
  })
})

describe('0.7.3 điểm 1: cả luồng trong engine', () => {
  const PLAN = 'mcp__focus-conductor__plan'
  const edit = ($: Engine) => $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' } as never)
  const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never)
  const show = async ($: Engine) => String((await $.tool.call({ tool: PLAN, action: 'show' })).result)

  test('script kiểm chạy bằng đường dẫn đầy đủ, đã khai tiền tố thư mục: bước done tự thành verified', { options: { checkCommands: 'python3 tests/' } }, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'RESULT: 47 passed, 0 failed' }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }, { title: 'Kiểm' }] })
    await edit($)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    expect(await show($)).toContain('[x] 1. Sửa')
    await bash($, 'cd /repo && /usr/bin/python3 -B tests/a-check.py')
    expect(await show($)).toContain('[v] 1. Sửa')
  })

  test('verified do Claude ghi với evidence tên ngắn được nhận khi lệnh chạy thật là đường dẫn đầy đủ', { options: { checkCommands: 'python3 tests/a-check.py' } }, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'RESULT: 47 passed, 0 failed' }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] })
    await edit($)
    await bash($, '/usr/bin/python3 -B tests/a-check.py')
    const out = String((await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: 'python3 tests/a-check.py: đạt' })).result)
    expect(out).toContain('[v] 1. Sửa')
    expect(out).not.toContain('chưa tính là đã kiểm tra')
  })

  test('chưa khai: script kiểm bị đếm là thay đổi và không nâng verified (hành vi cũ)', {}, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'RESULT: 47 passed, 0 failed' }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] })
    await edit($)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })
    await bash($, '/usr/bin/python3 -B tests/a-check.py')
    expect(await show($)).toContain('[x] 1. Sửa')
  })
})
