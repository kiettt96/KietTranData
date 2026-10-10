// Pane chi tiết: mục tiêu, ràng buộc, tiêu chí chất lượng, checklist, quyết
// định điều phối hiện tại, nhật ký điều phối và cảnh báo nhất quán.
// Hàm vẽ thuần như band: handler do hook tạo và truyền vào.

import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import type { Mode } from '../../types'
import { estimateLine, formatUsd, ledgerLines } from '../lib/ledger'
import { describePick } from '../lib/route'
import type { View } from '../lib/state'
import { mark, progress } from '../lib/text'
import { labels } from './labels'

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
  const l = labels(view.lang)

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
      <Text dimColor>{l.modeLabel}</Text>
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
        <Text dimColor>{l.noGoal}</Text>
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
            {step.check ? <Text dimColor> [{step.check}]</Text> : ''}
            {step.note ? <Text dimColor> ({step.note})</Text> : ''}
          </Text>
        ))}
      </Box>
    ) : (
      list(brief.steps, l.noChecklist)
    )

  const delegations = view.core.delegations.goalId === brief.goalId ? view.core.delegations.items : []
  const estimate = estimateLine(log)
  const recentLog = log.slice(-8).reverse()
  const recentWarnings = warnings.filter(w => w.at >= brief.at).slice(-5).reverse()

  return (
    <Box flexDirection="column" gap={1}>
      {modeRow}
      <Box flexDirection="column">
        {section(l.goal)}
        <Text wrap="wrap">{brief.goal}</Text>
        <Text dimColor wrap="wrap">
          {brief.depth} · {l.volume} {brief.volume} · {brief.kind}{brief.why ? ` (${brief.why})` : ''}{brief.source === 'router' ? '' : ` · ${l.notRead}`}
        </Text>
      </Box>
      <Box flexDirection="column">
        {section(l.constraints)}
        {list(brief.constraints, l.noConstraints)}
      </Box>
      <Box flexDirection="column">
        {section(l.quality)}
        {list(brief.quality, l.noQuality)}
      </Box>
      <Box flexDirection="column">
        {section(plan.length > 0 ? `Checklist ${closed}/${total}` : l.planned)}
        {checklist}
      </Box>
      {delegations.length > 0 ? (
        <Box flexDirection="column">
          {section(l.delegations)}
          {delegations.map(item => (
            <Text wrap="wrap" color={item.state === 'failed' ? 'error' : undefined} dimColor={item.state === 'done'}>
              {item.index}. {item.title}: {l.delegationState[item.state]}
            </Text>
          ))}
        </Box>
      ) : null}
      <Box flexDirection="column">
        {section(l.mainRouting)}
        {route ? (
          <Text wrap="wrap">
            {describePick(route)}{l.forWork(brief.depth, brief.volume)}
            <Text dimColor> ({route.reason})</Text>
          </Text>
        ) : (
          <Text dimColor>{l.notApplied}</Text>
        )}
      </Box>
      <Box flexDirection="column">
        {section(l.cost)}
        {[...ledgerLines(view.core.ledger), ...(estimate ? [estimate] : [])].map(line => (
          <Text wrap="wrap" dimColor>
            {line}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column">
        {section(l.log)}
        {recentLog.length === 0 ? (
          <Text dimColor>{l.noLog}</Text>
        ) : (
          recentLog.map(entry => (
            <Text wrap="truncate-end" dimColor={!entry.isApplied}>
              {entry.where === 'main' ? l.main : (entry.agentType ?? 'agent')} · {entry.family}
              {entry.effort ? `/${entry.effort}` : ''} · {entry.label}: {entry.reason}
              {entry.usd !== undefined ? ` · ${formatUsd(entry.usd)}${entry.measured ? '' : l.estimated}` : ''}
              {entry.isApplied ? '' : l.skipped}
            </Text>
          ))
        )}
      </Box>
      <Box flexDirection="column">
        {section(l.warnings)}
        {recentWarnings.length === 0 ? (
          <Text dimColor>{l.noWarnings}</Text>
        ) : (
          recentWarnings.map(w => (
            <Text wrap="wrap" color={w.kind === 'loop' || w.kind === 'scope' ? 'error' : 'warning'}>
              {w.text}
            </Text>
          ))
        )}
      </Box>
      <Box flexDirection="row" gap={1}>
        <Button key="reset" label={l.reset} onPress={handlers.onReset} />
        <Button key="band" label={view.isBandHidden ? l.showBand : l.hideBand} onPress={handlers.onToggleBand} />
      </Box>
    </Box>
  )
}
