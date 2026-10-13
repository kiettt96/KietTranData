// Golden-set của router, replay offline: câu trả lời router thật đã ghi (tests/golden/replies.ts, ghi bằng
// scripts/eval-router.ts --record) đi qua đúng đường đọc, kẹp và lập brief của mod, rồi chấm theo kỳ vọng.
// Đổi prompt router thì chạy lại script để ghi câu trả lời mới; test này bắt lỗi ở phần code đọc và kẹp.

import { describe, expect, test } from 'claude-code/testing'

import { routerSystem } from '../hooks/lib/router'
import { CASES } from './golden/cases'
import { check } from './golden/check'
import { requestHash } from './golden/hash'
import { HASHES, REPLIES } from './golden/replies'

describe('golden-set: câu trả lời router đã ghi', () => {
  test('mỗi ca có câu trả lời đã ghi', () => {
    expect(CASES.filter(c => REPLIES[c.id] === undefined).map(c => c.id)).toEqual([])
  })

  test('câu trả lời đã ghi khớp request hiện tại của mod: băm request không đổi kể từ lần ghi', async () => {
    const stale: string[] = []
    for (const c of CASES) if ((await requestHash(c)) !== HASHES[c.id]) stale.push(c.id)
    // Lệch nghĩa là prompt router, catalog giá, ngữ cảnh hay định dạng request đã đổi mà chưa ghi lại câu trả lời thật.
    expect(stale).toEqual([])
  })

  test('không ca nào trùng hay gần nguyên văn ví dụ trong system prompt của router', () => {
    const system = routerSystem()
    const words = (text: string) => new Set((text.toLowerCase().match(/[\p{L}\p{N}_.]+/gu) ?? []).filter(word => word.length >= 3))
    const examples = [...system.slice(system.indexOf('Examples (abridged)')).matchAll(/- "([^"]{20,})" ->/g)].map(m => m[1] ?? '')
    expect(examples.length).toBe(3)
    // Tỷ lệ từ của ví dụ xuất hiện trong ca: từ 0,7 trở lên là trùng hay gần nguyên văn.
    const overlap = (example: string, text: string) => {
      const have = words(text)
      const wanted = [...words(example)]
      return wanted.filter(word => have.has(word)).length / wanted.length
    }
    expect(CASES.filter(c => examples.some(example => overlap(example, c.text) >= 0.7)).map(c => c.id)).toEqual([])
  })

  for (const c of CASES) {
    test(`${c.id}: ${c.note}`, () => {
      expect(check(c, REPLIES[c.id] ?? '')).toEqual([])
    })
  }
})

describe('golden-set: bộ chấm bắt được câu trả lời sai', () => {
  const race = CASES.find(c => c.id === 'race')!
  const reply = (over: Record<string, unknown>) =>
    JSON.stringify({ why: 'w', relation: 'new', goal: 'Sửa race condition', depth: 'hard', volume: 'small', kind: 'edit', main: { model: 'opus', effort: 'high' }, tasks: [], ...over })

  test('luồng chính quá yếu, số việc sai, relation sai đều bị chấm lệch', () => {
    expect(check(race, reply({ main: { model: 'sonnet', effort: 'low' } }))).toEqual(['luồng chính sonnet/low, cần opus'])
    expect(check(race, reply({ tasks: [{ title: 'Phần a', run: 'main' }, { title: 'Phần b', run: 'main' }] }))[0]).toContain('2 việc, cần 0 tới 1')
    const again = CASES.find(c => c.id === 'again')!
    expect(check(again, reply({ relation: 'new', main: { model: 'opus', effort: 'high' } }))).toContain('relation new, cần dissatisfied')
    expect(check(race, 'không có json')).toEqual(['router trả lời không đọc được'])
    // Báo chưa đạt mà router giữ nguyên sonnet/medium: lệch.
    expect(check(again, reply({ relation: 'dissatisfied', goal: '', main: { model: 'sonnet', effort: 'medium' } }))).toEqual(['luồng chính sonnet/medium không cao hơn sonnet/medium'])
  })

  test('ca đối kháng: phạm vi thiếu và quan hệ ngoài khoảng chấp nhận bị chấm lệch', () => {
    const scoped = CASES.find(c => c.id === 'scope-bash')!
    expect(check(scoped, reply({ goal: 'Đổi tên charge', kind: 'edit', main: { model: 'sonnet', effort: 'medium' }, scope: [] }))).toContain('phạm vi [], cần có src/')
    const redo = CASES.find(c => c.id === 'redo')!
    expect(check(redo, reply({ relation: 'new', goal: 'Làm lại', main: { model: 'sonnet', effort: 'medium' } }))[0]).toContain('relation new, cần continue|refine|dissatisfied')
  })

  test('bảo đảm của phần kẹp được kiểm trên mọi câu trả lời', () => {
    const six = CASES.find(c => c.id === 'six')!
    const fails = check(six, REPLIES['six'] ?? '')
    expect(fails).toEqual([])
    // Câu trả lời giao việc sửa cho Explore haiku: phần kẹp đổi thành general-purpose sonnet nên vẫn đạt bảo đảm.
    const edited = reply({ tasks: [{ title: 'Sửa file', run: 'agent', agent: 'Explore', model: 'haiku', effort: 'max', kind: 'edit' }] })
    expect(check(race, edited).filter(f => f.includes('haiku') || f.includes('Explore') || f.includes('max'))).toEqual([])
  })
})
