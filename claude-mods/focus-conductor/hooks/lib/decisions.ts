// Log quyết định điều phối dạng JSONL (option decisionLog): mỗi dòng một quyết định (router đọc prompt,
// router lỗi, bỏ qua router, chấm subagent, đổi model, nhận xét lạc đề), để gỡ lỗi và cải thiện prompt router.
// Thuần: dựng dòng; hook ghi file bằng $.fs.write.

export type DecisionKind = 'route' | 'router-fail' | 'skip' | 'reroute' | 'agent' | 'model-switch' | 'drift'

/** Số dòng giữ lại (file được ghi lại toàn bộ mỗi lần; giới hạn để không chạm 4 MiB của $.fs). */
export const DECISION_LIMIT = 500

/** Prompt trong log chỉ giữ phần đầu: đủ để nhận ra, không chép cả khối code hay log dán vào. */
export function clipText(text: string, max = 300): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

export function decisionLine(at: number, kind: DecisionKind, data: Record<string, unknown>): string {
  return JSON.stringify({ at: new Date(at).toISOString(), kind, ...data })
}

/** Dòng hợp lệ của file log cũ (để log nối tiếp qua các phiên), giữ DECISION_LIMIT dòng cuối. */
export function keptLines(text: string): string[] {
  return text
    .split('\n')
    .filter(line => line.startsWith('{') && line.endsWith('}'))
    .slice(-DECISION_LIMIT)
}
