// Band phía trên prompt, hướng B "Ba ô phát sáng" (0.8.8 N2): nhìn một lần là biết đang ở bước nào, model nào đang chạy, và công việc
// có đi đúng hướng không.
//   Dòng 1: ba ô cách nhau một ô trống. Ô bước (số bước k/n và tên bước hiện tại; chưa có checklist thì mục tiêu), ô model (họ, effort,
//   vai điều phối), ô hướng (ký hiệu và nhãn theo mục cần chú ý đầu tiên, direction.ts). Mỗi lúc chỉ một ô tô đặc: ô hướng khi vi phạm,
//   tạm dừng hay xong và đã kiểm hết; còn lại là ô bước, tô theo dải màu của giai đoạn.
//   Dòng 2: bên trái câu cần chú ý đầu tiên kèm +N, hay lý do tạm dừng, hay thanh tiến độ (rồi subagent đang chạy, không có thì mục tiêu,
//   khi còn chỗ), hay các ô ○ dự kiến; bên phải hạn mức, thời gian đã chạy, chi phí (từ 96 cột), chip lô, nhãn phản chiếu, nút Chi tiết
//   và Ẩn (từ 72 cột). Tạm dừng thì bên phải là lệnh chạy tiếp rồi nút Chi tiết.
// maxRows 1 thì chỉ dòng 1: ba ô, phần bên phải và hai nút. Band không còn gờ bên trái; hộp ngoài vẫn có hai cột (cột đầu rỗng) để cấu trúc
// cây như 0.8.7. Màu lấy qua bộ màu của neon.ts (neon off: theme key như 0.8.7).
// Hàm vẽ thuần: nhận bảng phần tử của surface, dữ liệu và các handler mà hook đã tạo; không tự gọi $.

import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import { conductorShown } from '../lib/conductor'
import type { ConductorShown } from '../lib/conductor'
import { shownPlan } from '../lib/mirror'
import { runningTitles, taskRows } from '../lib/progress'
import type { QuotaBadge } from '../lib/quota'
import type { View } from '../lib/state'
import { countLabel, progress, quotaPercent } from '../lib/text'
import type { BandQuota } from '../lib/text'
import { attentionItems, failedBatches } from './attention'
import { directionOf, directionText } from './direction'
import type { Direction } from './direction'
import { formatCost } from '../lib/ledger'
import { labels, taskLabel } from './labels'
import type { Run } from './style'
import { DEFAULT_NEON, paintOf } from './neon'
import type { GradientName } from './neon'
import { barRuns, cellsOf, columnsOf, currentStep, goalUsd, oneLine, pendingUsd, phaseOf, plannedRuns, severityGlyph } from './style'

/** Lượt của luồng chính chạy đúng họ đang điều phối (0.8.4 C8; 0.8.7 F1: kể cả họ dự phòng): band thêm nhãn vai trên chip model. */
function isConductedRoute(family: string | undefined, shown: ConductorShown, primary: string | undefined): boolean {
  if (shown.state === 'on') return family === primary
  return shown.state === 'fallback' && shown.isBig && family === shown.family
}

/** Ô một nút của engine chiếm [Giả định: khoảng 10 ô cho nhãn ngắn, chưa đo trên surface thật]. */
export const BUTTON_CELLS = 10
const buttonCells = (label: string) => Math.max(BUTTON_CELLS, cellsOf(label) + 2)
/** Band rộng từ bấy nhiêu ô mới có nhãn vai điều phối trên ô model (0.8.4 C8). */
const ROLE_COLUMNS = 72
/** Số ô tối thiểu giữ cho tên bước trong ô bước khi band hẹp phải bỏ chip [Giả định: đủ thấy mã bước như "BƯỚC 4"]. */
const FOCUS_CELLS = 4
/** Ký hiệu tạm dừng (0.7.6, U3): U+23F8. */
const PAUSE_GLYPH = '\u23F8'

export type BandHandlers = {
  onDetails: () => unknown
  onHide: () => unknown
}

export type BandProps = {
  /** Số dòng band được phép chiếm. */
  maxRows: number
  /** Số ô band được vẽ, không tính dấu [-] của engine. */
  columns: number
  /** Đang có một turn chạy. */
  isWorking: boolean
  /** Thời điểm vẽ (ms), cho thời gian đã chạy của mục tiêu và của subagent. Vắng thì 0. */
  now?: number
  /** Nhịp của dải màu (0.8.8 N5): số giây của đồng hồ lúc vẽ. Vắng thì 0. */
  frame?: number
}

/** Dải tô đặc của ô hướng theo cách tô. */
const DIRECTION_FILL: Partial<Record<Direction['tone'], GradientName>> = { warn: 'warn', pause: 'pause', done: 'done' }

/** Trả cây để vẽ, hoặc null khi band nên nhường chỗ cho engine. */
export function renderBand(
  t: Elements[RenderSurface],
  view: View,
  props: BandProps,
  handlers: BandHandlers,
  /** Bảo vệ hạn mức (0.6.0): nhãn đang dừng hay phần còn lại khi gần ngưỡng; null hay vắng thì band như cũ. */
  quota: QuotaBadge | null = null,
  /** Hạn mức cho dòng 2 khi dừng và câu báo mềm (0.7.6, U3); null hay vắng thì không có. */
  pause: BandQuota | null = null,
): RenderElement | null {
  const { brief, route, ledger, log } = view.core
  // Checklist để vẽ: của tool plan, nếu chưa có thì danh sách việc Claude Code tự ghi (phản chiếu, 0.6.1).
  const { plan, source } = shownPlan(view.core)
  if (view.mode === 'off' || brief === null || view.isBandHidden) return null
  const { Box, Text, Button } = t

  const l = labels(view.lang)
  const columns = columnsOf(props.columns, 100)
  const isWide = columns >= 96
  const hasRoom = columns >= 72
  const now = props.now ?? 0
  const hasSecondRow = props.maxRows >= 2
  // Bộ màu (0.8.8 N1): dải màu neon theo option, hay theme key khi neon off.
  const paint = paintOf(view.neon ?? DEFAULT_NEON, props.frame ?? 0)

  // Mục cần chú ý (U2) và ô hướng: mục quan trọng nhất theo mức độ; "+N" đếm phần còn lại.
  const isPaused = pause?.paused === true
  const attention = attentionItems(view.core, view.lang, { paused: false, notice: pause?.notice ?? null })
  const top = attention[0]
  const others = attention.length - 1
  const direction = directionOf(view.core, view.lang, { paused: isPaused, notice: pause?.notice ?? null }, plan)
  const directionFill = DIRECTION_FILL[direction.tone]

  const { closed, total } = progress(plan)
  const planned = total === 0 ? brief.steps.length : 0
  const current = currentStep(plan)
  const rows = taskRows(view.core, now)
  // W4: bước còn todo mà đã có lô đang chạy: đầu thanh là ◐ (có checklist) hay hạt dự kiến là ◐ (chưa có).
  const runningSteps = runningTitles(view.core, rows, plan.length > 0 ? plan.map(step => step.title) : brief.steps)
  const runningBeads = new Set(brief.steps.flatMap((step, i) => (runningSteps.has(step) ? [i] : [])))
  const isFinished = total > 0 && closed === total
  const phase = phaseOf(plan)
  // Thanh dài theo chiều rộng, tối thiểu 6 ô để còn thấy phần đã đóng.
  const barCells = Math.max(6, Math.min(20, Math.floor(columns * 0.16)))
  const bar = barRuns(plan, barCells, current !== undefined && runningSteps.has(current.title), paint)
  const beads = plannedRuns(planned, Math.max(8, Math.min(24, Math.floor(columns * 0.22))), runningBeads)

  const tint = (r: Run, k?: number) => (
    <Text key={k} color={r.color} backgroundColor={r.bg} dimColor={r.dim} bold={r.bold}>
      {r.text}
    </Text>
  )
  const runsNode = (runs: readonly Run[]) => <Text>{runs.map(tint)}</Text>

  // Phần bên phải: hạn mức, thời gian đã chạy của mục tiêu (U8), chi phí (từ 96 cột), chip lô subagent (U4), nhãn phản chiếu.
  const pending = pendingUsd(log)
  const spent = goalUsd(ledger) + pending
  const costText = isWide && spent > 0 ? `${pending > 0 ? '~' : ''}${formatCost(spent, view.lang)}` : ''
  const elapsedText = now > brief.at ? l.goalElapsed(now - brief.at) : ''
  const quotaText = quota ? (quota.paused ? (columns >= 56 ? l.quotaPaused : l.quotaPausedShort) : l.quotaLeft(quotaPercent(quota.left ?? 0))) : ''
  const runningBatches = rows.filter(row => row.kind === 'agent' && row.state === 'running').reduce((sum, row) => sum + (row.counts?.running ?? 1), 0)
  const failed = failedBatches(view.core)
  const agentChip = !isFinished && (runningBatches > 0 || failed > 0) ? l.agentBatchChip(runningBatches, failed) : ''
  const countText = total > 0 ? countLabel(plan) : ''
  // Nguồn phản chiếu ghi nhỏ khi còn chỗ: người dùng biết checklist này không chặn kết thúc.
  const mirrorText = source === 'mirror' && hasRoom ? l.mirrorShort : ''

  // Band hẹp: bỏ lần lượt nhãn vai điều phối, chip lô, effort, thời gian đã chạy, cả ô model cho tới khi vừa. maxRows 1 hay band dưới 56 cột
  // (0.8.8 N6b) bỏ thêm nút Ẩn, phần bên phải, rồi cắt nhãn ô hướng còn ký hiệu; từ 16 cột trở xuống bỏ cả nút Chi tiết (bước cuối; mở pane
  // bằng /conductor). Ô hướng không bao giờ bị bỏ.
  const fit = { role: true, agents: true, effort: true, elapsed: true, route: true, hide: true, right: true, label: true, details: true }
  const roleText = view.conductor !== undefined && columns >= ROLE_COLUMNS && isConductedRoute(route?.family, conductorShown(view.core, view.conductor?.family), view.conductor?.family) ? l.conductorRole : ''
  const modelWords = () =>
    route && fit.route
      ? [...(view.mode === 'suggest' ? [l.suggest] : []), route.family, ...(fit.effort ? [route.effort] : []), ...(fit.role && roleText && view.mode !== 'suggest' ? [roleText] : [])]
      : []
  const modelCells = () => (modelWords().length > 0 ? 2 + cellsOf(modelWords().join(' ')) : 0)
  const directionCells = () => 2 + cellsOf(fit.label ? directionText(direction) : direction.glyph)
  // Tạm dừng (U3): dòng 2 là lý do và giờ làm mới bên trái, điểm dừng và lệnh chạy tiếp bên phải; cả hai co được, engine cắt khi vẽ.
  const rightParts = () => (!fit.right || (isPaused && pause !== null) ? [] : [quotaText, fit.elapsed ? elapsedText : '', costText, fit.agents ? agentChip : '', mirrorText].filter(Boolean))
  const rightCells = () => rightParts().reduce((sum, part) => sum + cellsOf(part) + 1, 0)
  const buttonsCells = () => (fit.details ? 1 + buttonCells(l.details) : 0) + (hasRoom && !isPaused && fit.hide ? 1 + buttonCells(l.hide) : 0)
  // Ô bước giữ ít nhất số bước và FOCUS_CELLS ô của tên.
  const stepFloor = 2 + (countText ? cellsOf(countText) + 1 : 0) + FOCUS_CELLS
  const line1Cells = () => stepFloor + (modelCells() > 0 ? 1 + modelCells() : 0) + 1 + directionCells() + (hasSecondRow ? 0 : rightCells() + buttonsCells())
  const leftFloor = 6
  const line2Cells = () => (hasSecondRow ? leftFloor + 1 + rightCells() + buttonsCells() : 0)
  const isTight = !hasSecondRow || columns < 56
  const drops = [
    () => (fit.role = false),
    () => (fit.agents = false),
    () => (fit.effort = false),
    () => (fit.elapsed = false),
    () => (fit.route = false),
    ...(isTight ? [() => (fit.hide = false), () => (fit.right = false), () => (fit.label = false)] : []),
    ...(columns <= 16 ? [() => (fit.details = false)] : []),
  ]
  for (const drop of drops) {
    if (line1Cells() <= columns && line2Cells() <= columns) break
    drop()
  }

  // ---------------------------------------------------------------- ô bước
  // Tên bước hiện tại (mã có trong tên); xong hết thì "Đã xong mọi bước"; chưa có checklist thì mục tiêu. Cắt bằng oneLine theo chỗ còn lại.
  const focusText = current ? current.title : isFinished ? l.allClosed : brief.goal
  const stepRoom = Math.max(FOCUS_CELLS, columns - (line1Cells() - stepFloor) - 2 - (countText ? cellsOf(countText) + 1 : 0))
  const focus = oneLine(focusText, stepRoom)
  const isStepFilled = directionFill === undefined
  const stepGradient = paint.phase(phase)
  // Ô bước dựng từ các đoạn: khoảng đệm, số bước (một Text riêng, như 0.8.7), tên bước (một Text riêng), khoảng đệm. Ô tô đặc thì mỗi đoạn
  // tô nền theo dải màu của giai đoạn, nối tiếp vị trí trong dải; ô thường thì nền ô thường.
  const stepParts: { text: string; bold?: boolean }[] = [
    { text: ' ' },
    ...(countText ? [{ text: countText, bold: true }, { text: ' ' }] : []),
    { text: focus, bold: props.isWorking || !countText },
    { text: ' ' },
  ]
  const stepCell = (() => {
    let offset = 0
    const nodes = stepParts.map((part, k) => {
      const at = offset
      offset += cellsOf(part.text)
      const runs: Run[] = !isStepFilled
        ? [{ text: part.text, color: paint.solid('onCell') ?? 'text', ...(paint.solid('cell') !== undefined ? { bg: paint.solid('cell') } : {}) }]
        : stepGradient !== null
          ? paint.fill(stepGradient, part.text, {}, at)
          : [{ text: part.text, color: 'inverseText', bg: 'inactive' }]
      return (
        <Text key={k} bold={part.bold} wrap="truncate-end">
          {runs.map(run => (
            <Text color={isStepFilled || paint.isNeon ? run.color : undefined} backgroundColor={run.bg} wrap="truncate-end">
              {run.text}
            </Text>
          ))}
        </Text>
      )
    })
    return <Text wrap="truncate-end">{nodes}</Text>
  })()

  // ---------------------------------------------------------------- ô model
  // Chữ mờ trên nền ô (0.8.8 N6a): neon thì màu thô onCellDim (dimColor của theme không đảm bảo tương phản với nền thô), off thì dimColor.
  const dimOnCell = paint.isNeon ? { color: paint.solid('onCellDim') } : { dimColor: true }
  const isModelDim = isPaused || isFinished
  const modelCell =
    route && fit.route ? (
      <Text backgroundColor={paint.solid('cell')} color={paint.solid('onCell')}>
        <Text>{' '}</Text>
        {view.mode === 'suggest' ? <Text {...dimOnCell}>{`${l.suggest} `}</Text> : null}
        <Text {...(isModelDim ? dimOnCell : { color: paint.solid(route.family) })} bold>
          {route.family}
        </Text>
        {fit.effort ? <Text {...dimOnCell}>{` ${route.effort}`}</Text> : null}
        {fit.role && roleText && view.mode !== 'suggest' ? <Text {...dimOnCell}>{` ${roleText}`}</Text> : null}
        <Text>{' '}</Text>
      </Text>
    ) : null

  // ---------------------------------------------------------------- ô hướng
  const directionBody = ` ${fit.label ? directionText(direction) : direction.glyph} `
  const directionCell =
    directionFill !== undefined ? (
      runsNode(paint.fill(directionFill, directionBody, { bold: true }))
    ) : (
      <Text backgroundColor={paint.solid('cell')} color={paint.solid(direction.tone === 'ok' ? 'ok' : 'attention')} bold>
        {directionBody}
      </Text>
    )

  const detailsButton = fit.details ? <Button key="details" label={l.details} onPress={handlers.onDetails} /> : null
  const hideButton = hasRoom && !isPaused && fit.hide ? <Button key="hide" plain dimColor label={l.hide} onPress={handlers.onHide} /> : null
  const rightNodes = rightParts().map(part => (
    <Box flexShrink={0}>
      <Text color={isPaused || part === quotaText ? paint.solid('attention') : undefined} dimColor={!isPaused && part !== quotaText} bold={quota?.paused === true && part === quotaText}>
        {part}
      </Text>
    </Box>
  ))

  const cells = (
    <Box flexDirection="row" gap={1}>
      <Box flexShrink={1}>{stepCell}</Box>
      {modelCell !== null ? <Box flexShrink={0}>{modelCell}</Box> : null}
      <Box flexShrink={0}>{directionCell}</Box>
      {hasSecondRow ? null : (
        <Box flexGrow={1} flexShrink={1} flexDirection="row" justifyContent="flex-end" gap={1}>
          {/* maxRows 1 khi tạm dừng: dòng tạm dừng (lý do, giờ làm mới) nằm ở phần bên phải, co được. */}
          {isPaused && pause !== null ? (
            <Box flexGrow={1} flexShrink={1}>
              <Text color={paint.solid('attention')} bold wrap="truncate-end">
                {`${PAUSE_GLYPH} ${pause.line}`}
              </Text>
            </Box>
          ) : null}
          {rightNodes}
          {detailsButton}
          {hideButton}
        </Box>
      )}
    </Box>
  )

  // ----------------------------------------------------------------- dòng 2
  // Bên trái theo thứ tự ưu tiên: câu cần chú ý đầu tiên (mức đỏ tô dải warn, in đậm) kèm +N; tạm dừng: lý do và giờ làm mới; có checklist:
  // thanh tiến độ, rồi subagent đang chạy (không có thì mục tiêu) khi còn chỗ; chưa có checklist: các ô ○ dự kiến.
  const firstAgent = rows.find(row => row.kind === 'agent' && row.state === 'running')
  const left = (() => {
    if (isPaused && pause !== null) {
      return (
        <Box flexDirection="row" gap={1}>
          <Box flexGrow={1} flexShrink={1}>
            <Text color={paint.solid('attention')} bold wrap="truncate-end">
              {`${PAUSE_GLYPH} ${pause.line}`}
            </Text>
          </Box>
          <Box flexShrink={1}>
            <Text color={paint.solid('attention')} wrap="truncate-end">
              {pause.resume}
            </Text>
          </Box>
        </Box>
      )
    }
    if (top !== undefined) {
      const more = others > 0 ? `+${others}` : ''
      const sentence = `${severityGlyph(top.severity)} ${top.text}`
      return (
        <Box flexDirection="row" gap={1}>
          <Box flexGrow={1} flexShrink={1}>
            {top.severity === 'error' ? <Text wrap="truncate-end">{paint.text('warn', sentence, { bold: true }).map(tint)}</Text> : <Text color={paint.solid('attention')} bold wrap="truncate-end">{sentence}</Text>}
          </Box>
          {more ? (
            <Box flexShrink={0}>
              <Text dimColor>{more}</Text>
            </Box>
          ) : null}
        </Box>
      )
    }
    if (bar.length > 0) {
      // Xong hết: thanh đầy bằng dải done (barRuns tô theo giai đoạn done), rồi "Hoàn thành: <mục tiêu>" (U10). Sau thanh là một Text riêng,
      // co được (engine cắt khi vẽ).
      const tail = isFinished ? l.completedGoal(brief.goal) : firstAgent !== undefined ? `${l.agentsRunning(runningBatches)}: ${taskLabel(l, firstAgent)}` : brief.goal
      return (
        <Box flexDirection="row" gap={1}>
          <Box flexShrink={0}>
            <Text>{bar.map(tint)}</Text>
          </Box>
          <Box flexGrow={1} flexShrink={1}>
            <Text dimColor wrap="truncate-end">
              {tail}
            </Text>
          </Box>
        </Box>
      )
    }
    if (beads.length > 0) {
      return (
        <Text wrap="truncate-end">
          {beads.map(tint)}
          <Text dimColor>{` ${l.plannedSteps(planned)}`}</Text>
        </Text>
      )
    }
    return firstAgent !== undefined ? (
      <Text dimColor wrap="truncate-end">
        {`${l.agentsRunning(runningBatches)}: ${taskLabel(l, firstAgent)}`}
      </Text>
    ) : (
      <Text>{' '}</Text>
    )
  })()

  const lines: RenderElement[] = [cells]
  if (hasSecondRow) {
    lines.push(
      <Box flexDirection="row" gap={1}>
        <Box flexGrow={1} flexShrink={1}>
          {left}
        </Box>
        {rightNodes}
        {detailsButton}
        {hideButton}
      </Box>,
    )
  }

  return (
    <Box flexDirection="row">
      <Box flexDirection="column" flexShrink={0} />
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        {lines}
      </Box>
    </Box>
  )
}

