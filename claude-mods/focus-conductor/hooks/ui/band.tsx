// Band phía trên prompt (0.7.6): nhìn một lần là biết đang ở bước nào, tiến độ chung, và có việc gì cần người dùng can thiệp không.
//   Dòng 1: thanh tiến độ, số bước, mã và tên bước hiện tại; bên phải chip model, thời gian đã chạy, chi phí (từ 96 cột), nút Chi tiết.
//   Dòng 2: một dòng cần chú ý xếp theo mức độ (attention.ts); không có gì cần chú ý thì subagent đang chạy; không có nữa thì mục tiêu (mờ).
// maxRows 1 thì chỉ dòng 1, và cảnh báo mức đỏ thế chỗ tên bước. Mục tiêu đầy đủ nằm ở pane. Gờ bên trái đổi màu theo mục cần chú ý
// đầu tiên: cam là bình thường, vàng là cần chú ý, đỏ là vi phạm.
// Hàm vẽ thuần: nhận bảng phần tử của surface, dữ liệu và các handler mà hook đã tạo; không tự gọi $.

import type { Color, Elements, RenderElement, RenderSurface } from 'claude-code'

import { shownPlan } from '../lib/mirror'
import { taskRows } from '../lib/progress'
import type { QuotaBadge } from '../lib/quota'
import type { View } from '../lib/state'
import { countLabel, progress, quotaPercent } from '../lib/text'
import type { BandQuota } from '../lib/text'
import { attentionItems, failedBatches } from './attention'
import { labels, taskLabel } from './labels'
import type { Run } from './style'
import { FAMILY_HUE, SPINE, barRuns, cellsOf, columnsOf, currentStep, goalUsd, pendingUsd, plannedRuns, severityGlyph, shownUsd } from './style'

/** Ô một nút của engine chiếm [Giả định: khoảng 10 ô cho nhãn ngắn, chưa đo trên surface thật]. */
export const BUTTON_CELLS = 10
const buttonCells = (label: string) => Math.max(BUTTON_CELLS, cellsOf(label) + 2)
const runCells = (runs: readonly Run[]) => runs.reduce((sum, r) => sum + cellsOf(r.text), 0)
/** Số ô tối thiểu giữ cho tên bước ở dòng 1 khi band hẹp phải bỏ chip [Giả định: đủ thấy mã bước như "BƯỚC 4"]. */
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
}

/** Trả cây để vẽ, hoặc null khi band nên nhường chỗ cho engine. */
export function renderBand(
  t: Elements[RenderSurface],
  view: View,
  props: BandProps,
  handlers: BandHandlers,
  /** Bảo vệ hạn mức (0.6.0): nhãn đang dừng hay phần còn lại khi gần ngưỡng; null hay vắng thì band như cũ. */
  quota: QuotaBadge | null = null,
  /** Hạn mức cho dòng 1, dòng 2 khi dừng và câu báo mềm (0.7.6, U3); null hay vắng thì không có. */
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

  // Dòng cần chú ý (U2): mục quan trọng nhất theo mức độ; "+N" đếm phần còn lại.
  const isPaused = pause?.paused === true
  const attention = attentionItems(view.core, view.lang, { paused: false, notice: pause?.notice ?? null })
  const top = attention[0]
  const others = attention.length - 1
  const spine: Color = isPaused ? 'warning' : (top?.severity ?? 'claude')

  const { closed, total } = progress(plan)
  const planned = total === 0 ? brief.steps.length : 0
  const current = currentStep(plan)
  // Thanh dài theo chiều rộng, tối thiểu 6 ô để còn thấy phần đã đóng.
  const bar = barRuns(plan, Math.max(6, Math.min(20, Math.floor(columns * 0.16))))
  const beads = plannedRuns(planned, Math.max(8, Math.min(24, Math.floor(columns * 0.22))))

  const tint = (r: Run) => (
    <Text color={r.color} dimColor={r.dim} bold={r.bold}>
      {r.text}
    </Text>
  )

  // Bên phải dòng 1: hạn mức, chip model, thời gian đã chạy của mục tiêu (U8), chi phí (từ 96 cột), chip subagent.
  const pending = pendingUsd(log)
  const spent = goalUsd(ledger) + pending
  const costText = isWide && spent > 0 ? `${pending > 0 ? '~' : ''}${shownUsd(spent, view.lang)}` : ''
  const elapsedText = now > brief.at ? l.goalElapsed(now - brief.at) : ''
  const quotaText = quota ? (quota.paused ? (columns >= 56 ? l.quotaPaused : l.quotaPausedShort) : l.quotaLeft(quotaPercent(quota.left ?? 0))) : ''
  const rows = taskRows(view.core, now)
  // Chip lô subagent (U4): chỉ khi có lô đang chạy hay lỗi, không hiện khi mọi bước đã đóng.
  const runningBatches = rows.filter(row => row.kind === 'agent' && row.state === 'running').reduce((sum, row) => sum + (row.counts?.running ?? 1), 0)
  const failed = failedBatches(view.core)
  const isFinished = total > 0 && closed === total
  const agentChip = !isFinished && (runningBatches > 0 || failed > 0) ? l.agentBatchChip(runningBatches, failed) : ''
  const countText = countLabel(plan)
  // Nguồn phản chiếu ghi nhỏ cạnh số bước khi còn chỗ: người dùng biết checklist này không chặn kết thúc.
  const mirrorText = source === 'mirror' && hasRoom ? l.mirrorShort : ''

  // Band hẹp: phần không co (gờ, tiến độ, chip, nút) không được vượt chiều rộng. Thừa thì bỏ lần lượt chip subagent, mức effort, thời gian
  // đã chạy, rồi cả chip model.
  const fit = { agents: true, effort: true, elapsed: true, route: true }
  const progressCells = () =>
    bar.length > 0 ? runCells(bar) + 1 + cellsOf(countText) + (mirrorText ? 1 + cellsOf(mirrorText) : 0) : beads.length > 0 ? runCells(beads) + 1 + cellsOf(l.plannedSteps(planned)) : 0
  const chipCells = () => {
    const parts = [
      cellsOf(quotaText),
      route && fit.route ? cellsOf(route.family) + 2 + (fit.effort ? 1 + cellsOf(route.effort) : 0) : 0,
      fit.elapsed ? cellsOf(elapsedText) : 0,
      cellsOf(costText),
      fit.agents ? cellsOf(agentChip) : 0,
    ].filter(n => n > 0)
    return parts.reduce((a, b) => a + b, 0) + Math.max(0, parts.length - 1)
  }
  // Tên bước được giữ ít nhất FOCUS_CELLS ô trước khi bỏ chip; riêng chip subagent nhường cả tên bước (U4: tên việc ưu tiên hơn chip).
  const focusWant = () => (fit.agents && agentChip ? Math.max(FOCUS_CELLS, cellsOf(current?.title ?? brief.goal)) : FOCUS_CELLS)
  const fixedCells = () => 2 + progressCells() + 1 + focusWant() + 1 + chipCells() + 1 + buttonCells(l.details) + (hasRoom ? 1 + buttonCells(l.hide) : 0)
  for (const drop of [() => (fit.agents = false), () => (fit.effort = false), () => (fit.elapsed = false), () => (fit.route = false)]) {
    if (fixedCells() <= columns) break
    drop()
  }

  const routeNode =
    route && fit.route ? (
      view.mode === 'suggest' ? (
        <Text>
          <Text dimColor>{l.suggest} </Text>
          <Text color={FAMILY_HUE[route.family]} bold>
            {route.family}
          </Text>
          {fit.effort ? <Text dimColor> {route.effort}</Text> : null}
        </Text>
      ) : (
        <Text>
          <Text backgroundColor={FAMILY_HUE[route.family]} color="inverseText" bold>
            {` ${route.family} `}
          </Text>
          {fit.effort ? <Text dimColor> {route.effort}</Text> : null}
        </Text>
      )
    ) : null
  const chipNodes = [
    quota ? (
      <Text color="warning" bold={quota.paused}>
        {quotaText}
      </Text>
    ) : null,
    routeNode,
    fit.elapsed && elapsedText ? <Text dimColor>{elapsedText}</Text> : null,
    costText ? <Text dimColor>{costText}</Text> : null,
    fit.agents && agentChip ? <Text dimColor>{agentChip}</Text> : null,
  ].filter(node => node !== null)
  const chips =
    chipNodes.length > 0 ? (
      <Box flexShrink={0} flexDirection="row" gap={1}>
        {chipNodes}
      </Box>
    ) : null
  const detailsButton = <Button key="details" label={l.details} onPress={handlers.onDetails} />
  const hideButton = hasRoom ? <Button key="hide" plain dimColor label={l.hide} onPress={handlers.onHide} /> : null

  // Có checklist: thanh tô màu theo giai đoạn và số bước đã đóng (tên giai đoạn chỉ ở pane, U6). Chưa có: các ô ○ router dự kiến.
  const progressNode =
    bar.length > 0 ? (
      <Box key="progress" flexShrink={0} flexDirection="row" gap={1}>
        <Text>{bar.map(tint)}</Text>
        <Text bold>{countText}</Text>
        {mirrorText ? <Text dimColor>{mirrorText}</Text> : null}
      </Box>
    ) : beads.length > 0 ? (
      <Box key="progress" flexShrink={0} flexDirection="row" gap={1}>
        <Text>{beads.map(tint)}</Text>
        <Text dimColor>{l.plannedSteps(planned)}</Text>
      </Box>
    ) : null

  const alertNode = top ? (
    <Box flexDirection="row" gap={1}>
      <Box flexShrink={0}>
        <Text color={top.severity} bold>
          {severityGlyph(top.severity)}
        </Text>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text color={top.severity} wrap="truncate-end">
          {top.text}
        </Text>
      </Box>
      {others > 0 ? (
        <Box flexShrink={0}>
          <Text dimColor>{`+${others}`}</Text>
        </Box>
      ) : null}
    </Box>
  ) : null

  // Tâm điểm của dòng 1: tên bước hiện tại (mã có trong tên); xong hết thì "Đã xong mọi bước"; chưa có checklist thì mục tiêu.
  // maxRows 1 mà có mục mức đỏ thì mục đó thế chỗ, vì không còn dòng 2.
  const isGoalFocus = current === undefined && !(total > 0 && closed === total)
  const focus =
    !hasSecondRow && top && top.severity === 'error' ? (
      alertNode
    ) : current ? (
      <Text wrap="truncate-end" bold={props.isWorking}>
        {current.title}
      </Text>
    ) : total > 0 && closed === total ? (
      <Text dimColor wrap="truncate-end">
        {l.allClosed}
      </Text>
    ) : (
      <Text bold wrap="truncate-end">
        {brief.goal}
      </Text>
    )

  // Tạm dừng cứng (U3) chiếm dòng 1: lý do và giờ làm mới; dòng 2 là điểm dừng và lệnh chạy tiếp. Không còn gì khác trên band.
  if (isPaused && pause !== null) {
    const pauseLines: RenderElement[] = [
      <Box flexDirection="row" gap={1}>
        <Box flexGrow={1} flexShrink={1}>
          <Text color="warning" bold wrap="truncate-end">
            {`${PAUSE_GLYPH} ${pause.line}`}
          </Text>
        </Box>
        {detailsButton}
        {hideButton}
      </Box>,
      ...(hasSecondRow
        ? [
            <Text color="warning" wrap="truncate-end">
              {pause.resume}
            </Text>,
          ]
        : []),
    ]
    return (
      <Box flexDirection="row">
        <Box flexDirection="column" flexShrink={0} marginRight={1}>
          {pauseLines.map(() => (
            <Text color={spine}>{SPINE}</Text>
          ))}
        </Box>
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          {pauseLines}
        </Box>
      </Box>
    )
  }

  const lines: RenderElement[] = [
    <Box flexDirection="row" gap={1}>
      {progressNode}
      <Box flexGrow={1} flexShrink={1}>
        {focus}
      </Box>
      {chips}
      {detailsButton}
      {hideButton}
    </Box>,
  ]

  // Dòng 2: cần chú ý; không có thì subagent đang chạy; không có nữa thì mục tiêu (mờ), trừ khi dòng 1 đã ghi mục tiêu.
  if (hasSecondRow) {
    const first = rows.find(row => row.kind === 'agent' && row.state === 'running')
    if (alertNode) lines.push(alertNode)
    else if (first !== undefined)
      lines.push(
        <Text dimColor wrap="truncate-end">
          {`${l.agentsRunning(runningBatches)}: ${taskLabel(l, first)}`}
        </Text>,
      )
    else if (!isGoalFocus)
      lines.push(
        <Text dimColor wrap="truncate-end">
          {brief.goal}
        </Text>,
      )
  }

  return (
    <Box flexDirection="row">
      <Box flexDirection="column" flexShrink={0} marginRight={1}>
        {lines.map(() => (
          <Text color={spine}>{SPINE}</Text>
        ))}
      </Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        {lines}
      </Box>
    </Box>
  )
}
