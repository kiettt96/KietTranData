// 0.8.9 U3: askRouter giữ thông điệp của lỗi engine ném. Thông điệp gộp về một dòng, bỏ tiền tố tới hết "$.model.complete: ", cắt còn 160
// ký tự; lý do là "engine từ chối gửi request tới model router: <thông điệp>". Không có thông điệp thì giữ câu cũ. Câu lỗi lấy nguyên văn
// từ engine thật [Đo trực tiếp, 2.1.325, VERIFICATION mục 0.8.9], tên plugin của mod thử đổi thành focus-conductor.

import { describe, expect, test } from 'claude-code/testing'
import type { ModelCompleteRequest } from 'claude-code'
import { askRouter, parseRoute } from '../hooks/lib/router'
import type { Policy } from '../hooks/lib/router'

const OPEN: Policy = { allowFable: false, blocked: new Set(), session: null }
const parse = (text: string) => parseRoute(text, OPEN)
const request: ModelCompleteRequest = { model: 'fable', prompt: 'x', maxTokens: 8_000, timeoutMs: 45_000 } as ModelCompleteRequest
const OLD = 'engine từ chối gửi request tới model router'
const LEAD = `${OLD}: `
const throwing = (value: unknown) => async (): Promise<never> => {
  throw value
}

describe('0.8.9 U3: lý do engine từ chối', () => {
  test('thông điệp của engine thật: lý do giữ phần sau "$.model.complete: "', async () => {
    const outcome = await askRouter(throwing(new Error('focus-conductor: $.model.complete: maxTokens 128000 is past what claude-fable-5-2 can produce in one reply (64000)')), request, parse)
    expect(outcome.reason).toBe(`${LEAD}maxTokens 128000 is past what claude-fable-5-2 can produce in one reply (64000)`)
    expect(outcome.failure).toBe('engine')
  })

  test('thông điệp 400 ký tự có xuống dòng: phần thông điệp dài đúng 160 ký tự, không có ký tự xuống dòng', async () => {
    const long = ['a'.repeat(100), 'b'.repeat(99), 'c'.repeat(99), 'd'.repeat(99)].join('\n')
    expect(long.length).toBe(400)
    const outcome = await askRouter(throwing(new Error(`focus-conductor: $.model.complete: ${long}`)), request, parse)
    expect(outcome.reason.startsWith(LEAD)).toBe(true)
    const message = outcome.reason.slice(LEAD.length)
    expect(message.length).toBe(160)
    expect(/[\r\n]/.test(outcome.reason)).toBe(false)
  })

  test('ask trả null hay ném chuỗi rỗng: giữ câu cũ; ném số 42: thông điệp là "42"; không văng lỗi', async () => {
    expect((await askRouter(async () => null, request, parse)).reason).toBe(OLD)
    expect((await askRouter(throwing(''), request, parse)).reason).toBe(OLD)
    expect((await askRouter(throwing(42), request, parse)).reason).toBe(`${LEAD}42`)
  })

  test('thông điệp không có tiền tố "$.model.complete: ": giữ nguyên', async () => {
    const outcome = await askRouter(throwing(new Error('model bị chặn')), request, parse)
    expect(outcome.reason).toBe(`${LEAD}model bị chặn`)
  })
})

// 0.8.9 R3: ba ca biên. undefined, null và đối tượng không có trường message dạng chuỗi cho thông điệp rỗng (câu cảnh báo giữ dạng cũ);
// đối tượng có message dạng chuỗi dùng chuỗi đó; chuỗi và số giữ như U3. Hai chỗ đã đúng từ U3 nhưng chưa có ca ghim: thông điệp mở đầu
// ngay bằng tiền tố, và việc xóa thông điệp cũ trước mỗi lời gọi.
describe('0.8.9 R3: thông điệp của giá trị bị ném', () => {
  const reasonOf = async (value: unknown) => (await askRouter(throwing(value), request, parse)).reason

  test('undefined: câu cũ', async () => expect(await reasonOf(undefined)).toBe(OLD))
  test('null: câu cũ', async () => expect(await reasonOf(null)).toBe(OLD))
  test('đối tượng rỗng: câu cũ', async () => expect(await reasonOf({})).toBe(OLD))
  test('đối tượng có message dạng chuỗi: dùng chuỗi đó', async () => expect(await reasonOf({ message: 'x' })).toBe(`${LEAD}x`))
  test('chuỗi: giữ chuỗi', async () => expect(await reasonOf('y')).toBe(`${LEAD}y`))
  test('số 42: "42"', async () => expect(await reasonOf(42)).toBe(`${LEAD}42`))

  test('thông điệp mở đầu ngay bằng "$.model.complete: ": bỏ tiền tố', async () => {
    expect(await reasonOf(new Error('$.model.complete: abc'))).toBe(`${LEAD}abc`)
  })

  test('lượt đầu ném lỗi có thông điệp, fallback trả null mà không ném lỗi: lý do cuối là câu cũ', async () => {
    const ask = async (r: ModelCompleteRequest) => {
      if (String(r.prompt) === 'x') throw new Error('focus-conductor: $.model.complete: model "claude-fable-5-2" is not in this organization\'s allowlist')
      return null
    }
    const fallback = { ...request, prompt: 'fallback', maxTokens: 4_000 } as ModelCompleteRequest
    const outcome = await askRouter(ask, request, parse, undefined, { now: () => 0, fallback })
    expect(outcome.result).toBeNull()
    expect(outcome.reason).toBe(OLD)
  })
})
