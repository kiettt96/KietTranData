// Hạng mục E (0.5.6): hàm thuần của hooks/lib/drift/inline.ts, gọi trực tiếp không qua classifyBash.

import { describe, expect, test } from 'claude-code/testing'
import { isReadOnlyInline, isReadOnlyPython, isReadOnlySql } from '../../hooks/lib/drift/inline'

const identity = (token: string) => token

describe('isReadOnlySql', () => {
  test('câu đọc', () => {
    for (const sql of [
      'SELECT 1', 'select * from t;', 'SELECT 1; SELECT 2', 'SELECT 1 -- ghi chú; DROP TABLE t', 'SELECT /* DELETE */ 1',
      "SELECT 'a;b'", 'EXPLAIN SELECT 1', 'EXPLAIN QUERY PLAN SELECT 1', 'WITH x AS (SELECT 1) SELECT * FROM x',
      'PRAGMA integrity_check', 'PRAGMA quick_check', 'PRAGMA table_info(t)', 'PRAGMA main.table_xinfo(t)', 'PRAGMA table_list',
      'PRAGMA index_list(t)', 'PRAGMA index_info(i)', 'PRAGMA foreign_key_list(t)', 'PRAGMA foreign_key_check', 'PRAGMA database_list',
      '.schema', '.tables', '.indexes', '.databases', '.headers on', '.mode csv', '.timer on', '.width 5 5', '.show', '.dump',
      '.mode csv\nSELECT 1;\n.tables',
    ]) expect(isReadOnlySql(sql), sql).toBe(true)
  })

  test('câu ghi hay không phân tích được', () => {
    for (const sql of [
      '', '   ', ';', 'INSERT INTO t VALUES (1)', 'UPDATE t SET a = 1', 'DELETE FROM t', 'REPLACE INTO t VALUES (1)', 'CREATE TABLE t (a)',
      'DROP TABLE t', 'ALTER TABLE t RENAME TO u', 'VACUUM', 'REINDEX', 'ANALYZE', "ATTACH 'x' AS y", 'DETACH y', 'BEGIN', 'COMMIT',
      'WITH x AS (SELECT 1) DELETE FROM t', 'WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x', 'WITH x AS (SELECT replace(a, 1, 2)) SELECT 1',
      'EXPLAIN DELETE FROM t', 'EXPLAIN EXPLAIN SELECT 1', 'PRAGMA journal_mode', 'PRAGMA journal_mode=WAL', 'PRAGMA user_version',
      'PRAGMA user_version = 2', 'PRAGMA user_version(2)', 'PRAGMA table_info = 1', 'PRAGMA writable_schema=1',
      '.read a.sql', '.output o', '.once o', '.shell ls', '.system ls', '.import a t', '.save a', '.backup a', '.restore a', '.open a', '.cd /',
      '.load x', '.quit', '.schema;', 'SELECT 1; .shell ls', "SELECT writefile('a', 'b')", "SELECT edit('a')", "SELECT load_extension('a')",
      "SELECT readfile('a')", "SELECT * FROM fsdir('.')", 'SELECT lsmode(1)', "SELECT 'abc", 'SELECT "abc', 'SELECT 1 /* x', 'SELECT [abc',
    ]) expect(isReadOnlySql(sql), sql).toBe(false)
  })

  test('hàm có tác dụng phụ nằm trong chuỗi thì không tính', () => {
    expect(isReadOnlySql("SELECT 'writefile' AS name")).toBe(true)
    expect(isReadOnlySql("SELECT 'DELETE' AS word")).toBe(true)
  })
})

describe('isReadOnlyPython', () => {
  test('mã đọc', () => {
    for (const code of [
      'print(1)', 'import json\nprint(json.dumps({"a": 1}))', 'import json, csv, re, math\nprint(1)', 'from collections import Counter\nprint(Counter("aab"))',
      "import json\nprint(len(json.load(open('a.json'))))", "print(open('a').read())", "print(open('a', 'r').read())", "print(open('a', 'rb').read())",
      "print(open('a', mode='rt', encoding='utf-8').read())", "print(open(file='a').read())", 'import sys\nsys.stdout.write("x")', 'import sys\nsys.stderr.write("x")',
      'x = 3  # open("a", "w") trong chú thích\nprint(x)', 'print("open(\'a\', \'w\') trong chuỗi, import os, exec(1)")', 'print(f"{1 + 1} và {{thoát}}")',
      "import sqlite3\nc = sqlite3.connect('d.db')\nfor r in c.execute('SELECT * FROM t'): print(r)",
      "import sqlite3\nc = sqlite3.connect('d.db')\nprint(c.execute('SELECT * FROM t WHERE a = ?', (1,)).fetchall())",
      "import sqlite3\nc = sqlite3.connect('d.db')\nprint(c.execute('''SELECT 1\nFROM t''').fetchone())",
      'if __name__ == "__main__":\n    print(1)', 'import hashlib\nprint(hashlib.sha1(b"x").hexdigest())',
    ]) expect(isReadOnlyPython(code), code).toBe(true)
  })

  test('mã ghi hay không phân tích được', () => {
    for (const code of [
      '', 'import os', 'from os import path', 'import os.path', 'import pathlib', 'import shutil', 'import subprocess', 'import io', 'import tempfile',
      'import pandas', 'import numpy', 'import json, os', 'import json; import os', 'import json, \\\n os', 'from . import x', 'from json import (loads,\n dumps)\nimport os',
      'exec("1")', 'eval("1")', 'compile("1", "f", "eval")', '__import__("os")', 'import importlib', 'print(().__class__)', 'print(__builtins__)',
      'getattr(1, "real")', 'print(globals())', 'import sys\nsys.modules["os"].system("ls")',
      "open('a', 'w')", "open('a', 'a')", "open('a', 'x')", "open('a', 'r+')", "open('a', 'wb')", "open('a', mode='w')", "open('a', m)", "open('a', 'r' + 'w')",
      "open('a', *args)", "f = open\nf('a', 'w')", 'x.open("a")', "open('a', f'w')",
      'f.write("x")', 'f.writelines(["x"])', 'f.truncate(0)', 'import sys\nsys.stdout.buffer.write(b"x")',
      "import sqlite3\nc = sqlite3.connect('d')\nc.execute(f'SELECT {x}')", "import sqlite3\nc = sqlite3.connect('d')\nc.execute('SELECT ' + x)",
      "import sqlite3\nc = sqlite3.connect('d')\nc.execute(q)", "import sqlite3\nc = sqlite3.connect('d')\nc.execute('SELECT 1' ' FROM t')",
      "import sqlite3\nc = sqlite3.connect('d')\nc.execute('DELETE FROM t')", "import sqlite3\nc = sqlite3.connect('d')\nc.execute('SELECT \\'a\\'')",
      "import sqlite3\nc = sqlite3.connect('d')\nrun = c.execute\nrun('SELECT 1')",
      "import sqlite3\nc = sqlite3.connect('d')\nc.executemany('SELECT ?', [(1,)])", "import sqlite3\nc = sqlite3.connect('d')\nc.executescript('SELECT 1')",
      "import sqlite3\nc = sqlite3.connect('d')\nc.commit()", "import sqlite3\nc = sqlite3.connect('d')\nc.backup(c)",
      'print(f"{open(\'a\', \'w\')}")', 'print(f"{os.getcwd()} {exec(1)}")', 'print(f"{")', 'print(1', 'print(1))', 'x = "abc', "x = '''abc",
    ]) expect(isReadOnlyPython(code), code).toBe(false)
  })
})

describe('isReadOnlyInline', () => {
  test('sqlite3: tên, cờ, đối số và thân heredoc', () => {
    expect(isReadOnlyInline('sqlite3', ['data.db', 'SELECT 1'], [], identity)).toBe(true)
    expect(isReadOnlyInline('sqlite3', ['-readonly', '-header', '-csv', 'data.db', 'SELECT 1'], [], identity)).toBe(true)
    expect(isReadOnlyInline('sqlite3', ['-nullvalue', 'NULL', '-separator', ',', 'data.db', 'SELECT 1'], [], identity)).toBe(true)
    expect(isReadOnlyInline('sqlite3', ['data.db'], ['SELECT 1;'], identity)).toBe(true)
    expect(isReadOnlyInline('sqlite3', ['-version'], [], identity)).toBe(true)
    expect(isReadOnlyInline('sqlite3', ['--version'], [], identity)).toBe(true)
    expect(isReadOnlyInline('sqlite3', ['data.db'], [], identity)).toBe(false)
    expect(isReadOnlyInline('sqlite3', ['data.db'], ['DELETE FROM t;'], identity)).toBe(false)
    expect(isReadOnlyInline('sqlite3', ['data.db'], ['SELECT 1;', 'SELECT 2;'], identity)).toBe(false)
    expect(isReadOnlyInline('sqlite3', ['-init', 'x', 'data.db', 'SELECT 1'], [], identity)).toBe(false)
    expect(isReadOnlyInline('sqlite3', ['-cmd', 'x', 'data.db', 'SELECT 1'], [], identity)).toBe(false)
    expect(isReadOnlyInline('sqlite3', ['-weird', 'data.db', 'SELECT 1'], [], identity)).toBe(false)
    expect(isReadOnlyInline('sqlite3', ['data.db', '$Q'], [], identity)).toBe(false)
  })

  test('python: tên lệnh, cờ thông dịch, -c và heredoc', () => {
    for (const name of ['python', 'python3', 'python3.11', 'python3.9']) expect(isReadOnlyInline(name, ['-c', 'print(1)'], [], identity), name).toBe(true)
    for (const name of ['python2', 'pythonw', 'python3x', 'pypy', 'ipython', 'node']) expect(isReadOnlyInline(name, ['-c', 'print(1)'], [], identity), name).toBe(false)
    expect(isReadOnlyInline('python3', ['--version'], [], identity)).toBe(true)
    expect(isReadOnlyInline('python3', ['-V'], [], identity)).toBe(true)
    expect(isReadOnlyInline('python3', ['-u', '-B', '-E', '-s', '-S', '-I', '-q', '-c', 'print(1)'], [], identity)).toBe(true)
    expect(isReadOnlyInline('python3', ['-'], ['print(1)'], identity)).toBe(true)
    expect(isReadOnlyInline('python3', [], ['print(1)'], identity)).toBe(true)
    expect(isReadOnlyInline('python3', ['-'], ["open('a', 'w')"], identity)).toBe(false)
    expect(isReadOnlyInline('python3', ['-'], [], identity)).toBe(false)
    expect(isReadOnlyInline('python3', [], [], identity)).toBe(false)
    expect(isReadOnlyInline('python3', ['gen.py'], [], identity)).toBe(false)
    expect(isReadOnlyInline('python3', ['-m', 'http.server'], [], identity)).toBe(false)
    expect(isReadOnlyInline('python3', ['-c', 'print(1)'], ['print(2)'], identity)).toBe(false)
    expect(isReadOnlyInline('python3', ['-', 'a.txt'], ['print(1)'], identity)).toBe(false)
    expect(isReadOnlyInline('python3', ['-c', '$CODE'], [], identity)).toBe(false)
  })

  test('lệnh khác không nhận', () => {
    expect(isReadOnlyInline('psql', ['-c', 'SELECT 1'], [], identity)).toBe(false)
    expect(isReadOnlyInline('duckdb', ['SELECT 1'], [], identity)).toBe(false)
    expect(isReadOnlyInline('curl', ['http://x'], [], identity)).toBe(false)
  })

  test('unmask được dùng để đọc đối số trong nháy', () => {
    const unmask = (token: string) => token.replace(/\u0000(\d+)\u0000/g, () => 'SELECT 1')
    expect(isReadOnlyInline('sqlite3', ['data.db', '\u00000\u0000'], [], unmask)).toBe(true)
  })
})
