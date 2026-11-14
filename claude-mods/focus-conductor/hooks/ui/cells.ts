// Đếm ô terminal theo cụm ký tự (0.7.9 UI1; tách khỏi style.ts ở 0.8.8 để neon.ts dùng chung mà không import vòng). Hàm thuần.

/** Cụm ký tự (grapheme) của chuỗi; không có Intl.Segmenter thì theo từng code point. */
export function graphemesOf(text: string): string[] {
  return typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(part => part.segment) : [...text]
}

/** Cụm ký tự rộng hai ô terminal: emoji, cờ, chữ CJK và chữ toàn khổ. */
export const WIDE_GRAPHEME = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꥠ-꥿가-힣豈-﫿︰-﹏＀-｠￠-￦]/u

export const graphemeCells = (g: string): number => (WIDE_GRAPHEME.test(g) ? 2 : 1)
