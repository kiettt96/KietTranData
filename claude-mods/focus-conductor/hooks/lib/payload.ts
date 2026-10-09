// Tách phần dán vào (code, log, stack trace, khối dữ liệu) khỏi yêu cầu. Chỉ
// phần yêu cầu được chấm độ sâu; phần dán vào tính vào khối lượng. Nhờ vậy
// một câu hỏi ngắn kèm log dài không bị coi là việc lớn, và một câu ngắn về
// race condition không bị chấm là việc vặt chỉ vì không có gì để dán vào.

export type Split = {
  /** Phần yêu cầu, phần dán vào đã thay bằng một dấu ngắn. */
  request: string
  /** Số dòng dán vào. */
  payloadLines: number
  /** Số ký tự dán vào. */
  payloadChars: number
}

const FENCE = /```[\s\S]*?```/g
const LOG_LINE =
  /^\s*(?:\d{4}-\d{2}-\d{2}[T ]|\[\w[\w:. -]*\]|(?:ERROR|WARN|WARNING|INFO|DEBUG|TRACE)\b|at\s+\S|File "|Traceback\b|Caused by:|\s*\.\.\.\s*\d+\s+more)/
// Mục liệt kê và tiêu đề là yêu cầu, không bao giờ là dữ liệu dán vào.
const LIST_OR_HEADING = /^(?:[-*•]|\d+[.)]|[a-z][.)]|#{1,6})\s/i
const RUN = 8

/** Dòng thuộc log hoặc stack trace. */
function isLogLine(line: string): boolean {
  return LOG_LINE.test(line)
}

/**
 * Dòng giống dữ liệu (JSON, CSV, bảng): mở bằng ngoặc hoặc có từ ba dấu cấu
 * trúc trở lên, và không phải câu văn, mục liệt kê hay tiêu đề.
 */
function isDataLine(line: string): boolean {
  const text = line.trim()
  if (text === '' || LIST_OR_HEADING.test(text) || /[.?!]$/.test(text)) return false
  const marks = (text.match(/[,;:=|{}[\]"]/g) ?? []).length
  return /^[[{"|]/.test(text) || marks >= 3
}

/**
 * Gỡ các đoạn dán vào: code fence, và các dãy dòng log hoặc dữ liệu liên tiếp
 * (từ RUN dòng trở lên). Phần còn lại là yêu cầu.
 */
export function splitPayload(text: string): Split {
  let payloadLines = 0
  let payloadChars = 0

  const fenced = text.replace(FENCE, block => {
    payloadLines += block.split('\n').length
    payloadChars += block.length
    return ' [dữ liệu dán vào] '
  })

  const lines = fenced.split('\n')
  const kept: string[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    const isRun = isLogLine(line) || isDataLine(line)
    if (!isRun) {
      kept.push(line)
      index += 1
      continue
    }
    let end = index
    while (end < lines.length && (isLogLine(lines[end] ?? '') || isDataLine(lines[end] ?? ''))) end += 1
    if (end - index >= RUN) {
      for (let i = index; i < end; i++) payloadChars += (lines[i] ?? '').length + 1
      payloadLines += end - index
      kept.push('[dữ liệu dán vào]')
    } else {
      for (let i = index; i < end; i++) kept.push(lines[i] ?? '')
    }
    index = end
  }

  return { request: kept.join('\n').trim(), payloadLines, payloadChars }
}
