// Band phía trên prompt: hai dòng, mỗi dòng trả lời một câu hỏi.
//   Dòng 1: đang làm gì, bằng model nào, đã tốn bao nhiêu.
//   Dòng 2: đã đi được bao xa (thanh đổi màu theo giai đoạn), bước nào đang là tâm điểm.
// Có cảnh báo thì thêm dòng 3. Gờ bên trái đổi màu theo tình trạng: cam là bình thường, vàng là cần chú ý, đỏ là vi phạm.
// Hàm vẽ thuần: nhận bảng phần tử của surface, dữ liệu và các handler mà hook đã tạo; không tự gọi $.

import type { Color, Elements, RenderElement, RenderSurface } from 'claude-code'

import { formatUsd } from '../lib/ledger'
import type { QuotaBadge } from '../lib/quota'
import type { View } from '../lib/state'
import { progress, quotaPercent } from '../lib/text'
import { labels } from './labels'
import type { Run } from './style'
import {
  FAMILY_HUE,
  SPINE,
  barRuns,
  columnsOf,
  currentStep,
  goalUsd,
  pendingUsd,
  phaseOf,
  plannedRuns,
  severityGlyph,
  severityOf,
} from './style'

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
  const { brief, plan, route, warnings, ledger, log } = view.core
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

  // Chip model: nền đặc khi mod đang áp dụng, chỉ tô chữ khi mới đề xuất.
  const routeNode = route ? (
    view.mode === 'suggest' ? (
      <Text>
        <Text dimColor>{l.suggest} </Text>
        <Text color={FAMILY_HUE[route.family]} bold>
          {route.family}
        </Text>
        <Text dimColor> {route.effort}</Text>
      </Text>
    ) : (
      <Text>
        <Text backgroundColor={FAMILY_HUE[route.family]} color="inverseText" bold>
          {` ${route.family} `}
        </Text>
        <Text dimColor> {route.effort}</Text>
      </Text>
    )
  ) : null
  const pending = pendingUsd(log)
  const spent = goalUsd(ledger) + pending
  const costNode = hasRoom && spent > 0 ? <Text dimColor>{`${pending > 0 ? '~' : ''}${formatUsd(spent)}`}</Text> : null
  // Nhãn hạn mức dùng lại màu cảnh báo có sẵn: đang dừng thì đậm, gần ngưỡng thì thường.
  const quotaNode = quota ? (
    <Text color="warning" bold={quota.paused}>
      {quota.paused ? l.quotaPaused : l.quotaLeft(quotaPercent(quota.left ?? 0))}
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

  const modeTag =
    isWide && view.mode === 'subagents' ? (
      <Box flexShrink={0}>
        <Text dimColor>{`${l.mode} ${view.mode}`}</Text>
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
        <Text bold>{`${closed}/${total}`}</Text>
        {isWide && phase !== 'done' ? <Text dimColor>{l.phase[phase]}</Text> : null}
      </Box>
    ) : beads.length > 0 ? (
      <Box key="progress" flexShrink={0} flexDirection="row" gap={1}>
        <Text>{beads.map(tint)}</Text>
        <Text dimColor>{l.plannedSteps(planned)}</Text>
      </Box>
    ) : null

  const rows: RenderElement[] = []
  const isCompact = props.maxRows < 2 || (progressNode === null && !current)
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
