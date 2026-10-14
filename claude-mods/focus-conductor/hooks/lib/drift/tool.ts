// Kiểu và hàm nền cho mọi phần của drift: quan sát một tool call, đọc đường dẫn file, nhận ra file kế hoạch của plan mode.
// Chuyển nguyên văn từ hooks/lib/drift.ts (tách theo tầng, không đổi hành vi); hooks/lib/drift.ts là barrel.

export const FILE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])

export type ToolObservation = {
  tool: string
  input: Record<string, unknown>
  isError: boolean
  isReadOnly: boolean
  /** Output của tool như model đọc (nếu có): để nhận ra lệnh kiểm tra báo lỗi mà mã thoát vẫn 0 (ví dụ qua `| tail`). */
  output?: string
}

export function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function filePathOf(observation: ToolObservation): string {
  return str(observation.input['file_path']) || str(observation.input['notebook_path'])
}

// File kế hoạch của plan mode (~/.claude/plans/*.md): ghi vào đó là lập kế hoạch, không phải sửa mã.
const PLAN_FILE = /(?:^|[\\/])\.claude[\\/]plans[\\/][^\\/]+\.md$/

export function isPlanFile(path: string): boolean {
  return PLAN_FILE.test(path)
}
