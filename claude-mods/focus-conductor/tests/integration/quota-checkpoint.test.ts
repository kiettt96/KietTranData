// 0.6.0 hạng mục C (tích hợp): điểm dừng bền trong $.store, ghi hai giai đoạn, action checkpoint của plan.

import { describe, expect, test } from 'claude-code/testing'
import type { QuotaCheckpoint } from '../../types'
import { storeKey } from '../../hooks/lib/checkpoint'
import { COMPLEX_PROMPT, base, submit } from '../support/engine'
import { memoryStore, quotaMeter, session } from '../support/quota'

const PLAN = 'mcp__focus-conductor__plan'
const BAIT = 'NOI_DUNG_BI_MAT_7731'

function stored(box: { data: Map<string, unknown> }, root = '/repo') {
  return box.data.get(storeKey(root)) as QuotaCheckpoint | undefined
}

describe('0.6.0 C: ghi hai giai đoạn', () => {
  test('vào vùng dừng: bản ghi open có ngay (chưa có note); plan checkpoint thêm note', {}, async ($, on) => {
    const { clock } = base(on)
    const box = memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Read' }, () => ({ result: BAIT }))
    on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: 900, isLink: false } }) as never)
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }, { title: 'Kiểm' }] })
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'doing' })
    await $.tool.call({ tool: 'Read', file_path: 'src/a.ts' } as never)
    await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' } as never)
    meter.set([session(96)])
    await clock.advance(10_000)
    await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
    const first = stored(box)
    expect(first?.status).toBe('open')
    expect(first?.note).toBe('')
    expect(first?.doing).toEqual([1])
    expect(first?.denied?.tool).toBe('Bash')
    expect(first?.denied?.input).toContain('npm test')
    expect(first?.reason[0]?.kind).toBe('five_hour')
    expect(first?.files.map(f => f.path)).toEqual(['src/a.ts'])
    expect(first?.recent.some(r => r.startsWith('Edit src/a.ts'))).toBe(true)
    expect(JSON.stringify(first)).not.toContain(BAIT)
    const out = await $.tool.call({ tool: PLAN, action: 'checkpoint', note: 'Bước 1 còn dở: chạy lại npm test sau khi sửa a.ts; a.ts đã sửa xong.' })
    expect(out.deny).toBeUndefined()
    expect(String(out.result)).toContain('điểm dừng')
    expect(stored(box)?.note).toContain('npm test')
  })

  test('store.set lỗi: không ném ra, có toast, vẫn giữ trong trạng thái (status hiện điểm dừng)', {}, async ($, on) => {
    const seen = base(on)
    const box = memoryStore(on)
    box.failing = true
    quotaMeter(on, [session(99)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    const out = await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' } as never)
    expect(out.deny).toContain('hạn mức')
    expect(seen.toasts.some(t => t.includes('không lưu được điểm dừng'))).toBe(true)
    const note = await $.tool.call({ tool: PLAN, action: 'checkpoint', note: 'tiếp ở bước 1' })
    expect(note.deny).toBeUndefined()
  })

  test('hai thư mục khác nhau không lẫn điểm dừng', {}, async ($, on) => {
    let root = '/repo/one'
    const { clock } = base(on, { root: () => root })
    const box = memoryStore(on)
    const meter = quotaMeter(on, [session(99)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: 'Edit', file_path: 'a', old_string: 'a', new_string: 'b' } as never)
    expect((stored(box, '/repo/one'))?.cwd).toBe('/repo/one')
    expect(stored(box, '/repo/two')).toBeUndefined()
    root = '/repo/two'
    meter.set([session(1)])
    await clock.advance(10_000)
    await $.tool.call({ tool: 'Edit', file_path: 'a', old_string: 'a', new_string: 'b' } as never)
    expect(stored(box, '/repo/two')).toBeUndefined()
  })
})

describe('0.6.0 C: action checkpoint', () => {
  test('ngoài trạng thái dừng thì bị từ chối rõ ràng; cần note', {}, async ($, on) => {
    base(on)
    const box = memoryStore(on)
    quotaMeter(on, [session(10)])
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'a' }] })
    expect((await $.tool.call({ tool: PLAN, action: 'checkpoint', note: 'x' })).deny).toContain('chỉ dùng khi')
  })

  test('đang dừng mà thiếu note thì bị từ chối', {}, async ($, on) => {
    base(on)
    const box = memoryStore(on)
    quotaMeter(on, [session(99)])
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: 'Edit', file_path: 'a', old_string: 'a', new_string: 'b' } as never)
    expect((await $.tool.call({ tool: PLAN, action: 'checkpoint' })).deny).toContain('note')
  })

  test('các action cũ không đổi: set, update, add, show vẫn chạy', {}, async ($, on) => {
    base(on)
    const box = memoryStore(on)
    quotaMeter(on, [session(10)])
    await submit($, COMPLEX_PROMPT)
    expect(String((await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'a' }] })).result)).toContain('Đã lưu 1 bước')
    expect(String((await $.tool.call({ tool: PLAN, action: 'add', steps: [{ title: 'b' }] })).result)).toContain('[ ] 2. b')
    expect(String((await $.tool.call({ tool: PLAN, action: 'show' })).result)).toContain('[ ] 2. b')
    expect((await $.tool.call({ tool: PLAN, action: 'xyz' })).deny).toContain('checkpoint')
  })
})

describe('0.6.0 C: kho không chứa nội dung file hay bí mật (góp ý PR 21)', () => {
  test('lệnh Write bị từ chối chỉ ghi đường dẫn và độ dài; lệnh Bash trong năm tool call cuối được che bí mật', {}, async ($, on) => {
    const { clock } = base(on)
    const box = memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Write' }, () => ({ result: 'ok' }))
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: 'Bash', command: `curl -H "Authorization: Bearer ${BAIT}1" https://api.example.test` } as never)
    await $.tool.call({ tool: 'Bash', command: `API_KEY=${BAIT}2 ./deploy.sh --password ${BAIT}3` } as never)
    meter.set([session(97)])
    await clock.advance(10_000)
    const out = await $.tool.call({ tool: 'Write', file_path: 'src/new.ts', content: `export const key = "${BAIT}4"` } as never)
    expect(out.deny).toContain('hạn mức')
    const cp = stored(box)
    expect(cp?.denied?.input).toBe(`src/new.ts, nội dung ${`export const key = "${BAIT}4"`.length} ký tự`)
    expect(cp?.recent.length).toBe(2)
    expect(JSON.stringify([...box.data.values()])).not.toContain(BAIT)
  })
})
