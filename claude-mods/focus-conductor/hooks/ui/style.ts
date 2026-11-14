// Ngôn ngữ thị giác chung của band và pane: màu theo theme key (theo giao diện người dùng đang chọn), ký hiệu,
// và các hàm thuần dựng dữ liệu hiển thị. Không gọi $ và không dựng phần tử.
//
// Quy ước: cam (claude) là "đang tập trung": gờ bên trái, bước đang làm. Xanh lá là đã xong, vàng là cần chú ý,
// đỏ là vi phạm. Bốn họ model có bốn sắc riêng, không trùng với màu trạng thái. Thanh tiến độ đổi màu theo giai đoạn
// chung của kế hoạch: xanh dương, cam, vàng, xanh lá (PHASE_HUE).

import type { Color } from 'claude-code'

import type { DelegationState, Ledger, ModelFamily, PlanStep, RouteEvent, StepStatus, WarningKind } from '../../types'
import { GROUPS } from '../lib/ledger'
import { WIDE_GRAPHEME, graphemeCells, graphemesOf } from './cells'
import type { GradientName, Paint } from './neon'
import { OFF_STYLE, paintOf } from './neon'
import type { TaskBar } from '../lib/progress'

/** Một ký hiệu có màu. Hình dạng khác nhau để đọc được cả khi terminal không có màu. */
export type Mark = { glyph: string; color: Color; dim?: boolean; bold?: boolean }

/** Một đoạn chữ có màu, để ghép vào Text lồng nhau. */
/** `bg`: nền của đoạn (0.8.8 N1), cho ô tô đặc. */
export type Run = { text: string; color: Color; dim?: boolean; bold?: boolean; bg?: Color }

export { graphemeCells, graphemesOf }

export const SPINE = '▎'

export const FAMILY_HUE: Record<ModelFamily, Color> = {
  haiku: 'planMode',
  sonnet: 'suggestion',
  opus: 'merged',
  fable: 'bashBorder',
}

/** Bảy trạng thái của bước. ✓ có bằng chứng, ● xong nhưng chưa có bằng chứng, ◐ đang làm, ■ bị chặn, ◇ đang chờ việc bên ngoài. */
export const STEP_MARK: Record<StepStatus, Mark> = {
  verified: { glyph: '✓', color: 'success', bold: true },
  done: { glyph: '●', color: 'success', dim: true },
  doing: { glyph: '◐', color: 'claude', bold: true },
  blocked: { glyph: '■', color: 'warning', bold: true },
  waiting: { glyph: '◇', color: 'ide' },
  todo: { glyph: '○', color: 'inactive' },
  skipped: { glyph: '–', color: 'inactive', dim: true },
}

/** Thứ tự chú giải: từ xong chắc chắn tới chưa bắt đầu. */
export const STEP_ORDER: readonly StepStatus[] = ['verified', 'done', 'doing', 'waiting', 'blocked', 'todo', 'skipped']

export const TASK_MARK: Record<DelegationState, Mark> = {
  pending: STEP_MARK.todo,
  running: STEP_MARK.doing,
  done: STEP_MARK.done,
  failed: { glyph: '✕', color: 'error', bold: true },
}

export const TASK_COLOR: Record<DelegationState, Color | undefined> = {
  pending: undefined,
  running: 'claude',
  done: undefined,
  failed: 'error',
}

export type Severity = 'error' | 'warning'

/** Lặp và vượt phạm vi là vi phạm (đỏ); các loại còn lại là cần chú ý (vàng). */
export function severityOf(kind: WarningKind): Severity {
  return kind === 'loop' || kind === 'scope' ? 'error' : 'warning'
}

export function severityGlyph(severity: Severity): string {
  return severity === 'error' ? '▲' : '△'
}

export function isClosed(step: PlanStep): boolean {
  return step.status === 'done' || step.status === 'verified' || step.status === 'skipped'
}

/** Bước đang là tâm điểm: đang làm, nếu không thì bước bị chặn đầu tiên, rồi bước chờ làm đầu tiên, rồi bước đang chờ việc ngoài. */
export function currentStep(plan: readonly PlanStep[]): PlanStep | undefined {
  return plan.find(s => s.status === 'doing') ?? plan.find(s => s.status === 'blocked') ?? plan.find(s => s.status === 'todo') ?? plan.find(s => s.status === 'waiting')
}

// ------------------------------------------------------------ tiến độ

/** Giai đoạn của tiến độ chung. `idle` là đã có kế hoạch nhưng chưa bước nào bắt đầu. */
export type Phase = 'idle' | 'start' | 'active' | 'almost' | 'done'

/** Màu của thanh theo giai đoạn: xanh dương mới bắt đầu, cam đang thực hiện, vàng sắp xong, xanh lá hoàn thành. */
export const PHASE_HUE: Record<Phase, Color> = {
  idle: 'inactive',
  start: 'ide',
  active: 'claude',
  almost: 'warning',
  done: 'success',
}

/** Tỷ lệ bước đã đóng: dưới START_BELOW là mới bắt đầu, từ ALMOST_FROM là sắp xong. Đổi hai số này để dời ngưỡng. */
export const START_BELOW = 0.25
export const ALMOST_FROM = 0.75

/**
 * Giai đoạn theo tỷ lệ bước đã đóng (xong, kiểm chứng hoặc bỏ qua). Kế hoạch từ 3 bước trở lên cũng coi là sắp xong khi
 * chỉ còn đúng một bước, để kế hoạch ngắn vẫn đi qua đủ bốn giai đoạn.
 */
export function phaseOf(plan: readonly PlanStep[]): Phase {
  const total = plan.length
  if (total === 0) return 'idle'
  const closed = plan.filter(isClosed).length
  if (closed >= total) return 'done'
  if (closed / total >= ALMOST_FROM || (total >= 3 && total - closed === 1)) return 'almost'
  if (closed / total >= START_BELOW) return 'active'
  return plan.some(s => s.status !== 'todo') ? 'start' : 'idle'
}

/** Bộ màu theme key: mặc định của các hàm dựng thanh (status line và nơi gọi không truyền bộ màu), cho màu như 0.8.7. */
export const THEME_PAINT: Paint = paintOf(OFF_STYLE)

/** Chữ màu của một giai đoạn, bắt đầu ở ô `offset` của dải: neon thì dải màu (0.8.8 N1), off thì PHASE_HUE; idle là inactive. */
export function phaseRuns(paint: Paint, phase: Phase, text: string, extra: Omit<Run, 'text' | 'color'> = {}, offset = 0): Run[] {
  const name = paint.phase(phase)
  return text === '' ? [] : name === null ? [{ text, color: PHASE_HUE.idle, ...extra }] : paint.text(name, text, extra, offset)
}

/**
 * Thanh tiến độ rộng đúng `cells` ô. Phần đã đóng tô màu giai đoạn, phần còn lại là nét đứt mờ (hình dạng khác nhau nên
 * đọc được cả khi không có màu). Ô đầu tiên sau phần đã đóng là ký hiệu của bước đang là tâm điểm: ◐ cùng màu giai đoạn
 * khi đang làm, ■ vàng khi bị chặn. Xong hết thì thanh đầy, không có đầu thanh. Từ 0.8.8 màu giai đoạn lấy qua bộ màu `paint`
 * (neon: dải màu theo giai đoạn; mặc định THEME_PAINT cho màu như 0.8.7).
 */
export function barRuns(plan: readonly PlanStep[], cells: number, hasRunning = false, paint: Paint = THEME_PAINT): Run[] {
  const total = plan.length
  if (total === 0 || cells < 3) return []
  const closed = plan.filter(isClosed).length
  const phase = phaseOf(plan)
  const verified = plan.filter(s => s.status === 'verified').length
  // Phần đã đóng: phần verified (đã kiểm chứng) tô đậm đứng trước, phần done thường. Không có verified thì một đoạn như 0.6.1.
  const solid = (n: number): Run[] => {
    if (verified === 0) return phaseRuns(paint, phase, '━'.repeat(n))
    const bold = verified >= closed ? n : Math.max(1, Math.min(n - 1, Math.round((n * verified) / closed)))
    return [...phaseRuns(paint, phase, '━'.repeat(bold), { bold: true }), ...(n - bold > 0 ? phaseRuns(paint, phase, '━'.repeat(n - bold), {}, bold) : [])]
  }
  if (closed >= total) return solid(cells)
  const filled = closed === 0 ? 0 : Math.min(cells - 1, Math.max(1, Math.round((closed / total) * cells)))
  const status = currentStep(plan)?.status
  // W4: bước hiện tại còn todo mà đã có lô đang chạy thì đầu thanh cũng là ◐.
  const head: Run[] =
    status === 'doing' || (status === 'todo' && hasRunning)
      ? // ◐ của bước đang làm (0.8.8 N5): in đậm ở frame chẵn, thường ở frame lẻ (dải đứng yên thì frame là 0, luôn đậm).
        phaseRuns(paint, phase, STEP_MARK.doing.glyph, { bold: paint.frame % 2 === 0 }, filled)
      : status === 'blocked'
        ? [{ text: STEP_MARK.blocked.glyph, color: paint.solid('attention') ?? STEP_MARK.blocked.color, bold: true }]
        : status === 'waiting'
          ? [{ text: STEP_MARK.waiting.glyph, color: STEP_MARK.waiting.color, bold: true }]
          : []
  const runs: Run[] = []
  if (filled > 0) runs.push(...solid(filled))
  runs.push(...head)
  const track = cells - filled - head.length
  if (track > 0) runs.push({ text: '╌'.repeat(track), color: 'subtle' })
  return runs
}

/**
 * Thanh của một việc (0.6.1), dùng chung cho band, pane và status line. Có các bước thật thì đúng như barRuns (phần trăm
 * theo bước đã đóng). Không có thì chỉ trạng thái, không phần trăm: chờ giao hay chưa bắt đầu là nét đứt mờ, đang chạy là
 * đầu ◐ trên nét đứt, xong là thanh đầy màu success, lỗi là ■ màu error, bị cắt vì tạm dừng là ■ màu warning.
 */
export function taskBarRuns(bar: TaskBar, cells: number, paint: Paint = THEME_PAINT): Run[] {
  if (bar.kind === 'steps') return barRuns(bar.plan, cells, false, paint)
  if (cells < 3) return []
  const track = (n: number): Run[] => (n > 0 ? [{ text: '╌'.repeat(n), color: 'subtle' }] : [])
  switch (bar.state) {
    case 'done':
      return phaseRuns(paint, 'done', '━'.repeat(cells))
    case 'running':
      return [...phaseRuns(paint, 'active', STEP_MARK.doing.glyph, { bold: true }), ...track(cells - 1)]
    case 'failed':
      return [{ text: STEP_MARK.blocked.glyph, color: paint.solid('error') ?? 'error', bold: true }, ...track(cells - 1)]
    case 'cut':
      return [{ text: STEP_MARK.blocked.glyph, color: paint.solid('attention') ?? 'warning', bold: true }, ...track(cells - 1)]
    default:
      return [{ text: '╌'.repeat(cells), color: 'subtle', dim: true }]
  }
}

/**
 * Thanh tỷ lệ rộng `cells` ô (0.8.8 N4): phần đầy theo `ratio` (0 tới 1, làm tròn; tỷ lệ dương có ít nhất một ô), tô theo dải `name` của bộ
 * màu; phần còn lại là nét đứt mờ. Dùng cho thanh hạn mức và thanh chi phí của pane.
 */
export function ratioRuns(ratio: number, cells: number, paint: Paint, name: GradientName): Run[] {
  if (cells <= 0) return []
  const r = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0
  const filled = r > 0 ? Math.max(1, Math.round(r * cells)) : 0
  return [...paint.text(name, '━'.repeat(filled)), ...(cells - filled > 0 ? [{ text: '╌'.repeat(cells - filled), color: 'subtle' as Color }] : [])]
}

/**
 * Các ô ○ cho số bước router dự kiến khi Claude chưa chốt checklist: cách nhau một khoảng trắng nếu đủ chỗ, không thì
 * sát nhau, và không quá `cells` ô.
 */
export function plannedRuns(planned: number, cells: number, running: ReadonlySet<number> = new Set()): Run[] {
  const n = Math.min(planned, Math.max(0, cells))
  if (n <= 0) return []
  const spaced = n * 2 - 1 <= cells
  return Array.from({ length: n }, (_, i) => ({ text: (running.has(i) ? STEP_MARK.doing.glyph : STEP_MARK.todo.glyph) + (spaced && i < n - 1 ? ' ' : ''), color: running.has(i) ? STEP_MARK.doing.color : STEP_MARK.todo.color }))
}

/** Tổng USD của mục tiêu hiện tại theo số đo. */
export function goalUsd(ledger: Ledger): number {
  return GROUPS.reduce((sum, group) => sum + ledger.goal.buckets[group].usd, 0)
}

/** Phần USD còn là ước tính lúc giao việc, chưa có số đo. */
export function pendingUsd(log: readonly RouteEvent[]): number {
  return log
    .filter(entry => entry.where === 'agent' && entry.usd !== undefined && entry.measured !== true)
    .reduce((sum, entry) => sum + (entry.usd ?? 0), 0)
}

// ------------------------------------------------------------------ chữ

/** Số ô terminal của một chuỗi (mọi ký tự đang dùng đều rộng một ô). */
export function cellsOf(text: string): number {
  return [...text.normalize('NFC')].length
}

export function padEnd(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - cellsOf(text)))
}

export function padStart(text: string, width: number): string {
  return ' '.repeat(Math.max(0, width - cellsOf(text))) + text
}

/** Ngắt dòng theo từ tới `width` ô; dòng cuối kết bằng "…" khi còn thừa chữ sau `maxLines` dòng. */
export function wrapText(text: string, width: number, maxLines: number): string[] {
  const limit = Math.max(8, width)
  const lines: string[] = []
  let line = ''
  const push = () => {
    lines.push(line)
    line = ''
  }
  for (const raw of text.normalize('NFC').split(/\s+/).filter(Boolean)) {
    let word = raw
    while (cellsOf(word) > limit) {
      if (line) push()
      lines.push([...word].slice(0, limit).join(''))
      word = [...word].slice(limit).join('')
    }
    if (line === '') line = word
    else if (cellsOf(line) + 1 + cellsOf(word) <= limit) line += ' ' + word
    else {
      push()
      line = word
    }
  }
  if (line) push()
  if (lines.length <= maxLines) return lines.length > 0 ? lines : ['']
  const kept = lines.slice(0, maxLines)
  const last = [...(kept[maxLines - 1] ?? '')]
  kept[maxLines - 1] = (last.length >= limit ? last.slice(0, limit - 1) : last).join('').trimEnd() + '…'
  return kept
}


/**
 * Một dòng không quá `cells` ô, dòng bị cắt kết bằng "…" (0.7.9, UI1). Chữ thường cắt theo từ bằng wrapText như mọi chữ của pane, nên
 * mã đầu tên ("BƯỚC 7", "Việc 3", "K4.1") giữ trọn. Chuỗi có chữ CJK, emoji hay cụm nhiều code point thì đếm ô thật (hai ô cho chữ rộng)
 * và chỉ cắt giữa hai cụm ký tự, không tách đôi một emoji.
 */
export function oneLine(text: string, cells: number): string {
  const units = graphemesOf(text.normalize('NFC').replace(/\s+/g, ' ').trim())
  if (units.every(g => [...g].length === 1 && !WIDE_GRAPHEME.test(g))) return wrapText(text, cells, 1)[0] ?? ''
  if (units.reduce((sum, g) => sum + graphemeCells(g), 0) <= cells) return units.join('')
  let used = 1
  let kept = ''
  for (const g of units) {
    if (used + graphemeCells(g) > cells) break
    used += graphemeCells(g)
    kept += g
  }
  return `${kept.trimEnd()}…`
}

/** Chiều rộng hợp lệ của vùng vẽ; dùng giá trị dự phòng khi engine không báo. */
export function columnsOf(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}
