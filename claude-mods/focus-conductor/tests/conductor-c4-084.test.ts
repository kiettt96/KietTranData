// 0.8.4 C4: router phân việc thực thi cho subagent khi Fable điều phối. Policy.conductor bật (điều phối khả dụng) thì routerRequest dùng
// biến thể điều phối của lời dặn (thay câu về fable, thêm khối luật việc lớn trước các luật giao việc, giữ nguyên chữ các luật cũ) và
// parseRoute đổi việc main loại edit hay mixed có model hợp lệ thành agent, bỏ mọi đề xuất tách phiên con, với mục tiêu lớn. Cờ tắt: như
// 0.8.3 từng byte.

import { describe, expect, test } from 'claude-code/testing'
import { parseRoute, routerRequest, routerSystem, splitRule } from '../hooks/lib/router'
import type { Policy } from '../hooks/lib/router'
import { OPEN } from './golden/cases'
import { plan, task } from './support/engine'
import type { Json } from './support/engine'

// 0.8.7 L2 đổi các câu về trần số yêu cầu, số việc và thêm câu về thứ tự thực hiện; số ghim đổi theo, ý của ca giữ nguyên: cờ tắt thì
// request dùng đúng lời dặn gốc. Băm của 0.8.3 tới 0.8.6 là 546aea94….
const SHA_083 = 'a9da24a2d3e81a8a653fbc605ff39f7fbfbd77da5a480fe9d01d1e680ba680d0'
const ON: Policy = { ...OPEN, conductor: true }
const sha = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('')
const systemOf = (policy: Policy) => (routerRequest({ text: 'Sửa luồng thanh toán', prev: null, ran: null, policy, model: 'm' }).system as Array<{ text: string }>).map(b => b.text).join('')
const BIG = (tasks: Json[], over: Json = {}) => JSON.stringify(plan({ goal: 'Sửa luồng thanh toán', depth: 'substantial', volume: 'medium', kind: 'edit', tasks, ...over }))

describe('0.8.4 C4: lời dặn router', () => {
  test('cờ tắt: splitRule(routerSystem(), 0) giữ sha256 của 0.8.3, request dùng đúng chữ đó', async () => {
    expect(await sha(splitRule(routerSystem(), 0))).toBe(SHA_083)
    expect(systemOf(OPEN)).toBe(splitRule(routerSystem(), 0))
  })

  test('cờ bật: câu về fable đã đổi, có khối luật việc lớn, các luật giao việc cũ còn nguyên chữ, tăng không quá 900 ký tự', () => {
    const base = routerSystem()
    const variant = systemOf(ON)
    expect(variant).not.toContain('only for the hardest piece where opus is likely to fail')
    expect(variant).toContain('conductor')
    const kept = base.split('\n').filter(line => /^- (A subagent starts|Keep a piece on the main thread|With one or two pieces|The main thread's model and effort cover|Run a task as "agent" only when)/.test(line))
    expect(kept.length).toBe(5)
    for (const line of kept) expect(variant).toContain(line)
    expect(variant.length - base.length).toBeGreaterThan(0)
    expect(variant.length - base.length).toBeLessThanOrEqual(900)
  })
})

describe('0.8.4 C4: parseRoute khi điều phối', () => {
  test('mục tiêu substantial, edit, ba việc: việc main edit có model thành agent general-purpose, việc agent giữ, việc main answer giữ', () => {
    const parsed = parseRoute(BIG([task('Sửa hàm phí', 'main', 'sonnet', 'medium'), task('Tra cứu cấu hình', 'agent', 'haiku', 'low', { agent: 'Explore', kind: 'investigate' }), task('Tóm tắt kết quả', 'main', 'sonnet', 'medium', { kind: 'answer' })]), ON)
    const [a, b, c] = parsed?.tasks ?? []
    expect([a?.run, a?.agentType, `${a?.pick.family}/${a?.pick.effort}`]).toEqual(['agent', 'general-purpose', 'sonnet/medium'])
    expect([b?.run, b?.agentType]).toEqual(['agent', 'Explore'])
    expect(c?.run).toBe('main')
    expect(parsed?.notes.some(n => n.includes('việc 1') && n.includes('điều phối'))).toBe(true)
  })

  test('W1: việc main loại mixed có sonnet/medium: thành agent general-purpose sonnet/medium', () => {
    const parsed = parseRoute(BIG([task('Sửa và rà hàm phí', 'main', 'sonnet', 'medium', { kind: 'mixed' })]), ON)
    const [a] = parsed?.tasks ?? []
    expect([a?.run, a?.agentType, `${a?.pick.family}/${a?.pick.effort}`]).toEqual(['agent', 'general-purpose', 'sonnet/medium'])
  })

  test('W1 đối chứng: luồng chính opus/high, việc main edit sonnet/low: thành agent chạy đúng sonnet/low của việc', () => {
    const parsed = parseRoute(BIG([task('Đổi tên biến', 'main', 'sonnet', 'low')], { main: { model: 'opus', effort: 'high', why: '' } }), ON)
    const [a] = parsed?.tasks ?? []
    expect([a?.run, `${a?.pick.family}/${a?.pick.effort}`]).toEqual(['agent', 'sonnet/low'])
  })

  test('việc main edit thiếu model: giữ ở luồng chính, có lý do', () => {
    const parsed = parseRoute(BIG([{ title: 'Sửa hàm phí', run: 'main', kind: 'edit', depth: 'light', volume: 'small', why: 'w' }]), ON)
    expect(parsed?.tasks[0]?.run).toBe('main')
    expect(parsed?.notes.some(n => n.includes('việc 1') && n.includes('giữ ở luồng chính'))).toBe(true)
  })

  test('mục tiêu light: không việc nào bị đổi', () => {
    const parsed = parseRoute(BIG([task('Sửa hàm phí', 'main', 'sonnet', 'medium')], { depth: 'light', volume: 'small' }), ON)
    expect(parsed?.tasks[0]?.run).toBe('main')
  })

  const SPLIT = [task('Rà soát các module', 'main', 'sonnet', 'medium', { kind: 'investigate', volume: 'large', split: [{ title: 'Phần a', files: [] }, { title: 'Phần b', files: [] }] })]
  test('forks bật, điều phối, mục tiêu lớn: không có việc tách', () => {
    const parsed = parseRoute(BIG(SPLIT), { ...ON, forks: 3 })
    expect(parsed?.tasks[0]?.split).toBeUndefined()
    expect(parsed?.droppedSplits).toBe(1)
  })
  test('forks bật, mục tiêu không lớn hay cờ tắt: vẫn tách như 0.8.3', () => {
    expect(parseRoute(BIG(SPLIT), { ...OPEN, forks: 3 })?.tasks[0]?.split?.length).toBe(2)
    expect(parseRoute(BIG(SPLIT, { depth: 'light' }), { ...ON, forks: 3 })?.tasks[0]?.split?.length).toBe(2)
  })
})
