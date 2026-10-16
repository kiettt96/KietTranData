// Pane chi tiết, xếp theo thứ tự cần nhìn: mục tiêu và chế độ, hạn mức, cảnh báo, checklist, việc giao subagent,
// điều phối, chi phí, nhật ký; ràng buộc và tiêu chí chất lượng (nội dung tĩnh) ở cuối.
// Hàm vẽ thuần như band: handler do hook tạo và truyền vào.

import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import type { Mode } from '../../types'
import { estimateLine, formatUsd, ledgerLines, sessionUsd } from '../lib/ledger'
import type { View } from '../lib/state'
import { progress } from '../lib/text'
import type { QuotaPaneText } from '../lib/text'
import { labels } from './labels'
import type { Run } from './style'
import {
  FAMILY_HUE,
  SPINE,
  STEP_MARK,
  STEP_ORDER,
  TASK_COLOR,
  TASK_MARK,
  barRuns,
  cellsOf,
  columnsOf,
  goalUsd,
  padEnd,
  padStart,
  phaseOf,
  plannedRuns,
  severityGlyph,
  severityOf,
  wrapText,
} from './style'

export const PANE = 'focus-conductor'
export const PANE_TITLE = 'Focus Conductor'

const MODES: readonly Mode[] = ['auto', 'subagents', 'suggest', 'off']
const BAR = 8

export type PaneHandlers = {
  onMode: (mode: Mode) => unknown
  onReset: () => unknown
  onToggleBand: () => unknown
}

export type PaneProps = {
  /** Số ô thân pane (bên trong khung). */
  columns: number
  /** dock: cạnh transcript; inline: phía trên prompt. */
  placement: 'dock' | 'inline'
  /** Nút Đặt lại đang chờ bấm lần hai (trong 10 giây kể từ lần đầu). */
  isResetArmed: boolean
}

export function renderPane(
  t: Elements[RenderSurface],
  view: View,
  props: PaneProps,
  handlers: PaneHandlers,
  /** Mục Hạn mức (0.6.1): null khi quotaGuard tắt, mục không được vẽ. */
  quota: QuotaPaneText | null = null,
): RenderElement {
  const { Box, Text, Button } = t
  const { brief, plan, route, log, warnings, ledger } = view.core
  const l = labels(view.lang)
  // Dòng chữ dài hơn ~100 ô khó đọc: pane inline rộng vẫn giữ nội dung trong 100 ô.
  const width = Math.max(36, Math.min(columnsOf(props.columns, 56), 100))
  const isNarrow = width < 48

  const heading = (title: string, extra?: string) => {
    const lead = cellsOf(title) + (extra ? 1 + cellsOf(extra) : 0) + 1
    return (
      <Text wrap="truncate-end">
        <Text bold>{title}</Text>
        {extra ? <Text dimColor>{` ${extra}`}</Text> : ''}
        <Text color="subtle">{` ${'─'.repeat(Math.max(2, width - lead))}`}</Text>
      </Text>
    )
  }

  const bullets = (items: readonly string[], empty: string) =>
    items.length === 0 ? (
      <Text dimColor>{empty}</Text>
    ) : (
      <Box flexDirection="column">
        {items.map(item => (
          <Box flexDirection="row" gap={1}>
            <Box flexShrink={0}>
              <Text dimColor>•</Text>
            </Box>
            <Box flexGrow={1} flexShrink={1}>
              <Text wrap="wrap">{item}</Text>
            </Box>
          </Box>
        ))}
      </Box>
    )

  // Chọn chế độ: ô đặc cho chế độ đang dùng, chữ mờ cho các chế độ còn lại.
  const modeRow = (
    <Box flexDirection="row" flexWrap="wrap">
      <Box marginRight={1}>
        <Text dimColor>{l.modeLabel}</Text>
      </Box>
      {MODES.map(m =>
        m === view.mode ? (
          <Button key={`mode-${m}`} plain label={m} onPress={() => handlers.onMode(m)}>
            <Text backgroundColor="claude" color="inverseText" bold>
              {` ${m} `}
            </Text>
          </Button>
        ) : (
          <Button key={`mode-${m}`} plain dimColor label={` ${m} `} onPress={() => handlers.onMode(m)} />
        ),
      )}
    </Box>
  )

  // Hạn mức (0.6.1): từng cửa sổ, trạng thái, điểm dừng chưa dùng xong và lệnh chạy tiếp. Đang dừng thì tô màu cảnh báo.
  const quotaNode = quota ? (
    <Box flexDirection="column">
      {heading(l.quota)}
      {quota.windows.map(line => (
        <Text dimColor wrap="wrap">
          {line}
        </Text>
      ))}
      <Text color={quota.isPaused ? 'warning' : undefined} bold={quota.isPaused} wrap="wrap">
        {quota.state}
      </Text>
      {quota.checkpoint.map(line => (
        <Text wrap="wrap">{line}</Text>
      ))}
    </Box>
  ) : null

  if (brief === null) {
    return (
      <Box flexDirection="column" gap={1} width={width}>
        {modeRow}
        {quotaNode}
        <Text dimColor wrap="wrap">
          {l.noGoal}
        </Text>
      </Box>
    )
  }

  const { closed, total } = progress(plan)
  const recentWarnings = warnings.filter(w => w.at >= brief.at).slice(-5).reverse()
  const latest = recentWarnings[0]
  const spine = latest ? severityOf(latest.kind) : 'claude'

  // ------------------------------------------------------------- mục tiêu
  const planned = total === 0 ? brief.steps.length : 0
  const phase = phaseOf(plan)
  const phaseWord = l.phase[phase]
  // Dòng tiến độ: thanh, số bước đã đóng, tên giai đoạn. Thanh lấy phần chiều rộng còn lại, từ 8 đến 24 ô.
  const bar = barRuns(plan, Math.max(8, Math.min(24, width - 2 - 5 - 2 - cellsOf(phaseWord))))
  const beads = plannedRuns(planned, Math.min(24, width - 12))
  const tint = (r: Run) => (
    <Text color={r.color} dimColor={r.dim} bold={r.bold}>
      {r.text}
    </Text>
  )
  const goalLines = wrapText(brief.goal, width - 2, 5)
  const header = (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Box flexDirection="column" flexShrink={0} marginRight={1}>
          {goalLines.map(() => (
            <Text color={spine}>{SPINE}</Text>
          ))}
        </Box>
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          {goalLines.map(line => (
            <Text bold>{line}</Text>
          ))}
        </Box>
      </Box>
      <Box flexDirection="column" paddingLeft={2}>
        {bar.length > 0 ? (
          <Box key="progress" flexDirection="row" gap={1}>
            <Box flexShrink={0}>
              <Text>{bar.map(tint)}</Text>
            </Box>
            <Box flexShrink={0}>
              <Text bold>{`${closed}/${total}`}</Text>
            </Box>
            <Text dimColor wrap="truncate-end">
              {phaseWord}
            </Text>
          </Box>
        ) : beads.length > 0 ? (
          <Box key="progress" flexDirection="row" gap={1}>
            <Box flexShrink={0}>
              <Text>{beads.map(tint)}</Text>
            </Box>
            <Text dimColor wrap="truncate-end">
              {l.plannedSteps(planned)}
            </Text>
          </Box>
        ) : null}
        <Text wrap="wrap">
          <Text dimColor>{`${l.depth} `}</Text>
          {brief.depth}
          <Text dimColor>{`   ${l.volume} `}</Text>
          {brief.volume}
          <Text dimColor>{`   ${l.kind} `}</Text>
          {brief.kind}
        </Text>
        {brief.why ? (
          <Text dimColor wrap="wrap">
            {brief.why}
          </Text>
        ) : null}
        {brief.source === 'router' ? null : (
          <Text color="warning" wrap="wrap">
            {l.notRead}
          </Text>
        )}
      </Box>
    </Box>
  )

  // ------------------------------------------------------------ cảnh báo
  const kindWidth = Math.max(0, ...recentWarnings.map(w => cellsOf(l.warningKind[w.kind])))
  const alerts =
    recentWarnings.length === 0 ? (
      quota?.isPaused ? (
        // Đang dừng thì không báo "Không có cảnh báo.": nêu lý do dừng.
        <Text color="warning" wrap="wrap">
          {`${l.quotaPausedNow}: ${quota.cause}`}
        </Text>
      ) : (
        <Text wrap="wrap">
          <Text color="success">✓</Text>
          <Text dimColor>{` ${l.noWarnings}`}</Text>
        </Text>
      )
    ) : (
      <Box flexDirection="column">
        {heading(l.warnings, String(recentWarnings.length))}
        {recentWarnings.map(w => {
          const severity = severityOf(w.kind)
          const chip = (
            <Box flexShrink={0}>
              <Text backgroundColor={severity} color="inverseText" bold>
                {` ${padEnd(l.warningKind[w.kind], isNarrow ? 0 : kindWidth)} `}
              </Text>
            </Box>
          )
          const message = (
            <Box flexGrow={1} flexShrink={1}>
              <Text wrap="wrap">{`${severityGlyph(severity)} ${w.text}`}</Text>
            </Box>
          )
          // Pane hẹp: chip nằm trên dòng riêng để lời cảnh báo có đủ chiều rộng.
          return isNarrow ? (
            <Box flexDirection="column" alignItems="flex-start">
              {chip}
              {message}
            </Box>
          ) : (
            <Box flexDirection="row" gap={1}>
              {chip}
              {message}
            </Box>
          )
        })}
      </Box>
    )

  // ----------------------------------------------------------- checklist
  const idWidth = Math.max(1, ...plan.map(step => String(step.id).length), String(brief.steps.length).length)
  const checklist =
    plan.length > 0 ? (
      <Box flexDirection="column">
        {plan.map(step => {
          const mark = STEP_MARK[step.status]
          const isFaded = step.status === 'verified' || step.status === 'skipped'
          const isBlocked = step.status === 'blocked'
          return (
            <Box flexDirection="row" gap={1}>
              <Box flexShrink={0} flexDirection="row" gap={1}>
                <Text color={mark.color} dimColor={mark.dim} bold={mark.bold}>
                  {mark.glyph}
                </Text>
                <Text dimColor>{padStart(String(step.id), idWidth)}</Text>
              </Box>
              <Box flexDirection="column" flexGrow={1} flexShrink={1}>
                <Text wrap="wrap" bold={step.status === 'doing'} dimColor={isFaded}>
                  {step.title}
                </Text>
                {step.check ? (
                  <Text dimColor wrap="wrap">
                    {`${l.check}: ${step.check}`}
                  </Text>
                ) : null}
                {step.note ? (
                  <Text color={isBlocked ? 'warning' : undefined} dimColor={!isBlocked} wrap="wrap">
                    {step.note}
                  </Text>
                ) : null}
              </Box>
            </Box>
          )
        })}
        <Box marginTop={1} flexDirection="row" flexWrap="wrap" columnGap={2}>
          {STEP_ORDER.map(status => (
            <Text>
              <Text color={STEP_MARK[status].color} dimColor={STEP_MARK[status].dim}>
                {STEP_MARK[status].glyph}
              </Text>
              <Text dimColor>{` ${l.legend[status]}`}</Text>
            </Text>
          ))}
        </Box>
      </Box>
    ) : brief.steps.length > 0 ? (
      <Box flexDirection="column">
        {brief.steps.map((step, i) => (
          <Box flexDirection="row" gap={1}>
            <Box flexShrink={0} flexDirection="row" gap={1}>
              <Text color="inactive">○</Text>
              <Text dimColor>{padStart(String(i + 1), idWidth)}</Text>
            </Box>
            <Box flexGrow={1} flexShrink={1}>
              <Text wrap="wrap">{step}</Text>
            </Box>
          </Box>
        ))}
      </Box>
    ) : (
      <Text dimColor>{l.noChecklist}</Text>
    )

  // --------------------------------------------------- việc giao subagent
  const delegations = view.core.delegations.goalId === brief.goalId ? view.core.delegations.items : []
  const delegationIdWidth = Math.max(1, ...delegations.map(item => String(item.index).length))

  // ----------------------------------------------------------- điều phối
  const routeNode = route ? (
    <Box flexDirection="column">
      <Text wrap="wrap">
        <Text backgroundColor={FAMILY_HUE[route.family]} color="inverseText" bold>
          {` ${route.family} `}
        </Text>
        <Text>{` ${route.effort}`}</Text>
        <Text dimColor>{l.forWork(brief.depth, brief.volume)}</Text>
      </Text>
      {route.reason ? (
        <Text dimColor wrap="wrap">
          {route.reason}
        </Text>
      ) : null}
    </Box>
  ) : (
    <Text dimColor wrap="wrap">
      {l.notApplied}
    </Text>
  )

  // ------------------------------------------------------------ chi phí
  const groups = [
    { label: l.groupMain, key: 'main' },
    { label: l.groupAgent, key: 'agent' },
    { label: l.groupRouter, key: 'analyzer' },
  ] as const
  const hasBars = width >= 50
  const labelWidth = Math.max(...groups.map(g => cellsOf(g.label)), cellsOf(l.total))
  const moneyWidth = Math.max(cellsOf(l.costGoal), cellsOf(l.costSession), 7)
  const callWidth = Math.max(cellsOf(l.costCalls), 3)
  const maxGoal = Math.max(...groups.map(g => ledger.goal.buckets[g.key].usd))
  const barOf = (usd: number) => {
    const filled = maxGoal > 0 && usd > 0 ? Math.max(1, Math.round((usd / maxGoal) * BAR)) : 0
    return (
      <Text>
        <Text color="claude">{'━'.repeat(filled)}</Text>
        <Text color="subtle">{'╌'.repeat(BAR - filled)}</Text>
      </Text>
    )
  }
  const costHead = `${padEnd('', labelWidth)}${hasBars ? ' '.repeat(BAR + 1) : ''} ${padStart(l.costGoal, moneyWidth)} ${padStart(l.costSession, moneyWidth)} ${padStart(l.costCalls, callWidth)}`
  const totalCalls = groups.reduce((sum, g) => sum + ledger.session[g.key].calls, 0)
  const extraLines = [...ledgerLines(ledger).slice(2), ...(estimateLine(log) ? [estimateLine(log) as string] : [])]
  const cost = (
    <Box flexDirection="column">
      <Text dimColor wrap="truncate-end">
        {costHead}
      </Text>
      {groups.map(g => (
        <Text wrap="truncate-end">
          {padEnd(g.label, labelWidth)}
          {hasBars ? <Text> </Text> : ''}
          {hasBars ? barOf(ledger.goal.buckets[g.key].usd) : ''}
          {` ${padStart(formatUsd(ledger.goal.buckets[g.key].usd), moneyWidth)}`}
          <Text dimColor>{` ${padStart(formatUsd(ledger.session[g.key].usd), moneyWidth)} ${padStart(String(ledger.session[g.key].calls), callWidth)}`}</Text>
        </Text>
      ))}
      <Text bold wrap="truncate-end">
        {`${padEnd(l.total, labelWidth)}${hasBars ? ' '.repeat(BAR + 1) : ''} ${padStart(formatUsd(goalUsd(ledger)), moneyWidth)} ${padStart(formatUsd(sessionUsd(ledger)), moneyWidth)} ${padStart(String(totalCalls), callWidth)}`}
      </Text>
      {ledger.goal.spawned > 0 ? (
        <Text dimColor wrap="wrap">
          {l.spawned(ledger.goal.spawned)}
        </Text>
      ) : null}
      {extraLines.map(line => (
        <Text dimColor wrap="wrap">
          {line}
        </Text>
      ))}
    </Box>
  )

  // ------------------------------------------------------------- nhật ký
  const recentLog = log.slice(-8).reverse()
  const hasEstimate = recentLog.some(entry => entry.usd !== undefined && !entry.measured)
  const logNode =
    recentLog.length === 0 ? (
      <Text dimColor>{l.noLog}</Text>
    ) : (
      <Box flexDirection="column">
        {recentLog.map(entry => {
          const hue = FAMILY_HUE[entry.family]
          const where = entry.where === 'main' ? l.main : (entry.agentType ?? 'agent')
          return (
            <Box flexDirection="column">
              <Box flexDirection="row" gap={1}>
                <Box flexShrink={0}>
                  <Text color={hue} dimColor={!entry.isApplied}>
                    {entry.isApplied ? '●' : '○'}
                  </Text>
                </Box>
                <Box flexGrow={1} flexShrink={1}>
                  <Text wrap="truncate-end" dimColor={!entry.isApplied}>
                    <Text bold>{entry.label}</Text>
                    <Text dimColor>{` ${where}`}</Text>
                  </Text>
                </Box>
                <Box flexShrink={0}>
                  <Text color={hue} dimColor={!entry.isApplied}>
                    {`${entry.family}${entry.effort ? ` ${entry.effort}` : ''}`}
                  </Text>
                </Box>
                {entry.usd !== undefined ? (
                  <Box flexShrink={0}>
                    <Text dimColor>{`${entry.measured ? '' : '~'}${formatUsd(entry.usd)}`}</Text>
                  </Box>
                ) : null}
              </Box>
              <Box paddingLeft={2}>
                <Text dimColor wrap="wrap">
                  {`${entry.reason}${entry.isApplied ? '' : l.skipped}`}
                </Text>
              </Box>
            </Box>
          )
        })}
        {hasEstimate ? (
          <Text dimColor wrap="wrap">
            {l.estimatedNote}
          </Text>
        ) : null}
      </Box>
    )

  return (
    <Box flexDirection="column" gap={1} width={width}>
      {header}
      {modeRow}
      {quotaNode}
      {alerts}
      <Box flexDirection="column">
        {heading(plan.length > 0 ? 'Checklist' : l.planned, plan.length > 0 ? `${closed}/${total}` : undefined)}
        {checklist}
      </Box>
      {delegations.length > 0 ? (
        <Box flexDirection="column">
          {heading(l.delegations, String(delegations.length))}
          {delegations.map(item => {
            const mark = TASK_MARK[item.state]
            const state = l.delegationState[item.state]
            // Trạng thái nằm cùng dòng với tên việc nếu còn chỗ, không thì xuống dòng riêng để không bị cắt giữa cụm.
            const isInline = cellsOf(item.title) + 2 + cellsOf(state) <= width - 3 - delegationIdWidth
            const stateNode = (
              <Text color={TASK_COLOR[item.state]} dimColor={TASK_COLOR[item.state] === undefined} wrap="wrap">
                {isInline ? `  ${state}` : state}
              </Text>
            )
            return (
              <Box flexDirection="row" gap={1}>
                <Box flexShrink={0} flexDirection="row" gap={1}>
                  <Text color={mark.color} dimColor={mark.dim} bold={mark.bold}>
                    {mark.glyph}
                  </Text>
                  <Text dimColor>{padStart(String(item.index), delegationIdWidth)}</Text>
                </Box>
                <Box flexDirection="column" flexGrow={1} flexShrink={1}>
                  {isInline ? (
                    <Text wrap="wrap" dimColor={item.state === 'done'}>
                      {item.title}
                      {stateNode}
                    </Text>
                  ) : (
                    <Box flexDirection="column">
                      <Text wrap="wrap" dimColor={item.state === 'done'}>
                        {item.title}
                      </Text>
                      {stateNode}
                    </Box>
                  )}
                </Box>
              </Box>
            )
          })}
        </Box>
      ) : null}
      <Box flexDirection="column">
        {heading(l.mainRouting)}
        {routeNode}
      </Box>
      <Box flexDirection="column">
        {heading(l.cost)}
        {cost}
      </Box>
      <Box flexDirection="column">
        {heading(l.log, String(recentLog.length))}
        {logNode}
      </Box>
      <Box flexDirection="column">
        {heading(l.constraints)}
        {bullets(brief.constraints, l.noConstraints)}
      </Box>
      <Box flexDirection="column">
        {heading(l.quality)}
        {bullets(brief.quality, l.noQuality)}
      </Box>
      <Box flexDirection="row" justifyContent="space-between">
        <Button key="band" label={view.isBandHidden ? l.showBand : l.hideBand} onPress={handlers.onToggleBand} />
        <Button key="reset" label={props.isResetArmed ? l.resetConfirm : l.reset} onPress={handlers.onReset} />
      </Box>
      <Text dimColor wrap="wrap">
        {l.resetScope}
      </Text>
    </Box>
  )
}
