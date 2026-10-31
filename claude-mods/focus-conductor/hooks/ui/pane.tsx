// Pane chi tiết, xếp theo thứ tự cần nhìn: mục tiêu và chế độ, hạn mức, cảnh báo, checklist, tiến độ từng việc,
// điều phối, chi phí, nhật ký; ràng buộc và tiêu chí chất lượng (nội dung tĩnh) ở cuối.
// Hàm vẽ thuần như band: handler do hook tạo và truyền vào.

import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import type { Mode, PlanStep } from '../../types'
import { estimateLine, formatUsd, ledgerLines, sessionUsd } from '../lib/ledger'
import type { View } from '../lib/state'
import { shownPlan } from '../lib/mirror'
import { taskRows } from '../lib/progress'
import { countLabel, progress } from '../lib/text'
import type { QuotaPaneText } from '../lib/text'
import { labels, taskLabel } from './labels'
import type { Run } from './style'
import {
  FAMILY_HUE,
  SPINE,
  STEP_MARK,
  STEP_ORDER,
  barRuns,
  cellsOf,
  columnsOf,
  goalUsd,
  padEnd,
  padStart,
  phaseOf,
  plannedRuns,
  severityGlyph,
  taskBarRuns,
  severityOf,
  wrapText,
} from './style'

export const PANE = 'focus-conductor'
export const PANE_TITLE = 'Focus Conductor'

const MODES: readonly Mode[] = ['auto', 'subagents', 'suggest', 'off']
const BAR = 8
/** Checklist dài hơn số bước này thì dồn các bước đã đóng thành một dòng (0.7.5). */
const COLLAPSE_FROM = 6
/**
 * Dạng gọn của checklist dài (R10, S6): khi dạng đầy đủ không vừa số dòng của pane, chỉ hiện bước đang làm và các bước mở kế tiếp, tổng
 * cộng số này, kèm dòng "k bước đã đóng" và "+m bước mở"; không có chú giải ký hiệu.
 */
const SHOWN_OPEN = 4
/** Số dòng thân của pane tự mở phía trên prompt (lib/pane.ts PANE_ROWS), dùng khi engine không báo số dòng. */
const DEFAULT_ROWS = 16

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
  /** Thời điểm vẽ (ms, $.clock.now()), cho thời gian chạy của subagent (0.6.1). Vắng thì 0. */
  now?: number
  /**
   * Số dòng thân pane (props.scroll.bodyRows của engine, S6). Checklist dài chỉ dùng dạng gọn khi dạng đầy đủ đẩy tiêu đề tiến độ từng
   * việc ra ngoài số dòng này. Vắng thì coi như pane tự mở 16 dòng (PANE_ROWS).
   */
  rows?: number
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
  const { brief, route, log, warnings, ledger } = view.core
  // Checklist để vẽ: của tool plan, nếu chưa có thì danh sách việc Claude Code tự ghi (phản chiếu, 0.6.1).
  const { plan, source } = shownPlan(view.core)
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
              <Text bold>{countLabel(plan)}</Text>
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

  // Gợi ý khai checkCommands (0.7.3): một dòng mờ ngay dưới cảnh báo, chỉ khi gợi ý thuộc mục tiêu đang mở.
  const hint = view.core.checkHint
  const hintNode =
    hint !== null && hint.goalId === brief.goalId && hint.commands.length > 0 ? (
      <Text dimColor wrap="wrap">
        {l.checkHint(hint.commands.join(', '), hint.commands.some(command => command.endsWith('/')))}
      </Text>
    ) : null

  // ----------------------------------------------------------- checklist
  const idWidth = Math.max(1, ...plan.map(step => String(step.id).length), String(brief.steps.length).length)
  // Checklist dài (vòng sửa 2 của 0.7.5): các bước đã đóng dồn thành một dòng tóm tắt, để pane tự mở 16 dòng còn chỗ cho tiến độ
  // từng việc; checklist ngắn giữ nguyên từng bước. Không dạng gọn mà checklist trên 6 bước thì còn tối đa 4 bước mở nên đã đóng ít
  // nhất 3 bước: dòng tóm tắt luôn tiết kiệm được dòng.
  const closedSteps = plan.filter(step => progress([step]).closed === 1)
  const openSteps = plan.filter(step => !closedSteps.includes(step))
  // S6: ước lượng số dòng (ngắt chữ như wrapText) để biết dạng đầy đủ có đẩy tiêu đề tiến độ từng việc ra ngoài số dòng của pane không.
  const rowsOf = (text: string, cells: number) => Math.max(1, wrapText(text, cells, 99).length)
  const stepCells = width - idWidth - 3
  const stepRows = (step: PlanStep) => rowsOf(step.title, stepCells) + (step.check ? rowsOf(`${l.check}: ${step.check}`, stepCells) : 0) + (step.note ? rowsOf(step.note, stepCells) : 0)
  const legendRows = () => {
    let lines = 1
    let used = 0
    for (const status of STEP_ORDER) {
      const cells = 2 + cellsOf(l.legend[status])
      if (used > 0 && used + 2 + cells > width) {
        lines += 1
        used = cells
      } else used += (used > 0 ? 2 : 0) + cells
    }
    return 1 + lines
  }
  const headerRows =
    goalLines.length +
    (bar.length > 0 || beads.length > 0 ? 1 : 0) +
    rowsOf(`${l.depth} ${brief.depth}   ${l.volume} ${brief.volume}   ${l.kind} ${brief.kind}`, width - 2) +
    (brief.why ? rowsOf(brief.why, width - 2) : 0) +
    (brief.source === 'router' ? 0 : rowsOf(l.notRead, width - 2))
  const mirrorRows = source === 'mirror' ? rowsOf(l.mirrorSource, width) : 0
  // Tiêu đề tiến độ từng việc ở dòng phần đầu + khoảng cách + tiêu đề checklist + danh sách + khoảng cách; nó và dòng việc đầu phải vừa.
  const fits = (listRows: number) => headerRows + mirrorRows + listRows + 5 <= (props.rows ?? DEFAULT_ROWS)
  // Checklist dài (vòng sửa 2 của 0.7.5): các bước đã đóng dồn thành một dòng tóm tắt; checklist ngắn giữ nguyên từng bước. Không dạng gọn
  // mà checklist trên 6 bước thì vẫn có dòng tóm tắt bước đã đóng.
  const isLong = plan.length > COLLAPSE_FROM
  const fullRows = (isLong && closedSteps.length > 0 ? 1 : 0) + (isLong ? openSteps : plan).reduce((sum, step) => sum + stepRows(step), 0) + legendRows()
  // Dạng gọn (R10, S6): checklist dài mà dạng đầy đủ không vừa thì chỉ hiện bước đang làm (không có thì bước mở đầu tiên) và các bước mở kế tiếp.
  const isCompact = isLong && !fits(fullRows)
  const start = Math.max(0, openSteps.findIndex(step => step.status === 'doing'))
  const shown = isCompact ? openSteps.slice(start, start + SHOWN_OPEN) : []
  const isCollapsed = isLong && closedSteps.length > 0
  const listed = isCompact ? shown : isLong ? openSteps : plan
  const hiddenOpen = openSteps.length - shown.length
  // Bước dự kiến của router trước khi có checklist (S6): cùng luật, mọi bước đều còn mở.
  const plannedFull = brief.steps.reduce((sum, step) => sum + rowsOf(step, stepCells), 0)
  const plannedCompact = plan.length === 0 && brief.steps.length > COLLAPSE_FROM && !fits(plannedFull)
  const plannedShown = plannedCompact ? brief.steps.slice(0, SHOWN_OPEN) : brief.steps
  const checklist =
    plan.length > 0 ? (
      <Box flexDirection="column">
        {isCollapsed ? (
          <Box flexDirection="row" gap={1}>
            <Text color={STEP_MARK.done.color} dimColor>
              {STEP_MARK.done.glyph}
            </Text>
            <Text dimColor>{l.stepsClosed(closedSteps.length)}</Text>
          </Box>
        ) : null}
        {listed.map(step => {
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
        {isCompact && hiddenOpen > 0 ? <Text dimColor>{l.stepsOpenMore(hiddenOpen)}</Text> : null}
        {isCompact ? null : (
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
        )}
      </Box>
    ) : brief.steps.length > 0 ? (
      <Box flexDirection="column">
        {plannedShown.map((step, i) => (
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
        {plannedCompact ? <Text dimColor>{l.stepsOpenMore(brief.steps.length - plannedShown.length)}</Text> : null}
      </Box>
    ) : (
      <Text dimColor>{l.noChecklist}</Text>
    )

  // --------------------------------------------------- việc giao subagent
  // ------------------------------------------------- tiến độ từng việc (0.6.1)
  // Thay mục "Việc giao subagent": việc chính, từng việc router phân (làm trực tiếp hay giao), rồi việc Claude tự giao.
  // Chỉ vẽ khi có từ hai việc trở lên; thanh theo bề rộng pane, tối thiểu 6 ô; dưới 48 ô mỗi việc hai dòng.
  const taskCells = Math.max(6, Math.min(16, Math.floor(width * 0.2)))
  const taskNodes = taskRows(view.core, props.now ?? 0).map(row => {
    const label = taskLabel(l, row)
    const runs = taskBarRuns(row.bar, taskCells)
    const counts = row.bar.kind === 'steps' ? progress(row.bar.plan) : null
    const usage = row.tools !== undefined ? `${l.taskTools(row.tools)} · ${l.taskElapsed(row.elapsedMs ?? 0)}` : ''
    const batches = row.counts !== undefined ? l.taskBatches(row.counts.done, row.counts.total, row.counts.running) : ''
    const detail = [counts !== null ? `${counts.closed}/${counts.total}` : '', batches, usage].filter(Boolean).join(' · ')
    // Chữ trạng thái: thanh không có bước thì luôn ghi; thanh theo bước của agent chỉ ghi khi agent đã kết thúc.
    const word =
      row.bar.kind === 'state'
        ? row.state === 'running' && row.kind !== 'agent'
          ? l.taskDoing
          : l.taskState[row.state]
        : row.kind === 'agent' && row.state !== 'running'
          ? l.taskState[row.state]
          : ''
    // Dòng việc nhiều lô đã ghi "r đang chạy" trong phần chi tiết: không lặp chữ trạng thái (vòng sửa 2 của 0.7.5).
    const shownWord = detail.includes(word) ? '' : word
    const wordColor = row.state === 'failed' ? 'error' : row.state === 'cut' ? 'warning' : row.state === 'running' ? 'claude' : undefined
    const barNode = (
      <Box flexShrink={0}>
        <Text>{runs.map(tint)}</Text>
      </Box>
    )
    const meta = [
      row.pick ? (
        <Box flexShrink={0}>
          <Text color={FAMILY_HUE[row.pick.family]}>{`${row.pick.family} ${row.pick.effort}`}</Text>
        </Box>
      ) : null,
      detail ? (
        <Box flexShrink={0}>
          <Text dimColor>{detail}</Text>
        </Box>
      ) : null,
      shownWord ? (
        <Box flexShrink={0}>
          <Text color={wordColor} dimColor={wordColor === undefined}>
            {shownWord}
          </Text>
        </Box>
      ) : null,
    ]
    const labelNode = (
      <Text wrap="truncate-end" bold={row.kind === 'main'} dimColor={row.state === 'done'}>
        {label}
      </Text>
    )
    return isNarrow ? (
      <Box key={row.key} flexDirection="column">
        {labelNode}
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          {barNode}
          {meta}
        </Box>
      </Box>
    ) : (
      <Box key={row.key} flexDirection="row" gap={1}>
        {barNode}
        <Box flexGrow={1} flexShrink={1}>
          {labelNode}
        </Box>
        {meta}
      </Box>
    )
  })

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
      {/* 0.7.5: checklist và tiến độ từng việc ngay sau phần đầu, để pane 16 dòng thấy được chúng; chế độ, hạn mức, cảnh báo sau. */}
      <Box flexDirection="column">
        {heading(plan.length > 0 ? l.checklist : l.planned, plan.length > 0 ? countLabel(plan) : undefined)}
        {source === 'mirror' ? (
          <Text dimColor wrap="wrap">
            {l.mirrorSource}
          </Text>
        ) : null}
        {checklist}
      </Box>
      {taskNodes.length > 1 ? (
        <Box flexDirection="column">
          {heading(l.taskSection, String(taskNodes.length))}
          {taskNodes}
        </Box>
      ) : null}
      {modeRow}
      {quotaNode}
      {alerts}
      {hintNode}
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
