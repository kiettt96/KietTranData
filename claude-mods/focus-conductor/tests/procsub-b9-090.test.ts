// 0.9.0 B9: thay thế tiến trình `<(lệnh)` được phân loại theo lệnh bên trong: ngoài và trong đều chỉ đọc thì cả lệnh chỉ đọc; trong là script
// hay lệnh lạ thì giữ mức possible; trong có ghi file thì là ghi.

import { describe, expect, test } from 'claude-code/testing'
import { classifyBash, isReadOnlyCommand } from '../hooks/lib/drift'
import type { WriteEffect } from '../hooks/lib/drift/classify'

const writes = (command: string) => classifyBash(command).effects.filter((e): e is WriteEffect => e.kind === 'write')

describe('0.9.0 B9: thay thế tiến trình', () => {
  test('diff <(sort a) <(sort b): chỉ đọc', () => {
    expect(writes('diff <(sort a.txt) <(sort b.txt)')).toEqual([])
    expect(isReadOnlyCommand('diff <(sort a.txt) <(sort b.txt)')).toBe(true)
  })
  test('shasum -a 256 <(cat a) và comm <(sort a) <(sort b): chỉ đọc', () => {
    expect(writes('shasum -a 256 <(cat a.md)')).toEqual([])
    expect(writes('comm -12 <(sort a) <(sort b)')).toEqual([])
  })
  test('grep -c x <(bash s.sh): possible', () => {
    const found = writes('grep -c x <(bash s.sh)')
    expect(found.some(w => w.level === 'possible')).toBe(true)
    expect(isReadOnlyCommand('grep -c x <(bash s.sh)')).toBe(false)
  })
  test('cat <(rm -rf x): là ghi, đích không chắc (isUnknown) như 0.7.5 R3', () => {
    expect(writes('cat <(rm -rf x)').some(w => w.level === 'definite' && w.paths.includes('x') && w.isUnknown)).toBe(true)
    expect(classifyBash('cat <(rm -rf x)').isUnknown).toBe(true)
    expect(classifyBash('diff <(sort a) <(sort b)').isUnknown).toBe(false)
  })
  test('ngoài là lệnh ghi: vẫn là ghi; >( ) giữ possible như 0.8.9', () => {
    expect(writes('sort -o out.txt <(cat a)').length).toBeGreaterThan(0)
    expect(writes('tee >(cat) < a').some(w => w.level === 'possible')).toBe(true)
    expect(isReadOnlyCommand('diff <(sort a) >(cat)')).toBe(false)
  })
  test('lồng hay có thay thế lệnh bên trong: possible', () => {
    expect(writes('cat <(cat <(ls))').some(w => w.level === 'possible')).toBe(true)
    expect(writes('cat <(echo $(ls))').some(w => w.level === 'possible')).toBe(true)
  })
})
