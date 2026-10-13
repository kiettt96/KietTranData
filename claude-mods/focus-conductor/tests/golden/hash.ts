// Băm request mà mod gửi router cho một ca của golden-set: system prompt (kèm catalog giá của bảng kèm mod, không phải bảng
// đã bị option prices ghi đè), prompt người dùng (ngữ cảnh, thẻ, nội dung đã qua fence), effort, maxTokens và timeout. Câu trả lời đã
// ghi (replies.ts) chỉ có nghĩa với đúng request đã băm đó: đổi prompt router, catalog, dòng ngữ cảnh hay định dạng request thì băm
// đổi và golden.test.ts đỏ cho tới khi ghi lại bằng `bun scripts/eval-router.ts --record`.

import { bundledPrices } from '../../hooks/lib/cost'
import { routerRequest } from '../../hooks/lib/router'
import type { GoldenCase } from './cases'
import { OPEN } from './cases'

const hex = (bytes: ArrayBuffer): string => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')

/** Request của mod cho một ca, với model router cố định để băm không phụ thuộc option router. */
export function goldenRequest(c: GoldenCase, model = 'sonnet') {
  return routerRequest({ text: c.text, prev: c.prev ?? null, ran: c.ran ?? null, policy: OPEN, model, prices: bundledPrices() })
}

/** SHA-256 (hex) của request, không tính model. */
export async function requestHash(c: GoldenCase): Promise<string> {
  const { system, prompt, effort, maxTokens, timeoutMs } = goldenRequest(c)
  const text = JSON.stringify({ system, prompt, effort, maxTokens, timeoutMs })
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
}
