// Các hàm thuần của scripts/mutate.ts: phán quyết cho một lượt chạy đột biến, kiểm phiên bản engine và chọn engine.
// Không có tác dụng phụ lúc import, để test nạp trực tiếp được.

export type Verdict = 'KILLED' | 'SURVIVED' | 'EQUIVALENT' | 'ERROR' | 'TIMEOUT'

/** Phiên bản engine mà kết quả đột biến được tính trên đó. */
export const ENGINE_VERSION = '2.1.296'

/**
 * Phán quyết của một lượt `plugin test`. `failed` là số ca lỗi (-1 nếu không đọc được); `loads` là false khi output có
 * "did not load"; `timedOut` là true khi lượt bị kill vì quá hạn.
 */
export function verdictOf(r: { failed: number; loads: boolean; timedOut: boolean; equivalent: boolean }): Verdict {
  if (r.timedOut) return 'TIMEOUT'
  if (!r.loads) return 'KILLED'
  if (r.failed === -1) return 'ERROR'
  if (r.failed > 0) return 'KILLED'
  return r.equivalent ? 'EQUIVALENT' : 'SURVIVED'
}

/** Đúng khi chuỗi `--version` có đúng ENGINE_VERSION làm một token (không phải tiền tố hay hậu tố của số khác). */
export function engineMatches(versionOutput: string): boolean {
  return versionOutput.split(/\s+/).some(token => token === ENGINE_VERSION)
}

/** Engine để spawn: cờ `--claude <đường dẫn>`, rồi biến môi trường FC_CLAUDE, rồi `claude` theo PATH. */
export function engineOf(args: string[], env: Record<string, string | undefined>): string {
  const at = args.indexOf('--claude')
  const fromFlag = at >= 0 ? args[at + 1] : undefined
  if (fromFlag) return fromFlag
  if (env.FC_CLAUDE) return env.FC_CLAUDE
  return 'claude'
}
