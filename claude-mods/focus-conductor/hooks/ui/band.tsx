// Band phía trên prompt: hai dòng, mỗi dòng trả lời một câu hỏi.
//   Dòng 1: đang làm gì, bằng model nào, đã tốn bao nhiêu.
//   Dòng 2: đã đi được bao xa (thanh đổi màu theo giai đoạn), bước nào đang là tâm điểm.
// Có cảnh báo thì thêm dòng 3. Gờ bên trái đổi màu theo tình trạng: cam là bình thường, vàng là cần chú ý, đỏ là vi phạm.
// Hàm vẽ thuần: nhận bảng phần tử của surface, dữ liệu và các handler mà hook đã tạo; không tự gọi $.

import type { Color, Elements, RenderElement, RenderSurface } from 'claude-code'

import { formatUsd } from '../lib/ledger'
import { shownPlan } from '../lib/mirror'
import type { QuotaBadge } from '../lib/quota'
import type { View } from '../lib/state'
import { progress, quotaPercent } from '../lib/text'
import { labels } from './labels'
import type { Run } from './style'
import {
  FAMILY_HUE,
  SPINE,
  barRuns,
  cellsOf,
  columnsOf,
  currentStep,
  goalUsd,
  pendingUsd,
  phaseOf,
  plannedRuns,
  severityGlyph,
  severityOf,
} from './style'

/** Ô một nút của engine chiếm [Giả định: khoảng 10 ô cho nhãn ngắn, chưa đo trên surface thật]. */
export const BUTTON_CELLS = 10
const buttonCells = (label: string) => Math.max(BUTTON_CELLS, cellsOf(label) + 2)
const runCells = (runs: readonly Run[]) => runs.reduce((sum, r) => sum + cellsOf(r.text), 0)

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
}

/** Trả cây để vẽ, hoặc null khi band nên nhường chỗ cho engine. */
export function renderBand(
  t: Elements[RenderSurface],
  view: View,
  props: BandProps,
  handlers: BandHandlers,
  /** Bảo vệ hạn mức (0.6.0): nhãn đang dừng hay phần còn lại khi gần ngưỡng; null hay vắng thì band như cũ. */
  quota: QuotaBadge | null = null,
): RenderElement | null {
  const { brief, route, warnings, ledger, log } = view.core
  // Checklist để vẽ: của tool plan, nếu chưa có thì danh sách việc Claude Code tự ghi (phản chiếu, 0.6.1).
  const { plan, source } = shownPlan(view.core)
  if (view.mode === 'off' || brief === null || view.isBandHidden) return null
  const { Box, Text, Button } = t

  const l = labels(view.lang)
  const columns = columnsOf(props.columns, 100)
  const isWide = columns >= 96
  const hasRoom = columns >= 72
  const hasTitle = columns >= 56

  const recent = warnings.filter(w => w.at >= brief.at)
  const latest = recent.at(-1)
  const others = recent.length - 1
  const severity = latest ? severityOf(latest.kind) : null
  const spine: Color = severity ?? 'claude'

  const { closed, total } = progress(plan)
  const planned = total === 0 ? brief.steps.length : 0
  const current = currentStep(plan)
  const phase = phaseOf(plan)
  // Thanh dài theo chiều rộng, tối thiểu 6 ô để còn thấy phần đã đóng.
  const bar = barRuns(plan, Math.max(6, Math.min(20, Math.floor(columns * 0.16))))
  const beads = plannedRuns(planned, Math.max(8, Math.min(24, Math.floor(columns * 0.22))))

  const tint = (r: Run) => (
    <Text color={r.color} dimColor={r.dim} bold={r.bold}>
      {r.text}
    </Text>
  )

  const pending = pendingUsd(log)
  const spent = goalUsd(ledger) + pending
  const costText = hasRoom && spent > 0 ? `${pending > 0 ? '~' : ''}${formatUsd(spent)}` : ''
  const modeText = isWide && view.mode === 'subagents' ? `${l.mode} ${view.mode}` : ''
  // Nhãn hạn mức dùng lại màu cảnh báo có sẵn: đang dừng thì đậm, gần ngưỡng thì thường. Dưới 56 cột nhãn dừng rút gọn.
  const quotaText = quota ? (quota.paused ? (hasTitle ? l.quotaPaused : l.quotaPausedShort) : l.quotaLeft(quotaPercent(quota.left ?? 0))) : ''

  // Band hẹp (0.6.1): phần không co (gờ, tiến độ, chip, nút) không được vượt chiều rộng. Thừa thì bỏ lần lượt số bước,
  // mức effort của chip model, rồi cả chip model.
  const fit = { count: true, effort: true, route: true }
  const countText = `${closed}/${total}`
  // Nguồn phản chiếu ghi nhỏ cạnh số bước khi còn chỗ: người dùng biết checklist này không chặn kết thúc.
  const mirrorText = source === 'mirror' && hasRoom ? l.mirrorShort : ''
  const progressCells = () =>
    bar.length > 0
      ? runCells(bar) + (fit.count ? 1 + cellsOf(countText) : 0) + (isWide && phase !== 'done' ? 1 + cellsOf(l.phase[phase]) : 0) + (mirrorText ? 1 + cellsOf(mirrorText) : 0)
      : beads.length > 0
        ? runCells(beads) + 1 + cellsOf(l.plannedSteps(planned))
        : 0
  const routeCells = () =>
    route && fit.route
      ? view.mode === 'suggest'
        ? cellsOf(l.suggest) + 1 + cellsOf(route.family) + (fit.effort ? 1 + cellsOf(route.effort) : 0)
        : cellsOf(route.family) + 2 + (fit.effort ? 1 + cellsOf(route.effort) : 0)
      : 0
  const chipCells = () => {
    const parts = [cellsOf(quotaText), routeCells(), costText ? cellsOf(costText) : 0].filter(n => n > 0)
    return parts.reduce((a, b) => a + b, 0) + Math.max(0, parts.length - 1)
  }
  // Một dòng: tiến độ, mục tiêu, chip, nút Chi tiết (và nút Ẩn khi có hai dòng) cách nhau một ô.
  const compactCells = () => {
    const parts = [progressCells(), 0, chipCells(), buttonCells(l.details), props.maxRows >= 2 && hasRoom ? buttonCells(l.hide) : 0]
    const shown = parts.filter((n, i) => i === 1 || n > 0)
    return 2 + shown.reduce((a, b) => a + b, 0) + (shown.length - 1)
  }
  // Hai dòng: dòng 1 mục tiêu và chip (gap 2); dòng 2 tiến độ, tâm điểm (lề 1), nhãn chế độ, các nút.
  const rowCells = () => {
    const first = 2 + (chipCells() > 0 ? 2 + chipCells() : 0)
    const tail = [progressCells(), 1, modeText ? cellsOf(modeText) : 0, buttonCells(l.details), hasRoom ? buttonCells(l.hide) : 0]
    const shown = tail.filter((n, i) => i === 1 || n > 0)
    return Math.max(first, 2 + shown.reduce((a, b) => a + b, 0) + (shown.length - 1))
  }
  const isCompact = props.maxRows < 2 || (bar.length === 0 && beads.length === 0 && !current)
  const fixedCells = () => (isCompact ? compactCells() : rowCells())
  for (const drop of [() => (fit.count = false), () => (fit.effort = false), () => (fit.route = false)]) {
    if (fixedCells() <= columns) break
    drop()
  }

  // Chip model: nền đặc khi mod đang áp dụng, chỉ tô chữ khi mới đề xuất.
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
  const costNode = costText ? <Text dimColor>{costText}</Text> : null
  const quotaNode = quota ? (
    <Text color="warning" bold={quota.paused}>
      {quotaText}
    </Text>
  ) : null
  const chips =
    routeNode || costNode || quotaNode ? (
      <Box flexShrink={0} flexDirection="row" gap={1}>
        {quotaNode}
        {routeNode}
        {costNode}
      </Box>
    ) : null

  const modeTag = modeText ? (
    <Box flexShrink={0}>
      <Text dimColor>{modeText}</Text>
    </Box>
  ) : null
  const detailsButton = <Button key="details" label={l.details} onPress={handlers.onDetails} />
  const hideButton = hasRoom ? <Button key="hide" plain dimColor label={l.hide} onPress={handlers.onHide} /> : null

  const alert = latest && severity ? (
    <Box flexDirection="row" gap={1}>
      <Box flexShrink={0}>
        <Text color={severity} bold>
          {severityGlyph(severity)}
        </Text>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text color={severity} wrap="truncate-end">
          {latest.text}
        </Text>
      </Box>
      {others > 0 ? (
        <Box flexShrink={0}>
          <Text dimColor>{`+${others}`}</Text>
        </Box>
      ) : null}
    </Box>
  ) : null

  const goalText = (
    <Box flexGrow={1} flexShrink={1}>
      <Text bold wrap="truncate-end">
        {brief.goal}
      </Text>
    </Box>
  )
  // Có checklist: thanh tô màu theo giai đoạn, số bước đã đóng, và (khi rộng) tên giai đoạn. Chưa có: các ô ○ router dự kiến.
  // Xong hết thì khoảng trống bên cạnh đã ghi "Đã xong mọi bước", nên không lặp tên giai đoạn.
  const progressNode =
    bar.length > 0 ? (
      <Box key="progress" flexShrink={0} flexDirection="row" gap={1}>
        <Text>{bar.map(tint)}</Text>
        {fit.count ? <Text bold>{countText}</Text> : null}
        {isWide && phase !== 'done' ? <Text dimColor>{l.phase[phase]}</Text> : null}
        {mirrorText ? <Text dimColor>{mirrorText}</Text> : null}
      </Box>
    ) : beads.length > 0 ? (
      <Box key="progress" flexShrink={0} flexDirection="row" gap={1}>
        <Text>{beads.map(tint)}</Text>
        <Text dimColor>{l.plannedSteps(planned)}</Text>
      </Box>
    ) : null

  const rows: RenderElement[] = []
  if (isCompact) {
    // Một dòng: tiến độ (nếu có), mục tiêu, model, nút. Cảnh báo (nếu có) xuống dòng dưới khi còn chỗ.
    rows.push(
      <Box flexDirection="row" gap={1}>
        {progressNode}
        {goalText}
        {chips}
        {detailsButton}
        {props.maxRows >= 2 ? hideButton : null}
      </Box>,
    )
    if (alert && props.maxRows >= 2) rows.push(alert)
  } else {
    const hasThirdRow = alert !== null && props.maxRows >= 3
    // Thiếu chỗ cho dòng 3 thì cảnh báo thế chỗ tên bước, vì cảnh báo quan trọng hơn.
    const focus =
      alert && !hasThirdRow ? (
        alert
      ) : hasTitle && current ? (
        <Text wrap="truncate-end" bold={props.isWorking}>
          {current.title}
        </Text>
      ) : hasTitle && total > 0 && closed === total ? (
        <Text dimColor wrap="truncate-end">
          {l.allClosed}
        </Text>
      ) : null
    rows.push(
      <Box flexDirection="row" gap={2}>
        {goalText}
        {chips}
      </Box>,
      <Box flexDirection="row" gap={1}>
        {progressNode}
        <Box flexGrow={1} flexShrink={1} marginLeft={1}>
          {focus}
        </Box>
        {modeTag}
        {detailsButton}
        {hideButton}
      </Box>,
    )
    if (hasThirdRow && alert) rows.push(alert)
  }

  return (
    <Box flexDirection="row">
      <Box flexDirection="column" flexShrink={0} marginRight={1}>
        {rows.map(() => (
          <Text color={spine}>{SPINE}</Text>
        ))}
      </Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        {rows}
      </Box>
    </Box>
  )
}
