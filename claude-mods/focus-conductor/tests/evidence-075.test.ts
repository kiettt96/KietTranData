// 0.7.5 B2: nhật ký bằng chứng có hai vùng với trần riêng (lần chạy kiểm, lệnh khác), vẫn ghi lệnh chỉ đọc: nhiều lệnh đọc
// không đẩy mất lần kiểm đạt; nhiều lần kiểm không đẩy mất lệnh đọc mà việc chỉ tra cứu dựa vào.

import { describe, expect, test } from 'claude-code/testing'
import { acceptsVerified, evidenceStrength, freshTestRun, newEvidenceLog, noteEvidence } from '../hooks/lib/drift'
import { bash, edit } from './support/commands'

describe('0.7.5 B2: lệnh đọc không đẩy mất lần kiểm đạt', () => {
  test('sửa, npm test đạt, rồi 100 lệnh đọc: lần kiểm vẫn còn, tự nâng và verified vẫn nhận', () => {
    const log = newEvidenceLog(1)
    noteEvidence(log, edit('/repo/src/a.ts'))
    noteEvidence(log, bash('npm test', 'Tests: 12 passed, 12 total'))
    for (let i = 0; i < 100; i++) noteEvidence(log, bash(`ls /repo/data/lo${i}`))
    expect(freshTestRun(log)?.command).toBe('npm test')
    const strength = evidenceStrength('npm test: 12 passed', log)
    expect(strength.level).toBe('strong')
    expect(acceptsVerified(strength, log)).toBe(true)
  })

  test('mỗi vùng giữ tối đa 100 mục, bỏ mục cũ nhất của chính vùng đó', () => {
    const log = newEvidenceLog(1)
    for (let i = 0; i < 150; i++) {
      noteEvidence(log, bash(`ls /repo/d${i}`))
      noteEvidence(log, bash('npx tsc --noEmit', ''))
    }
    expect(log.commands.filter(c => c.check !== null).length).toBe(100)
    expect(log.commands.filter(c => c.check === null).length).toBe(100)
    expect(log.commands.find(c => c.check === null)?.command).toBe('ls /repo/d50')
    expect(log.commands.map(c => c.seq)).toEqual([...log.commands.map(c => c.seq)].sort((x, y) => x - y))
  })

  test('lệnh chỉ đọc vẫn được ghi vào nhật ký', () => {
    const log = newEvidenceLog(1)
    noteEvidence(log, bash('rg charge src'))
    expect(log.commands.map(c => c.command)).toEqual(['rg charge src'])
  })
})

describe('0.7.5 B2: việc chỉ tra cứu vẫn nhận verified như cũ', () => {
  test('không sửa gì, evidence nêu lệnh đã đọc: nhận', () => {
    const log = newEvidenceLog(1)
    noteEvidence(log, bash('rg charge src'))
    for (let i = 0; i < 30; i++) noteEvidence(log, bash(`cat /repo/src/f${i}.ts`))
    const strength = evidenceStrength('rg charge src: 14 chỗ gọi', log)
    expect(acceptsVerified(strength, log)).toBe(true)
  })

  test('nhiều lần kiểm (120 lần) không đẩy mất lệnh đọc mà evidence của việc chỉ tra cứu nêu', () => {
    const log = newEvidenceLog(1)
    noteEvidence(log, bash('rg charge src'))
    for (let i = 0; i < 120; i++) noteEvidence(log, bash('npx tsc --noEmit', ''))
    const strength = evidenceStrength('rg charge src: 14 chỗ gọi', log)
    expect(acceptsVerified(strength, log)).toBe(true)
  })
})
