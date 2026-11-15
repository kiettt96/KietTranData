// 0.8.9 (đột biến): ranh giới của isClippedPrompt. Prompt dài đúng bằng sức chứa, hay ngắn hơn một chút, không bị coi là bị lược;
// dài hơn sức chứa một ký tự thì bị lược. Áp cho trần cũ (mặc định) và cho sức chứa truyền vào.

import { describe, expect, test } from 'claude-code/testing'
import { isClippedPrompt } from '../hooks/lib/router'
import { BASE_CHARS } from '../hooks/lib/reading'

describe('0.8.9: ranh giới prompt bị lược', () => {
  test('trần cũ: dài bằng trần hay ngắn hơn 1.000 ký tự thì không bị lược; dài hơn một ký tự thì bị lược', () => {
    expect(isClippedPrompt('a'.repeat(BASE_CHARS - 1_000))).toBe(false)
    expect(isClippedPrompt('a'.repeat(BASE_CHARS))).toBe(false)
    expect(isClippedPrompt('a'.repeat(BASE_CHARS + 1))).toBe(true)
  })

  test('sức chứa truyền vào: dài bằng sức chứa hay ngắn hơn 1.000 ký tự thì không bị lược; dài hơn một ký tự thì bị lược', () => {
    const capacity = 120_000
    expect(isClippedPrompt('a'.repeat(capacity - 1_000), capacity)).toBe(false)
    expect(isClippedPrompt('a'.repeat(capacity), capacity)).toBe(false)
    expect(isClippedPrompt('a'.repeat(capacity + 1), capacity)).toBe(true)
  })
})
