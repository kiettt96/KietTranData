// Pane chi tiết: mục tiêu, ràng buộc, tiêu chí chất lượng, checklist, quyết
// định điều phối hiện tại, nhật ký điều phối và cảnh báo nhất quán.
// Hàm vẽ thuần như band: handler do hook tạo và truyền vào.

import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import type { Mode } from '../../types'
import { formatUsd, ledgerLines } from '../lib/ledger'
import { describePick } from '../lib/route'
import type { View } from '../lib/state'
import { mark, progress } from '../lib/text'

export const PANE = 'focus-conductor'
export const PANE_TITLE = 'Focus Conductor'

const MODES: readonly Mode[] = ['auto', 'subagents', 'suggest', 'off']

export type PaneHandlers = {
  onMode: (mode: Mode) => unknown
  onReset: () => unknown
  onToggleBand: () => unknown
}

export function renderPane(t: Elements[RenderSurface], view: View, handlers: PaneHandlers): RenderElement {
  const { Box, Text, Button } = t
  const { brief, plan, route, log, warnings } = view.core

  const section = (title: string) => (
    <Text bold color="claude">
      {title}
    </Text>
  )
  const list = (items: readonly string[], empty: string) =>
    items.length === 0 ? (
      <Text dimColor>{empty}</Text>
    ) : (
      <Box flexDirection="column">
        {items.map(item => (
          <Text wrap="wrap">- {item}</Text>
        ))}
      </Box>
    )

  const modeRow = (
    <Box flexDirection="row" gap={1} flexWrap="wrap">
      <Text dimColor>Chế độ</Text>
      {MODES.map(m => (
        <Button
          key={`mode-${m}`}
          label={m}
          variant={m === view.mode ? 'primary' : 'secondary'}
          onPress={() => handlers.onMode(m)}
        />
      ))}
    </Box>
  )

  if (brief === null) {
    return (
      <Box flexDirection="column" gap={1}>
        {modeRow}
        <Text dimColor>Chưa có mục tiêu. Gửi một prompt, hoặc dùng /conductor goal kèm mô tả mục tiêu.</Text>
      </Box>
    )
  }

  const { closed, total } = progress(plan)
  const checklist =
    plan.length > 0 ? (
      <Box flexDirection="column">
        {plan.map(step => (
          <Text wrap="wrap" dimColor={step.status === 'verified' || step.status === 'skipped'}>
            {mark(step.status)} {step.id}. {step.title}
            {step.note ? <Text dimColor> ({step.note})</Text> : ''}
          </Text>
        ))}
      </Box>
    ) : (
      list(brief.steps, 'Claude chưa chốt checklist.')
    )

  const recentLog = log.slice(-8).reverse()
  const recentWarnings = warnings.filter(w => w.at >= brief.at).slice(-5).reverse()

  return (
    <Box flexDirection="column" gap={1}>
      {modeRow}
      <Box flexDirection="column">
        {section('Mục tiêu')}
        <Text wrap="wrap">{brief.goal}</Text>
        <Text dimColor wrap="wrap">
          {brief.depth} · khối lượng {brief.volume} · {brief.kind} (điểm {brief.score}; {brief.signals.slice(0, 5).join(', ')}; nguồn {brief.source})
        </Text>
      </Box>
      <Box flexDirection="column">
        {section('Ràng buộc')}
        {list(brief.constraints, 'Không nhận ra ràng buộc rõ ràng.')}
      </Box>
      <Box flexDirection="column">
        {section('Tiêu chí chất lượng')}
        {list(brief.quality, 'Không nhận ra tiêu chí riêng.')}
      </Box>
      <Box flexDirection="column">
        {section(plan.length > 0 ? `Checklist ${closed}/${total}` : 'Bước dự kiến (từ phân tích)')}
        {checklist}
      </Box>
      <Box flexDirection="column">
        {section('Điều phối luồng chính')}
        {route ? (
          <Text wrap="wrap">
            {describePick(route)} cho việc {brief.depth}, khối lượng {brief.volume}
            <Text dimColor> ({route.reason})</Text>
          </Text>
        ) : (
          <Text dimColor>Chưa áp dụng; luồng chính đang dùng model của phiên.</Text>
        )}
      </Box>
      <Box flexDirection="column">
        {section('Chi phí ước tính')}
        {ledgerLines(view.core.ledger).map(line => (
          <Text wrap="wrap" dimColor>
            {line}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column">
        {section('Nhật ký điều phối')}
        {recentLog.length === 0 ? (
          <Text dimColor>Chưa có quyết định nào.</Text>
        ) : (
          recentLog.map(entry => (
            <Text wrap="truncate-end" dimColor={!entry.isApplied}>
              {entry.where === 'main' ? 'chính' : (entry.agentType ?? 'agent')} · {entry.family}
              {entry.effort ? `/${entry.effort}` : ''} · {entry.label}: {entry.reason}
              {entry.usd !== undefined ? ` · ${formatUsd(entry.usd)}${entry.measured ? '' : ' (ước tính)'}` : ''}
              {entry.isApplied ? '' : ' (không áp dụng)'}
            </Text>
          ))
        )}
      </Box>
      <Box flexDirection="column">
        {section('Cảnh báo nhất quán')}
        {recentWarnings.length === 0 ? (
          <Text dimColor>Không có cảnh báo.</Text>
        ) : (
          recentWarnings.map(w => (
            <Text wrap="wrap" color={w.kind === 'loop' || w.kind === 'scope' ? 'error' : 'warning'}>
              {w.text}
            </Text>
          ))
        )}
      </Box>
      <Box flexDirection="row" gap={1}>
        <Button key="reset" label="Đặt lại mục tiêu" onPress={handlers.onReset} />
        <Button key="band" label={view.isBandHidden ? 'Hiện band' : 'Ẩn band'} onPress={handlers.onToggleBand} />
      </Box>
    </Box>
  )
}
