// 0.9.0 C4: lời giao subagent có vai nhận thêm một dòng do mod nối (không quá 200 ký tự) nêu mẫu báo cáo của vai và dòng kết luận đứng đầu câu
// trả lời: audit ĐẠT HẾT hay CHƯA ĐẠT kèm số đếm; review ĐẠT hay CHƯA ĐẠT kèm lỗi theo mức; design SẴN SÀNG hay CHƯA SẴN SÀNG; build nêu đã
// đổi gì, đã tự kiểm gì; search nêu vị trí kèm bằng chứng. Bản en: ALL PASS, PASS, FAIL, READY, NOT READY. Mod đọc dòng kết luận từ câu trả
// lời; không có dòng kết luận thì coi là chưa có kết luận.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import * as V from '../hooks/lib/verdict'
import { base, plan, submit, task } from './support/engine'

type Mod = { reportLine?: (role: string, lang: 'vi' | 'en') => string; verdictOf?: (role: string, answer: string) => { verdict: string; count?: string } | null }
const M = V as unknown as Mod

describe('0.9.0 C4: đọc dòng kết luận', () => {
  const cases: Array<[string, string, string]> = [
    ['audit', 'ĐẠT HẾT 13/13\\nchi tiết', 'pass'],
    ['audit', '**CHƯA ĐẠT 2/13**\\n- K2 lệch', 'fail'],
    ['review', 'ĐẠT\\nKhông có lỗi Nghiêm trọng.', 'pass'],
    ['review', 'CHƯA ĐẠT\\n- Lớn: thiếu test', 'fail'],
    ['design', 'SẴN SÀNG\\nPhương án A', 'ready'],
    ['design', '# CHƯA SẴN SÀNG\\nRủi ro', 'not-ready'],
    ['audit', 'ALL PASS 5/5', 'pass'],
    ['review', 'FAIL: 1 major', 'fail'],
    ['design', 'NOT READY', 'not-ready'],
    ['design', 'READY', 'ready'],
  ]
  for (const [role, answer, verdict] of cases) {
    test(`${role}: ${JSON.stringify(answer)} là ${verdict}`, () => {
      expect(M.verdictOf?.(role, answer.replace(/\\\\n/g, '\\n'))?.verdict).toBe(verdict)
    })
  }
  test('không có dòng kết luận: null; dòng kết luận không đứng đầu: null', () => {
    expect(M.verdictOf?.('review', 'Đã xem xong, nhìn chung ổn.')).toBeNull()
    expect(M.verdictOf?.('audit', 'Kết quả:\\nĐẠT HẾT')).toBeNull()
    expect(M.verdictOf?.('build', 'ĐẠT')).toBeNull()
  })
  test('số đếm của audit đi kèm', () => {
    expect(M.verdictOf?.('audit', 'CHƯA ĐẠT 2/13')?.count).toBe('2/13')
  })
})

describe('0.9.0 C4: dòng mẫu báo cáo', () => {
  test('mỗi vai một dòng, không quá 200 ký tự, vi và en', () => {
    for (const role of ['audit', 'review', 'design', 'build', 'search']) {
      for (const lang of ['vi', 'en'] as const) {
        const line = M.reportLine?.(role, lang) ?? ''
        expect(line.length, `${role} ${lang}`).toBeGreaterThan(20)
        expect(line.length, `${role} ${lang}`).toBeLessThanOrEqual(200)
      }
    }
    expect(M.reportLine?.('audit', 'vi')).toContain('ĐẠT HẾT')
    expect(M.reportLine?.('review', 'vi')).toContain('Nghiêm trọng')
    expect(M.reportLine?.('design', 'en')).toContain('NOT READY')
  })
  test('lời giao subagent có vai được nối dòng mẫu; không có vai thì giữ nguyên', { options: { planApproval: 'off' } }, async ($: Engine, on) => {
    base(on, { router: () => plan({ goal: 'Sửa phí', depth: 'substantial', volume: 'medium', kind: 'edit', tasks: [task('Chạy kiểm', 'agent', 'haiku', 'low', { role: 'audit', kind: 'investigate' }), task('Ghi tài liệu', 'agent', 'sonnet', 'medium')] }) })
    const prompts: string[] = []
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'ok' }))
    on('agent.spawn', (_$, e) => {
      prompts.push(String((e as { prompt?: unknown }).prompt ?? ''))
      return { model: 'claude-haiku-5-5', agentId: `a-${String((e as { tool_use_id?: unknown }).tool_use_id)}` } as never
    })
    await submit($, 'Sửa phí')
    for (const [id, title] of [['t1', 'Việc 1: Chạy kiểm'], ['t2', 'Việc 2: Ghi tài liệu']]) {
      await $.tool.call({ tool: 'Agent', tool_use_id: id, description: title, prompt: 'Làm việc này.' } as never)
      await $.agent.spawn({ prompt: 'Làm việc này.', description: title, tool_use_id: id } as never)
    }
    expect(prompts[0]).toContain('ĐẠT HẾT')
    expect(prompts[0]?.startsWith('Làm việc này.')).toBe(true)
    expect(prompts[1]).toBe('Làm việc này.')
  })
})

describe('0.9.0 C4: mod ghi kết luận của subagent', () => {
  test('subagent vai audit trả lời "CHƯA ĐẠT 2/13": dòng verdict ghi fail kèm 2/13; câu trả lời không có kết luận: verdict null', { options: { planApproval: 'off', decisionLog: '/tmp/fc-verdict-c4-090.jsonl' } }, async ($: Engine, on) => {
    base(on, { router: () => plan({ goal: 'Sửa phí', depth: 'substantial', volume: 'medium', kind: 'edit', tasks: [task('Chạy kiểm', 'agent', 'haiku', 'low', { role: 'audit', kind: 'investigate' })] }) })
    const writes: string[] = []
    on('fs.write', (_$, e) => {
      writes.push(e.text)
      return { value: undefined }
    })
    on('tool.call', { tool: 'Agent' }, () => ({ result: 'ok' }))
    on('agent.spawn', (_$, e) => ({ model: 'claude-haiku-5-5', agentId: `a-${String((e as { tool_use_id?: unknown }).tool_use_id)}` }) as never)
    on('turn.complete', () => ({ text: '' }))
    await submit($, 'Sửa phí')
    for (const [id, answer] of [['t1', 'CHƯA ĐẠT 2/13\n- K2 lệch'], ['t2', 'Xong rồi.']]) {
      await $.tool.call({ tool: 'Agent', tool_use_id: id, description: 'Việc 1: Chạy kiểm', prompt: 'Chạy kiểm.' } as never)
      await $.agent.spawn({ prompt: 'Chạy kiểm.', description: 'Việc 1: Chạy kiểm', tool_use_id: id } as never)
      await $.turn.complete({ turnId: `x-${id}`, agentId: `a-${id}`, answer, durationMs: 5, isAborted: false, reason: 'answer' } as never)
    }
    const lines = (writes.at(-1) ?? '').trim().split('\n').map(l => JSON.parse(l) as Record<string, unknown>).filter(l => l['kind'] === 'verdict')
    expect(lines.map(l => [l['role'], l['verdict'], l['count'] ?? null])).toEqual([['audit', 'fail', '2/13'], ['audit', null, null]])
  })
})
