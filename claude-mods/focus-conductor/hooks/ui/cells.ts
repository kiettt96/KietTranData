// Đếm ô terminal theo cụm ký tự (0.7.9 UI1; tách khỏi style.ts ở 0.8.8 để neon.ts dùng chung mà không import vòng). Hàm thuần.

/** Cụm ký tự (grapheme) của chuỗi; không có Intl.Segmenter thì theo từng code point. */
export function graphemesOf(text: string): string[] {
  return typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(part => part.segment) : [...text]
}

/** Cụm ký tự rộng hai ô terminal: emoji, cờ, chữ CJK và chữ toàn khổ. */
export const WIDE_GRAPHEME = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA960-\uA97F\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/u

export const graphemeCells = (g: string): number => (WIDE_GRAPHEME.test(g) ? 2 : 1)
