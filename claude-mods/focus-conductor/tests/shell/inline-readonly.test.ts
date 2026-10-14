// Hạng mục E (0.5.6): lệnh Bash nội dòng chỉ đọc (sqlite3, python với -c hoặc heredoc) không còn bị đếm là thay đổi.
// Mặc định là ghi; chỉ chỉ đọc khi chứng minh được bằng danh sách cho phép. Script nằm trong tệp thì vẫn là ghi có thể.

import { describe, expect, test } from 'claude-code/testing'
import { classifyBash, isMutation, newEvidenceLog, newTracker, noteEvidence, observe } from '../../hooks/lib/drift'
import { bash, edit, makeBrief } from '../support/commands'

const heredoc = (head: string, body: string) => `${head} <<'EOF'\n${body}\nEOF`
const mutates = (command: string) => isMutation(bash(command))
const writeCount = (command: string) => classifyBash(command).effects.filter(e => e.kind === 'write').length

// Bảng 25 ca của probe A: 9 ca đọc, 16 ca ghi.
const PROBE: Array<[string, boolean]> = [
  ['sqlite3 data.db "SELECT count(*) FROM items"', false],
  ['sqlite3 -readonly data.db "SELECT 1"', false],
  ['sqlite3 data.db "PRAGMA integrity_check"', false],
  ['sqlite3 data.db ".schema"', false],
  [heredoc('sqlite3 data.db', 'SELECT id FROM items LIMIT 5;'), false],
  [heredoc('python3 -', "import json\nprint(len(json.load(open('a.json'))))"), false],
  [heredoc('python3 -', "import csv\nrows = list(csv.reader(open('x.csv')))\nprint(len(rows))"), false],
  [heredoc('python3 -', "import sqlite3\nc = sqlite3.connect('data.db')\nprint(c.execute('SELECT count(*) FROM t').fetchone())"), false],
  ['python3 -c "print(sum(range(10)))"', false],
  ['sqlite3 data.db "DELETE FROM items WHERE id = 1"', true],
  ['sqlite3 data.db "INSERT INTO t VALUES (1)"', true],
  ['sqlite3 data.db ".output out.txt"', true],
  ['sqlite3 data.db "PRAGMA journal_mode=WAL"', true],
  ['sqlite3 data.db "WITH x AS (SELECT 1) DELETE FROM t"', true],
  ['sqlite3 data.db < query.sql', true],
  [heredoc('python3 -', "open('out.txt', 'w').write('x')"), true],
  [heredoc('python3 -', "from pathlib import Path\nPath('a').write_text('x')"), true],
  [heredoc('python3 -', "import pandas as pd\npd.read_csv('a.csv').to_csv('b.csv')"), true],
  [heredoc('python3 -', "import sqlite3\nc = sqlite3.connect('d.db')\nc.execute(\"INSERT INTO t VALUES (1)\")\nc.commit()"), true],
  [heredoc('python3 -', "import shutil\nshutil.copy('a', 'b')"), true],
  [heredoc('python3 -', "import os\nos.remove('a')"), true],
  [heredoc('python3 -', "import subprocess\nsubprocess.run(['rm', 'a'])"), true],
  [heredoc('python3 -', "exec(open('x.py').read())"), true],
  ['python3 -c "open(\'x\', \'w\').write(\'1\')"', true],
  ['python3 check_totals.py', true],
]

describe('E: bảng 25 ca của probe A', () => {
  for (const [command, expected] of PROBE) {
    test(`${expected ? 'ghi' : 'đọc'}: ${command.replace(/\n/g, ' \\n ').slice(0, 90)}`, () => {
      expect(mutates(command)).toBe(expected)
    })
  }
})

describe('E: ca chỉ đọc bổ sung', () => {
  const reads = [
    'sqlite3 data.db "SELECT * FROM t -- ; DELETE FROM t"',
    'sqlite3 data.db "SELECT 1 /* ; DROP TABLE t */"',
    'sqlite3 data.db "EXPLAIN QUERY PLAN SELECT * FROM t"',
    'sqlite3 data.db "EXPLAIN SELECT 1"',
    'sqlite3 data.db "WITH x AS (SELECT 1 AS a) SELECT a FROM x"',
    'sqlite3 data.db "SELECT \'DELETE\' AS word"',
    'sqlite3 data.db "PRAGMA table_info(items)"',
    'sqlite3 data.db "PRAGMA foreign_key_check"',
    'sqlite3 -header -csv data.db "SELECT 1; SELECT 2"',
    'sqlite3 -nullvalue NULL -separator , data.db "SELECT 1"',
    'sqlite3 data.db ".tables"',
    'sqlite3 data.db ".mode csv" ".headers on" "SELECT 1"',
    'sqlite3 -version',
    'sqlite3 --version',
    'sqlite3 data.db "SELECT 1" 2>&1 | head -5',
    'python3 --version',
    'python3 -V',
    'python3.11 -c "print(1)"',
    'python -u -c "print(1)"',
    'python3 -c "import json, math; print(math.pi)"',
    'python3 -c "import sys; sys.stdout.write(str(1))"',
    "python3 -c \"print(open('a.txt', 'rb').read())\"",
    "python3 -c \"print(open('a.txt', mode='r').read())\"",
    heredoc('python3', "import json\nprint(json.dumps({'a': 1}))"),
    heredoc('python3 -', 'x = 5\nprint(f"{x + 1}")'),
    heredoc('sqlite3 -header data.db', '.schema\nSELECT 1;\n.tables'),
  ]
  for (const command of reads) {
    test(`đọc: ${command.replace(/\n/g, ' \\n ').slice(0, 90)}`, () => {
      expect(mutates(command)).toBe(false)
    })
  }
})

describe('E: ca âm tính, mặc định là ghi', () => {
  const sql = (statement: string) => `sqlite3 data.db "${statement}"`
  const writes: Array<[string, string]> = [
    ['từ khóa ATTACH', sql("ATTACH 'x.db' AS x")],
    ['từ khóa VACUUM', sql('VACUUM')],
    ['từ khóa CREATE', sql('CREATE TABLE t (a)')],
    ['từ khóa DROP', sql('DROP TABLE t')],
    ['từ khóa ALTER', sql('ALTER TABLE t ADD COLUMN b')],
    ['từ khóa REINDEX', sql('REINDEX')],
    ['từ khóa ANALYZE', sql('ANALYZE')],
    ['từ khóa UPDATE', sql('UPDATE t SET a = 1')],
    ['từ khóa REPLACE', sql('REPLACE INTO t VALUES (1)')],
    ['câu thứ hai là ghi', sql('SELECT 1; DELETE FROM t')],
    ['WITH kèm INSERT', sql('WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x')],
    ['EXPLAIN không kèm SELECT', sql('EXPLAIN DELETE FROM t')],
    ['PRAGMA trạng thái dạng gán', sql('PRAGMA user_version = 3')],
    ['PRAGMA trạng thái có giá trị', sql('PRAGMA user_version(3)')],
    ['PRAGMA không trong danh sách', sql('PRAGMA journal_mode')],
    ['PRAGMA đọc nhưng gán', sql('PRAGMA table_info = 1')],
    ['dot-command .read', sql('.read q.sql')],
    ['dot-command .once', sql('.once out.txt')],
    ['dot-command .shell', sql('.shell ls')],
    ['dot-command .system', sql('.system ls')],
    ['dot-command .import', sql('.import a.csv t')],
    ['dot-command .save', sql('.save b.db')],
    ['dot-command .backup', sql('.backup b.db')],
    ['dot-command .restore', sql('.restore b.db')],
    ['dot-command .open', sql('.open b.db')],
    ['dot-command .cd', sql('.cd /tmp')],
    ['dot-command .load', sql('.load ext')],
    ['cờ -init', 'sqlite3 -init init.sql data.db "SELECT 1"'],
    ['cờ -cmd', 'sqlite3 -cmd ".output o.txt" data.db "SELECT 1"'],
    ['cờ lạ', 'sqlite3 -unknown data.db "SELECT 1"'],
    ['hàm writefile', sql("SELECT writefile('a','x')")],
    ['hàm edit', sql("SELECT edit('x')")],
    ['hàm load_extension', sql("SELECT load_extension('x')")],
    ['hàm readfile', sql("SELECT readfile('x')")],
    ['hàm fsdir', sql("SELECT * FROM fsdir('.')")],
    ['hàm lsmode', sql("SELECT lsmode(1)")],
    ['SQL là biến', 'sqlite3 data.db "$QUERY"'],
    ['SQL không đóng chuỗi', sql("SELECT 'abc")],
    ['SQL không đóng chú thích', sql('SELECT 1 /* x')],
    ['đọc từ tệp bằng <', 'sqlite3 data.db < query.sql'],
    ['ống từ lệnh khác', 'echo "SELECT 1" | sqlite3 data.db'],
    ['không có câu lệnh nào', 'sqlite3 data.db'],
    ['heredoc có dot-command ghi', heredoc('sqlite3 data.db', '.shell rm x\nSELECT 1;')],
    ['heredoc có câu ghi', heredoc('sqlite3 data.db', 'SELECT 1;\nDELETE FROM t;')],
    ['python import os', heredoc('python3 -', 'import os\nprint(os.getcwd())')],
    ['python from os import', heredoc('python3 -', 'from os import path\nprint(path)')],
    ['python import io', heredoc('python3 -', 'import io\nprint(io)')],
    ['python import tempfile', heredoc('python3 -', 'import tempfile\nprint(1)')],
    ['python import numpy', heredoc('python3 -', 'import numpy\nprint(1)')],
    ['python import nhiều tên có os', 'python3 -c "import json, os"'],
    ['python import con của os', 'python3 -c "import os.path"'],
    ['python import tương đối', 'python3 -c "from . import x"'],
    ['python eval', 'python3 -c "print(eval(\'1\'))"'],
    ['python compile', 'python3 -c "compile(\'1\', \'f\', \'eval\')"'],
    ['python __import__', 'python3 -c "__import__(\'os\')"'],
    ['python importlib', 'python3 -c "import importlib"'],
    ['python dunder', 'python3 -c "print(().__class__)"'],
    ['python open ghi w', "python3 -c \"open('x', 'w')\""],
    ['python open ghi a', "python3 -c \"open('x', 'a')\""],
    ['python open ghi x', "python3 -c \"open('x', 'x')\""],
    ['python open ghi r+', "python3 -c \"open('x', 'r+')\""],
    ['python open mode=w', "python3 -c \"open('x', mode='w')\""],
    ['python open chế độ là biến', heredoc('python3 -', "m = 'w'\nopen('x', m)")],
    ['python open chế độ là phép nối', heredoc('python3 -', "open('x', 'r' + 'w')")],
    ['python open gán bí danh', heredoc('python3 -', "f = open\nf('x', 'w')")],
    ['python .write trên tệp', heredoc('python3 -', "import json\nf = json\nf.write('x')")],
    ['python .writelines', heredoc('python3 -', "import sys\nsys.argv.writelines(['x'])")],
    ['python .truncate', heredoc('python3 -', "import sys\nsys.argv.truncate(0)")],
    ['python execute là f-string', heredoc('python3 -', "import sqlite3\nc = sqlite3.connect('d.db')\nc.execute(f'SELECT * FROM {t}')")],
    ['python execute là phép nối', heredoc('python3 -', "import sqlite3\nc = sqlite3.connect('d.db')\nc.execute('SELECT ' + col)")],
    ['python execute là biến', heredoc('python3 -', "import sqlite3\nc = sqlite3.connect('d.db')\nc.execute(q)")],
    ['python execute câu ghi', heredoc('python3 -', "import sqlite3\nc = sqlite3.connect('d.db')\nc.execute('DELETE FROM t')")],
    ['python executemany', heredoc('python3 -', "import sqlite3\nc = sqlite3.connect('d.db')\nc.executemany('SELECT ?', [(1,)])")],
    ['python executescript', heredoc('python3 -', "import sqlite3\nc = sqlite3.connect('d.db')\nc.executescript('SELECT 1')")],
    ['python commit', heredoc('python3 -', "import sqlite3\nc = sqlite3.connect('d.db')\nc.commit()")],
    ['python backup', heredoc('python3 -', "import sqlite3\nc = sqlite3.connect('d.db')\nc.backup(c)")],
    ['python mã nằm trong tệp', 'python3 gen.py'],
    ['python mã nằm trong tệp có đường dẫn', 'python scripts/gen.py'],
    ['python đọc mã từ tệp bằng <', 'python3 < gen.py'],
    ['python module bằng -m', 'python3 -m http.server'],
    ['python cú pháp lỗi (ngoặc không đóng)', 'python3 -c "print(1"'],
    ['python chuỗi không đóng', "python3 -c \"print('abc)\""],
    ['python -c thiếu mã', 'python3 -c'],
    ['python -c là biến', 'python3 -c "$CODE"'],
    ['python thân heredoc có $(', heredoc('python3 -', 'print("$(date)")')],
    ['python thân heredoc có backtick', heredoc('python3 -', 'print("`date`")')],
    ['python thân heredoc có eval trong thân', heredoc('python3 -', "print(eval('1'))")],
    ['python hai heredoc trên một đoạn', "python3 - <<'A' <<'B'\nprint(1)\nA\nprint(2)\nB"],
    ['sqlite3 chuyển hướng ghi', 'sqlite3 data.db "SELECT 1" > out.txt'],
    ['python chuyển hướng ghi', 'python3 -c "print(1)" > out.txt'],
    ['qua sudo', 'sudo python3 -c "print(1)"'],
    ['qua xargs', 'xargs sqlite3 data.db'],
  ]
  for (const [label, command] of writes) {
    test(`ghi: ${label}`, () => {
      expect(mutates(command)).toBe(true)
    })
  }

  test('chuyển hướng ghi trên sqlite3 chỉ đọc là ghi xác định, đích đọc được', () => {
    const classified = classifyBash('sqlite3 data.db "SELECT 1" > out.txt')
    expect(classified.effects.some(e => e.kind === 'write' && e.level === 'definite')).toBe(true)
    expect(classified.paths).toEqual(['out.txt'])
    expect(classified.isUnknown).toBe(false)
    expect(isMutation(bash('sqlite3 data.db "SELECT 1" > out.txt', { isReadOnly: true }))).toBe(true)
  })

  test('SELECT writefile là ghi có thể, đích không xác định', () => {
    const classified = classifyBash(`sqlite3 data.db "SELECT writefile('a','x')"`)
    expect(classified.isUnknown).toBe(true)
    expect(classified.effects.some(e => e.kind === 'write' && e.level === 'possible')).toBe(true)
  })
})

describe('E: nhiều heredoc, mỗi đoạn dùng đúng thân của nó', () => {
  const read = "sqlite3 data.db <<'A'\nSELECT 1;\nA"
  const write = "python3 - <<'B'\nopen('x', 'w').write('1')\nB"
  const readPy = "python3 - <<'B'\nprint(1)\nB"
  const writePy = "python3 - <<'A'\nopen('x', 'w').write('1')\nA"

  test('hai thân cùng đọc: không ghi', () => {
    expect(writeCount(`${read}\n${readPy}`)).toBe(0)
  })

  test('đoạn đầu đọc, đoạn sau ghi: đúng một tác động ghi', () => {
    expect(writeCount(`${read}\n${write}`)).toBe(1)
    expect(mutates(`${read}\n${write}`)).toBe(true)
  })

  test('đoạn đầu ghi, đoạn sau đọc: đúng một tác động ghi', () => {
    const readLast = "python3 - <<'B'\nprint(1)\nB"
    expect(writeCount(`${writePy}\n${readLast}`)).toBe(1)
    expect(mutates(`${writePy}\n${readLast}`)).toBe(true)
  })

  test('hai heredoc trên cùng một dòng (thân thứ hai không tách được): giữ là ghi, an toàn', () => {
    expect(mutates("cat <<'A' && python3 - <<'B'\nhello\nA\nprint(1)\nB")).toBe(true)
  })

  test('đoạn chỉ đọc sau thân heredoc của đoạn trước: mỗi đoạn dùng đúng thân của nó', () => {
    expect(mutates("cat <<'A'\nhello\nA\npython3 - <<'B'\nprint(1)\nB")).toBe(false)
    expect(mutates("cat <<'A'\nhello\nA\npython3 - <<'B'\nopen('x', 'w')\nB")).toBe(true)
  })
})

describe('E: nhiều đoạn kiểm tra và ghi trộn lẫn', () => {
  test('lệnh kiểm tra kèm sqlite3 chỉ đọc: kiểm tra vẫn được tin, không có ghi', () => {
    const classified = classifyBash('npm test && sqlite3 data.db "SELECT 1"')
    expect(classified.effects.map(e => e.kind)).toEqual(['check'])
  })

  test('chạy lệnh có heredoc kiểm tra vẫn là một lệnh kiểm tra (danh tính HEREDOC)', () => {
    const classified = classifyBash("cat <<'EOF' | node --test\nx\nEOF")
    expect(classified.effects.some(e => e.kind === 'check' || e.kind === 'write')).toBe(true)
  })
})

describe('E: 12 lệnh sqlite3 SELECT khác nhau không sinh checkpoint hay cảnh báo phạm vi', () => {
  test('checkpoint=0, cảnh báo phạm vi=0, mutations=0', () => {
    const tracker = newTracker('t')
    const brief = makeBrief({ scopePaths: ['reports/'], tier: 'moderate', goal: 'phân tích dữ liệu' })
    let checkpoints = 0
    let scopeWarnings = 0
    for (let i = 0; i < 12; i++) {
      const findings = observe(tracker, bash(`sqlite3 data.db "SELECT count(*) FROM t${i}"`), brief, [])
      checkpoints += findings.filter(f => f.kind === 'checkpoint').length
      scopeWarnings += findings.filter(f => f.kind === 'scope').length
    }
    expect(checkpoints).toBe(0)
    expect(scopeWarnings).toBe(0)
    expect(tracker.mutations).toBe(0)
  })

  test('heredoc python chỉ đọc cũng không đếm', () => {
    const tracker = newTracker('t')
    const brief = makeBrief({ scopePaths: ['reports/'] })
    for (let i = 0; i < 7; i++) observe(tracker, bash(heredoc('python3 -', `import json\nprint(${i})`)), brief, [])
    expect(tracker.mutations).toBe(0)
  })
})

describe('E: hiệu lực của lần kiểm tra', () => {
  test('Edit, test đạt, rồi sqlite3 SELECT: vẫn đã xác minh', () => {
    const tracker = newTracker('t')
    const brief = makeBrief()
    observe(tracker, edit(), brief, [])
    observe(tracker, bash('npm test'), brief, [])
    observe(tracker, bash('sqlite3 data.db "SELECT count(*) FROM t"'), brief, [])
    expect(tracker.isVerified).toBe(true)
  })

  test('Edit, test đạt, rồi python3 heredoc chỉ đọc: vẫn đã xác minh', () => {
    const tracker = newTracker('t')
    const brief = makeBrief()
    observe(tracker, edit(), brief, [])
    observe(tracker, bash('npm test'), brief, [])
    observe(tracker, bash(heredoc('python3 -', "import json\nprint(json.dumps([1]))")), brief, [])
    expect(tracker.isVerified).toBe(true)
  })

  test('Edit, test đạt, rồi python3 heredoc có ghi: mất hiệu lực', () => {
    const tracker = newTracker('t')
    const brief = makeBrief()
    observe(tracker, edit(), brief, [])
    observe(tracker, bash('npm test'), brief, [])
    observe(tracker, bash(heredoc('python3 -', "open('out.txt', 'w').write('x')")), brief, [])
    expect(tracker.isVerified).toBe(false)
  })

  test('dấu vết: lệnh chỉ đọc không tăng mutations và lastMutation', () => {
    const log = newEvidenceLog(1)
    noteEvidence(log, edit())
    noteEvidence(log, bash('npm test'))
    const before = { mutations: log.mutations, lastMutation: log.lastMutation }
    noteEvidence(log, bash('sqlite3 data.db "SELECT 1"'))
    noteEvidence(log, bash(heredoc('python3 -', 'print(1)')))
    expect(log.mutations).toBe(before.mutations)
    expect(log.lastMutation).toBe(before.lastMutation)
  })

  test('dấu vết: lệnh python có ghi tăng mutations', () => {
    const log = newEvidenceLog(1)
    noteEvidence(log, edit())
    const before = log.mutations
    noteEvidence(log, bash(heredoc('python3 -', "open('out.txt', 'w').write('x')")))
    expect(log.mutations).toBe(before + 1)
  })
})

describe('E: ghim hành vi, script trong tệp vẫn là ghi có thể', () => {
  test('python gen.py và python scripts/gen.py là ghi có thể, không xác định đích', () => {
    for (const command of ['python gen.py', 'python scripts/gen.py']) {
      const classified = classifyBash(command)
      expect(classified.isUnknown, command).toBe(true)
      expect(classified.effects.some(e => e.kind === 'write' && e.level === 'possible'), command).toBe(true)
    }
  })

  test('engine báo chỉ đọc thì python gen.py không phải thay đổi', () => {
    expect(isMutation(bash('python gen.py', { isReadOnly: true }))).toBe(false)
  })
})
