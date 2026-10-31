// Dấu vết thực thi của một mục tiêu: các lệnh đã chạy kèm kết quả thật, các lần ghi và file đã đụng tới.
// Chuyển nguyên văn từ hooks/lib/drift.ts (tách theo tầng, không đổi hành vi); hooks/lib/drift.ts là barrel.

import type { CheckKind } from './verify'
import { FILE_TOOLS, filePathOf, isPlanFile, str } from './tool'
import type { ToolObservation } from './tool'
import { classifyBash } from './classify'
import type { BashEffect } from './classify'
import { writeEffects } from './effects'
import { checkEffectPassed } from './output'

// ------------------------------------------------------------ đối chiếu evidence

/**
 * Một lệnh Bash đã chạy trong mục tiêu: kết quả thật (ok: kiểm tra đạt, hoặc lệnh không lỗi khi không phải kiểm tra),
 * loại kiểm tra, thứ tự và tác giả ("main" hoặc id subagent).
 */
export type EvidenceEntry = {
  command: string
  /** Chỉ lệnh kiểm tra: danh tính (argv) và đoạn nguyên văn, để đối chiếu evidence và giải thích. */
  argv?: string[]
  raw?: string
  ok: boolean
  check: CheckKind | null
  seq: number
  author: string
}

/**
 * Dấu vết thực thi của một mục tiêu, để đối chiếu evidence khi Claude ghi "verified": các lệnh Bash (kể cả lệnh lỗi),
 * file đã đụng tới, số thay đổi và thứ tự của thay đổi cuối cùng.
 */
export type EvidenceLog = {
  goalId: number
  seq: number
  /** Thứ tự của thay đổi thành công cuối cùng; -1 khi mục tiêu chưa có thay đổi. */
  lastMutation: number
  mutations: number
  commands: EvidenceEntry[]
  /** Các lần ghi theo thứ tự và tác giả, để biết lần kiểm tra của một subagent phủ thay đổi của ai. */
  writes: Array<{ seq: number; author: string }>
  paths: string[]
}

/**
 * Trần của nhật ký lệnh (0.7.5): hai vùng có trần riêng trong cùng danh sách theo seq, lần chạy kiểm (check khác null) và
 * lệnh khác (kể cả lệnh chỉ đọc mà luật verified của việc chỉ tra cứu dựa vào). Vùng nào vượt trần thì bỏ mục cũ nhất của
 * chính vùng đó, nên trăm lệnh đọc không đẩy mất lần kiểm đạt và ngược lại.
 */
const EVIDENCE_CHECKS = 100
const EVIDENCE_OTHERS = 100
const EVIDENCE_PATHS = 200
const EVIDENCE_WRITES = 300

export function newEvidenceLog(goalId: number): EvidenceLog {
  return { goalId, seq: 0, lastMutation: -1, mutations: 0, commands: [], writes: [], paths: [] }
}

/**
 * Ghi một tool call vào dấu vết của mục tiêu theo đúng thứ tự hiệu ứng: lệnh kiểm tra kèm kết quả thật, các lần ghi
 * (kể cả trong lệnh Bash lỗi), và đường dẫn file. `author` là "main" hoặc id subagent.
 */
export function noteEvidence(log: EvidenceLog, observation: ToolObservation, author = 'main'): void {
  const onWrite = () => {
    log.seq += 1
    log.lastMutation = log.seq
    log.mutations += 1
    log.writes.push({ seq: log.seq, author })
    if (log.writes.length > EVIDENCE_WRITES) log.writes.shift()
  }
  const command = str(observation.input['command']).trim()
  if (observation.tool === 'Bash' && command !== '') {
    const classified = classifyBash(command)
    const counted = new Set<BashEffect>(writeEffects(classified, observation.isReadOnly))
    let hasCheck = false
    for (const effect of classified.effects) {
      if (effect.kind === 'write') {
        if (counted.has(effect)) onWrite()
        continue
      }
      hasCheck = true
      log.seq += 1
      log.commands.push({
        command: effect.segment.slice(0, 500),
        argv: effect.argv,
        raw: effect.raw.slice(0, 500),
        ok: checkEffectPassed(effect, observation),
        check: effect.check,
        seq: log.seq,
        author,
      })
    }
    if (!hasCheck) {
      log.seq += 1
      log.commands.push({ command: command.slice(0, 500), ok: !observation.isError, check: null, seq: log.seq, author })
    }
    trimCommands(log)
  } else if (FILE_TOOLS.has(observation.tool) && !observation.isError && !isPlanFile(filePathOf(observation))) {
    onWrite()
  } else {
    log.seq += 1
  }
  if (observation.isError) return
  for (const key of ['file_path', 'notebook_path', 'path']) {
    const path = str(observation.input[key]).trim()
    if (path === '' || log.paths.includes(path)) continue
    log.paths.push(path)
    if (log.paths.length > EVIDENCE_PATHS) log.paths.shift()
  }
}

/** Bỏ mục cũ nhất của vùng vượt trần (lần chạy kiểm hay lệnh khác), giữ thứ tự seq của phần còn lại. */
function trimCommands(log: EvidenceLog): void {
  for (const [isCheck, limit] of [[true, EVIDENCE_CHECKS], [false, EVIDENCE_OTHERS]] as const) {
    let extra = log.commands.filter(c => (c.check !== null) === isCheck).length - limit
    while (extra > 0) {
      log.commands.splice(log.commands.findIndex(c => (c.check !== null) === isCheck), 1)
      extra -= 1
    }
  }
}

/**
 * Lần chạy TEST (hành vi, không phải kiểm tĩnh) đạt sau thay đổi cuối của mục tiêu và phủ mọi thay đổi (0.7.0): cơ sở để mod tự
 * nâng bước done thành verified. Mục tiêu chưa có sửa file (chỉ tra cứu) thì không có: lệnh test khi đó không chứng minh điều gì.
 */
export function freshTestRun(log: EvidenceLog): EvidenceEntry | undefined {
  if (log.mutations === 0) return undefined
  return [...log.commands].reverse().find(c => c.check === 'test' && c.ok && c.seq > log.lastMutation && covers(c, log))
}

/**
 * Lần kiểm tra này có phủ mọi thay đổi trước nó không: kiểm tra của luồng chính phủ tất cả; kiểm tra của subagent chỉ
 * phủ khi mọi thay đổi kể từ lần kiểm tra đạt gần nhất của luồng chính đều do chính subagent đó làm.
 */
export function covers(entry: EvidenceEntry, log: EvidenceLog): boolean {
  if (entry.author === 'main') return true
  const lastMain = log.commands
    .filter(c => c.author === 'main' && c.check !== null && c.ok && c.seq < entry.seq)
    .reduce((max, c) => Math.max(max, c.seq), -1)
  return log.writes.every(w => w.seq <= lastMain || w.seq > entry.seq || w.author === entry.author)
}
