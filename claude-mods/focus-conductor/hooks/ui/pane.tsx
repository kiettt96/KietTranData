// Pane chi tiết, xếp theo thứ tự cần nhìn: mục tiêu và chế độ, hạn mức, cảnh báo, checklist, tiến độ từng việc,
// điều phối, chi phí, nhật ký; ràng buộc và tiêu chí chất lượng (nội dung tĩnh) ở cuối.
// Hàm vẽ thuần như band: handler do hook tạo và truyền vào.

import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import type { Mode, PlanStep, StepStatus } from '../../types'
import { estimateLine, formatCost, ledgerLines, sessionUsd } from '../lib/ledger'
import type { View } from '../lib/state'
import { shownPlan } from '../lib/mirror'
import { shownConstraints } from '../lib/router'
import { rowStatusState, runningGroups, runningTitles, stepTaskRows, taskRows, taskStatusOf } from '../lib/progress'
import type { TaskRow } from '../lib/progress'
import { liveForks } from '../lib/forks'
import { countLabel, progress } from '../lib/text'
import type { BandQuota, QuotaPaneText } from '../lib/text'
import { attentionItems } from './attention'
import { conductorLine, labels, shownEntry, stepTaskMeta, taskLabel } from './labels'
import type { Run } from './style'
import { DEFAULT_NEON, paintOf } from './neon'
import type { GradientName } from './neon'
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
  oneLine,
  padStart,
  phaseOf,
  plannedRuns,
  ratioRuns,
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
/**
 * Mục Cần chú ý hiện tối đa số mục này (tạm dừng tính là một), phần còn lại gom thành "+N mục khác". Mỗi mục wrap theo chiều rộng
 * (thường 1 đến 2 dòng) và không cắt cụt: câu dài hơn 2 dòng (như cảnh báo bước verified thiếu bằng chứng) vẫn hiện đủ câu, vì phần
 * cuối câu là chỉ dẫn cần làm.
 */
const ATTENTION_MAX = 4
/** Số ô tối thiểu giữ cho tên việc ở dòng Đang chạy khi phải cắt tên để giữ phần sau (UI2) [Giả định: đủ thấy mã bước như "BƯỚC 4"]. */
/** Số việc đã xong vẽ từng dòng ở mục tiến độ; nhiều hơn thì gộp một dòng (0.8.9 D3). */
const DONE_ROWS_SHOWN = 5
const RUNNING_NAME_CELLS = 8
/** Ký hiệu tạm dừng, như band. */
const PAUSE_GLYPH = '\u23F8'

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
  /** Nhịp của dải màu (0.8.8 N5): số giây của đồng hồ lúc vẽ. Vắng thì 0. */
  frame?: number
}

export function renderPane(
  t: Elements[RenderSurface],
  view: View,
  props: PaneProps,
  handlers: PaneHandlers,
  /** Mục Hạn mức (0.6.1): null khi quotaGuard tắt, mục không được vẽ. */
  quota: QuotaPaneText | null = null,
  /** Tạm dừng và câu báo hạn mức mềm như band (0.7.6, W1); null khi quotaGuard tắt. */
  pause: BandQuota | null = null,
): RenderElement {
  const { Box, Text, Button } = t
  const { brief, route, log, warnings, ledger } = view.core
  // Checklist để vẽ: của tool plan, nếu chưa có thì danh sách việc Claude Code tự ghi (phản chiếu, 0.6.1).
  const { plan, source } = shownPlan(view.core)
  const l = labels(view.lang)
  // Dòng chữ dài hơn ~100 ô khó đọc: pane inline rộng vẫn giữ nội dung trong 100 ô.
  const width = Math.max(36, Math.min(columnsOf(props.columns, 56), 100))
  const isNarrow = width < 48
  // Bộ màu (0.8.8 N1): dải màu neon theo option, hay theme key khi neon off.
  const paint = paintOf(view.neon ?? DEFAULT_NEON, props.frame ?? 0)

  // Đoạn chữ có màu (và nền) của bộ màu; dùng ở mọi chỗ vẽ Run của pane.
  const tint = (r: Run, k?: number) => (
    <Text key={k} color={r.color} backgroundColor={r.bg} dimColor={r.dim} bold={r.bold}>
      {r.text}
    </Text>
  )
  // Dải của bảng màu đang chạy (neon off: theme key claude).
  const palette: GradientName = paint.phase('active') ?? 'cyber'
  /** Cách tô tiêu đề mục: một dải màu, hay ô tô đặc màu cần chú ý (mục Cần chú ý chỉ có mục mức vàng). */
  type HeadingTone = GradientName | 'attention'
  const fillRuns = (tone: HeadingTone, text: string, offset = 0): Run[] =>
    tone === 'attention'
      ? [{ text, color: paint.solid('onFill') ?? 'inverseText', bg: paint.solid('attention') ?? 'warning', bold: true }]
      : paint.fill(tone, text, { bold: true }, offset)
  // Tiêu đề mục (0.8.8 N4): tên mục là một ô tô đặc (một ô trống hai bên; tên là một Text riêng), rồi đường kẻ; số đếm hay ghi chú đẩy
  // sang phải.
  const heading = (title: string, extra?: string, tone: HeadingTone = palette) => {
    const label = ` ${title} `
    const tail = extra ? ` ${extra}` : ''
    return (
      <Text wrap="truncate-end">
        <Text>{fillRuns(tone, ' ').map(tint)}</Text>
        <Text>{fillRuns(tone, title, 1).map(tint)}</Text>
        <Text>{fillRuns(tone, ' ', 1 + cellsOf(title)).map(tint)}</Text>
        <Text color="subtle">{` ${'─'.repeat(Math.max(2, width - cellsOf(label) - 1 - cellsOf(tail)))}`}</Text>
        {extra ? <Text dimColor>{tail}</Text> : ''}
      </Text>
    )
  }
  // Thanh hạn mức và chi phí (0.8.8 N4): pane dưới 48 cột thì 6 ô, dưới 32 cột (bề rộng engine cấp) thì bỏ thanh, giữ số.
  const rawColumns = columnsOf(props.columns, 56)
  const meterCells = (normal: number) => (rawColumns < 32 ? 0 : isNarrow ? 6 : normal)

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
  const quotaCells = meterCells(12)
  const quotaLabelWidth = Math.max(0, ...(quota?.bars ?? []).map(bar => cellsOf(bar.label)))
  const quotaBar = (bar: NonNullable<QuotaPaneText['bars']>[number]) => (
    <Text wrap="truncate-end">
      <Text dimColor>{padEnd(bar.label, quotaLabelWidth)}</Text>
      {quotaCells > 0 ? <Text>{[{ text: ' ', color: 'subtle' as const }, ...ratioRuns(bar.used / 100, quotaCells, paint, bar.level === 'paused' ? 'pause' : bar.level === 'near' ? 'almost' : palette)].map(tint)}</Text> : ''}
      <Text bold={bar.level !== 'far'}>{` ${bar.percent}`}</Text>
    </Text>
  )
  const quotaNode = quota ? (
    <Box flexDirection="column">
      {heading(l.quota, quota.reset ? l.quotaResetHeading(quota.reset) : undefined, quota.isPaused ? 'pause' : palette)}
      {(quota.bars ?? []).map(quotaBar)}
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
  // ------------------------------------------------------- cần chú ý (W1)
  // Cùng thứ tự mức độ với band: tạm dừng cứng (lý do, giờ làm mới, lệnh chạy tiếp) rồi các mục của attentionItems. Cảnh báo đã hiện ở đây
  // không lặp ở "Cảnh báo khác"; mục bị dồn vào "+N" vẫn nằm ở "Cảnh báo khác" nên không mất cảnh báo nào.
  const isPaused = pause?.paused === true
  const attentionAll = attentionItems(view.core, view.lang, { paused: false, notice: pause?.notice ?? null })
  const attentionTotal = (isPaused ? 1 : 0) + attentionAll.length
  const attentionShown = attentionAll.slice(0, ATTENTION_MAX - (isPaused ? 1 : 0))
  const attentionHidden = attentionTotal - (isPaused ? 1 : 0) - attentionShown.length
  const attentionWidth = Math.max(8, width - 2)
  // Ký hiệu ở dòng đầu, các dòng sau thụt hai ô cho thẳng chữ.
  const hanging = (glyph: string, text: string) => wrapText(text, attentionWidth, 99).map((line, i) => `${i === 0 ? glyph : ' '} ${line}`)
  const pauseLines = pause !== null && isPaused ? [hanging(PAUSE_GLYPH, pause.line), hanging(' ', pause.resume)] : []
  const itemLines = attentionShown.map(item => ({ item, lines: hanging(severityGlyph(item.severity), item.text) }))
  const attentionRows = attentionTotal === 0 ? 0 : 1 + pauseLines.reduce((sum, lines) => sum + lines.length, 0) + itemLines.reduce((sum, entry) => sum + entry.lines.length, 0) + (attentionHidden > 0 ? 1 : 0)
  const attentionNode =
    attentionTotal === 0 ? null : (
      <Box flexDirection="column">
        {heading(l.attention, String(attentionTotal), attentionShown.some(item => item.severity === 'error') || attentionAll.some(item => item.severity === 'error') ? 'warn' : 'attention')}
        {pauseLines.map((lines, k) => (
          <Box key={`pause-${k}`} flexDirection="column">
            {lines.map(line => (
              <Text color="warning" bold={k === 0} wrap="truncate-end">
                {line}
              </Text>
            ))}
          </Box>
        ))}
        {itemLines.map(({ item, lines }, k) => (
          <Box key={`item-${k}`} flexDirection="column">
            {lines.map(line => (
              <Text color={item.severity} wrap="truncate-end">
                {line}
              </Text>
            ))}
          </Box>
        ))}
        {attentionHidden > 0 ? <Text dimColor>{l.attentionMore(attentionHidden)}</Text> : null}
      </Box>
    )
  const shownWarnings = new Set(attentionShown.map(item => item.warning).filter(w => w !== undefined))
  const recentWarnings = warnings.filter(w => w.at >= brief.at && !shownWarnings.has(w)).slice(-5).reverse()
  const latest = warnings.filter(w => w.at >= brief.at && w.isSoft !== true).at(-1)
  const spine = latest ? severityOf(latest.kind) : 'claude'

  // ------------------------------------------------------------- mục tiêu
  const planned = total === 0 ? brief.steps.length : 0
  const phase = phaseOf(plan)
  const phaseWord = l.phase[phase]
  // Dòng tiến độ: thanh, số bước đã đóng, tên giai đoạn. Thanh lấy phần chiều rộng còn lại, từ 8 đến 24 ô.
  const bar = barRuns(plan, Math.max(8, Math.min(24, width - 2 - 5 - 2 - cellsOf(phaseWord))), false, paint)
  const beads = plannedRuns(planned, Math.min(24, width - 12))
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
      // Cần chú ý đã hiện cảnh báo hay dòng tạm dừng thì không lặp "Không có cảnh báo." hay "Đang tạm dừng".
      attentionNode !== null ? null : quota?.isPaused ? (
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
              <Text wrap="wrap" dimColor={w.isSoft === true}>{`${severityGlyph(severity)} ${shownEntry(w, view.lang)}`}</Text>
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
  // Một danh sách (U1): dòng bước khớp một việc mang chip model và số lô của việc đó; mọi bước đã đóng thì bỏ việc chưa từng giao (U10).
  const isFinished = total > 0 && closed === total
  const allTaskRows = taskRows(view.core, props.now ?? 0).filter(row => !(isFinished && row.state === 'pending'))
  const stepTitles = plan.length > 0 ? plan.map(step => step.title) : brief.steps
  const { byTitle, matched } = stepTaskRows(view.core, allTaskRows, stepTitles)
  // W4: bước còn todo mà đã có lô đang chạy hiện ◐ thay ○.
  const runningSteps = runningTitles(view.core, allTaskRows, stepTitles)
  // Phần chi tiết của một dòng việc: k/n bước, số lô, số tool call và thời gian; dùng chung cho dòng bước và dòng việc riêng. Trên dòng
  // bước (`isStepRow`), việc làm trực tiếp không ghi k/n: các bước của nó chính là các dòng bước.
  const rowDetail = (row: (typeof allTaskRows)[number], isStepRow: boolean) => {
    const counts = row.bar.kind === 'steps' && !(isStepRow && row.kind === 'direct') ? progress(row.bar.plan) : null
    const usage = row.tools !== undefined ? `${l.taskTools(row.tools)} · ${l.taskElapsed(row.elapsedMs ?? 0)}` : ''
    const batches = !isStepRow && row.counts !== undefined ? l.taskBatches(row.counts.done, row.counts.total, row.counts.running) : ''
    return [counts !== null ? `${counts.closed}/${counts.total}` : '', batches, usage].filter(Boolean).join(' · ')
  }
  const metaNode = (title: string) => {
    const row = byTitle.get(title)
    const meta = row ? stepTaskMeta(l, row) : ''
    if (row === undefined || !meta) return null
    const detail = rowDetail(row, true)
    const tone = row.state === 'failed' || (row.failed ?? 0) > 0 ? 'error' : row.state === 'cut' ? 'warning' : undefined
    return [
      <Box key="chip" flexShrink={0}>
        <Text color={tone ?? (row.pick ? FAMILY_HUE[row.pick.family] : undefined)} dimColor={row.state === 'done'}>
          {meta}
        </Text>
      </Box>,
      detail ? (
        <Box key="detail" flexShrink={0}>
          <Text dimColor>{detail}</Text>
        </Box>
      ) : null,
    ]
  }
  // W3: pane hẹp (dưới 48 cột) đặt chip model và số lô xuống dòng riêng dưới tên bước, trong cột tên, để tên bước có đủ chiều rộng.
  const narrowMeta = (title: string) => {
    const nodes = isNarrow ? metaNode(title) : null
    return nodes === null ? null : (
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        {nodes}
      </Box>
    )
  }
  const idWidth = Math.max(1, ...plan.map(step => String(step.id).length), String(brief.steps.length).length)
  // Checklist dài (vòng sửa 2 của 0.7.5): các bước đã đóng dồn thành một dòng tóm tắt, để pane tự mở 16 dòng còn chỗ cho tiến độ
  // từng việc; checklist ngắn giữ nguyên từng bước. Không dạng gọn mà checklist trên 6 bước thì còn tối đa 4 bước mở nên đã đóng ít
  // nhất 3 bước: dòng tóm tắt luôn tiết kiệm được dòng.
  const closedSteps = plan.filter(step => progress([step]).closed === 1)
  const openSteps = plan.filter(step => !closedSteps.includes(step))
  // S6: ước lượng số dòng (ngắt chữ như wrapText) để biết dạng đầy đủ có đẩy tiêu đề tiến độ từng việc ra ngoài số dòng của pane không.
  const rowsOf = (text: string, cells: number) => Math.max(1, wrapText(text, cells, 99).length)
  const stepCells = width - idWidth - 3
  // UI1 (0.7.9): pane hẹp cắt tên bước còn đúng một dòng bằng oneLine (mã đầu tên giữ trọn); chip vẫn xuống dòng riêng như W3.
  const isOneLine = isNarrow
  const titleRows = (title: string) => (isOneLine ? 1 : rowsOf(title, stepCells))
  // W3: pane hẹp đặt chip và chi tiết của việc khớp bước xuống dòng riêng, nên cộng số dòng của chúng.
  const metaRows = (title: string) => {
    const row = byTitle.get(title)
    const meta = row ? stepTaskMeta(l, row) : ''
    return !isNarrow || row === undefined || !meta ? 0 : rowsOf([meta, rowDetail(row, true)].filter(Boolean).join(' '), stepCells)
  }
  const stepRows = (step: PlanStep) =>
    titleRows(step.title) + (step.check ? rowsOf(`${l.check}: ${step.check}`, stepCells) : 0) + (step.note ? rowsOf(step.note, stepCells) : 0) + metaRows(step.title)
  // Chú giải (U7): chỉ các loại ký hiệu đang thấy, và chỉ khi các bước mở đang thấy có từ hai loại trở lên.
  const legendOf = (steps: readonly PlanStep[]) => {
    const kinds = new Set(steps.map(step => step.status))
    const openKinds = new Set(steps.filter(step => progress([step]).closed === 0).map(step => step.status))
    return openKinds.size >= 2 ? STEP_ORDER.filter(status => kinds.has(status)) : []
  }
  const legendRows = (items: readonly StepStatus[]) => {
    if (items.length === 0) return 0
    let lines = 1
    let used = 0
    for (const status of items) {
      const cells = 2 + cellsOf(l.legend[status])
      if (used > 0 && used + 2 + cells > width) {
        lines += 1
        used = cells
      } else used += (used > 0 ? 2 : 0) + cells
    }
    return 1 + lines
  }
  // Mục Cần chú ý nằm ngay sau phần đầu, cách một dòng (gap), nên tính vào phần đầu của số dòng pane.
  const headerRows =
    goalLines.length +
    (bar.length > 0 || beads.length > 0 ? 1 : 0) +
    (brief.source === 'router' ? 0 : rowsOf(l.notRead, width - 2)) +
    (attentionRows > 0 ? attentionRows + 1 : 0)
  const mirrorRows = source === 'mirror' ? rowsOf(l.mirrorSource, width) : 0
  // Dải bước (0.8.8 N4): một dòng ký hiệu và số thứ tự của từng bước ở đầu checklist; checklist một bước thì không có.
  const stripRows = plan.length > 1 ? 1 : 0

  // Checklist và tiến độ từng việc là một danh sách (U1): dạng đầy đủ vừa khi phần đầu, khoảng cách, tiêu đề checklist và cả danh sách
  // nằm trong số dòng của pane.
  const fits = (listRows: number) => headerRows + mirrorRows + stripRows + listRows + 2 <= (props.rows ?? DEFAULT_ROWS)
  // Checklist dài (vòng sửa 2 của 0.7.5): các bước đã đóng dồn thành một dòng tóm tắt; checklist ngắn giữ nguyên từng bước. Không dạng gọn
  // mà checklist trên 6 bước thì vẫn có dòng tóm tắt bước đã đóng.
  const isLong = plan.length > COLLAPSE_FROM
  const fullRows = (isLong && closedSteps.length > 0 ? 1 : 0) + (isLong ? openSteps : plan).reduce((sum, step) => sum + stepRows(step), 0) + legendRows(legendOf(isLong ? openSteps : plan))
  // Dạng gọn (R10, S6): checklist dài mà dạng đầy đủ không vừa thì chỉ hiện bước đang làm (không có thì bước mở đầu tiên) và các bước mở kế tiếp.
  const isCompact = isLong && !fits(fullRows)
  const start = Math.max(0, openSteps.findIndex(step => step.status === 'doing'))
  const shown = isCompact ? openSteps.slice(start, start + SHOWN_OPEN) : []
  const isCollapsed = isLong && closedSteps.length > 0
  const listed = isCompact ? shown : isLong ? openSteps : plan
  const hiddenOpen = openSteps.length - shown.length
  // Bước dự kiến của router trước khi có checklist (S6): cùng luật, mọi bước đều còn mở.
  const plannedFull = brief.steps.reduce((sum, step) => sum + titleRows(step) + metaRows(step), 0)
  const plannedCompact = plan.length === 0 && brief.steps.length > COLLAPSE_FROM && !fits(plannedFull)
  const plannedShown = plannedCompact ? brief.steps.slice(0, SHOWN_OPEN) : brief.steps
  // Dải bước: ký hiệu kèm số; không vừa một dòng thì chỉ ký hiệu; vẫn không vừa thì cắt và ghi +N. Bước đang làm in đậm.
  const stripMarks = plan.map(step => ({ step, mark: step.status === 'todo' && runningSteps.has(step.title) ? STEP_MARK.doing : STEP_MARK[step.status] }))
  const withIds = stripMarks.map(({ step, mark }) => `${mark.glyph}${step.id}`)
  const stripText = withIds.join(' ')
  const isStripIds = cellsOf(stripText) <= width
  const stripFits = (n: number) => n + (n < stripMarks.length ? 1 + cellsOf(`+${stripMarks.length - n}`) : 0) <= width
  let stripShown = stripMarks.length
  while (!isStripIds && stripShown > 0 && !stripFits(stripShown)) stripShown -= 1
  const stripNode =
    stripRows > 0 ? (
      <Text wrap="truncate-end">
        {stripMarks.slice(0, isStripIds ? stripMarks.length : stripShown).map(({ step, mark }, k) => (
          <Text key={k} color={mark.color} dimColor={mark.dim} bold={step.status === 'doing' ? paint.frame % 2 === 0 : mark.bold}>
            {`${isStripIds && k > 0 ? ' ' : ''}${mark.glyph}${isStripIds ? step.id : ''}`}
          </Text>
        ))}
        {!isStripIds && stripShown < stripMarks.length ? <Text dimColor>{` +${stripMarks.length - stripShown}`}</Text> : null}
      </Text>
    ) : null
  const checklist =
    plan.length > 0 ? (
      <Box flexDirection="column">
        {stripNode}
        {isCollapsed ? (
          <Box flexDirection="row" gap={1}>
            <Text color={STEP_MARK.done.color} dimColor>
              {STEP_MARK.done.glyph}
            </Text>
            <Text dimColor>{l.stepsClosed(closedSteps.length, closedSteps.filter(step => step.status === 'verified').length, closedSteps.filter(step => step.status === 'skipped').length)}</Text>
          </Box>
        ) : null}
        {listed.map(step => {
          const mark = step.status === 'todo' && runningSteps.has(step.title) ? STEP_MARK.doing : STEP_MARK[step.status]
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
                {isOneLine ? (
                  <Text wrap="truncate-end" bold={step.status === 'doing'} dimColor={isFaded}>
                    {oneLine(step.title, stepCells)}
                  </Text>
                ) : (
                  <Text wrap="wrap" bold={step.status === 'doing'} dimColor={isFaded}>
                    {step.title}
                  </Text>
                )}
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
                {narrowMeta(step.title)}
              </Box>
              {isNarrow ? null : metaNode(step.title)}
            </Box>
          )
        })}
        {isCompact && hiddenOpen > 0 ? <Text dimColor>{l.stepsOpenMore(hiddenOpen)}</Text> : null}
        {isCompact || legendOf(listed).length === 0 ? null : (
          <Box marginTop={1} flexDirection="row" flexWrap="wrap" columnGap={2}>
            {legendOf(listed).map(status => (
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
              <Text color={runningSteps.has(step) ? STEP_MARK.doing.color : 'inactive'}>{runningSteps.has(step) ? STEP_MARK.doing.glyph : STEP_MARK.todo.glyph}</Text>
              <Text dimColor>{padStart(String(i + 1), idWidth)}</Text>
            </Box>
            <Box flexDirection="column" flexGrow={1} flexShrink={1}>
              {isOneLine ? <Text wrap="truncate-end">{oneLine(step, stepCells)}</Text> : <Text wrap="wrap">{step}</Text>}
              {narrowMeta(step)}
            </Box>
            {isNarrow ? null : metaNode(step)}
          </Box>
        ))}
        {plannedCompact ? <Text dimColor>{l.stepsOpenMore(brief.steps.length - plannedShown.length)}</Text> : null}
      </Box>
    ) : null

  // --------------------------------------------------- việc giao subagent
  // ------------------------------------------------- tiến độ từng việc (0.6.1)
  // Thay mục "Việc giao subagent": việc chính, từng việc router phân (làm trực tiếp hay giao), rồi việc Claude tự giao.
  // Chỉ vẽ khi có từ hai việc trở lên; thanh theo bề rộng pane, tối thiểu 6 ô; dưới 48 ô mỗi việc hai dòng.
  const taskCells = Math.max(6, Math.min(16, Math.floor(width * 0.2)))
  // Tiêu đề mục (0.8.9 D3): tổng kết theo trạng thái từng việc của mục tiêu; pane hẹp dưới 48 cột chỉ ghi số việc xong trên tổng.
  const statuses = taskStatusOf(view.core, props.now ?? 0)
  const countOf = (status: string) => brief.tasks.filter(task => statuses[task.index] === status).length
  const doneCount = countOf('done')
  const taskHeading = isNarrow
    ? `${doneCount}/${brief.tasks.length}`
    : l.taskSummary(doneCount, brief.tasks.length, countOf('running'), countOf('not started'), countOf('failed'), (brief.removed ?? []).length)
  /** Dòng gộp việc đã xong: số việc kèm danh sách số cắt theo bề rộng, phần còn lại ghi "+N". */
  const foldedDone = (count: number, numbers: readonly number[]) => {
    let shown = numbers.length
    const text = (n: number) => l.doneCollapsed(count, `${numbers.slice(0, n).join(', ')}${n < numbers.length ? ` +${numbers.length - n}` : ''}`)
    while (shown > 1 && cellsOf(text(shown)) > width) shown -= 1
    return text(shown)
  }
  // Chỉ việc không đi cùng bước nào (U1): việc Claude tự giao và việc không khớp bước; việc chính chính là danh sách bước ở trên.
  // Ba nhóm (0.8.9 D3): đang chạy và lỗi; chưa làm theo thứ tự làm đã lưu (không có thì theo số); đã xong. Nhiều hơn 5 việc đã xong thì
  // gộp một dòng.
  const listedRows = allTaskRows.filter(row => row.kind !== 'main' && !matched.has(row.key))
  const groupOf = (row: TaskRow) => {
    const state = rowStatusState(row)
    return state === 'running' || state === 'failed' || state === 'cut' ? 0 : state === 'done' ? 2 : 1
  }
  const orderAt = new Map((brief.order ?? []).map((index, at) => [index, at]))
  const placeOf = (row: TaskRow) => (row.index === undefined ? Number.MAX_SAFE_INTEGER : (orderAt.get(row.index) ?? orderAt.size + row.index))
  const sortedRows = listedRows
    .map((row, at) => ({ row, at }))
    .sort((a, b) => groupOf(a.row) - groupOf(b.row) || (groupOf(a.row) === 1 ? placeOf(a.row) - placeOf(b.row) : 0) || a.at - b.at)
    .map(entry => entry.row)
  const doneRows = sortedRows.filter(row => groupOf(row) === 2)
  const isDoneFolded = doneRows.length > DONE_ROWS_SHOWN
  const taskNodes = (isDoneFolded ? sortedRows.filter(row => groupOf(row) !== 2) : sortedRows).map(row => {
    const label = taskLabel(l, row)
    const runs = taskBarRuns(row.bar, taskCells, paint)
    const detail = rowDetail(row, false)
    // Chữ trạng thái: thanh không có bước thì luôn ghi; thanh theo bước của agent chỉ ghi khi agent đã kết thúc.
    const word = row.noStep === true
      ? l.noStep
      : row.bar.kind === 'state'
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

  if (isDoneFolded) {
    const numbers = [...new Set(doneRows.flatMap(row => (row.index !== undefined ? [row.index] : [])))].sort((a, b) => a - b)
    taskNodes.push(
      <Text key="done-folded" dimColor wrap="truncate-end">
        {foldedDone(doneRows.length, numbers)}
      </Text>,
    )
  }

  // Việc của các đợt trước đã cất (0.8.0 A3): một dòng mờ, không tính vào tiến độ.
  const archived = brief.archived ?? 0
  if (archived > 0) {
    taskNodes.push(
      <Text key="phase-archived" dimColor wrap="truncate-end">
        {l.phaseArchived(archived)}
      </Text>,
    )
  }

  // ----------------------------------------------------------- đang chạy
  // U8: mỗi việc có subagent đang chạy một dòng: tên việc, khoảng lô, số agent đang chạy, thời gian từ agent đầu tiên của nhóm.
  // UI2 (0.7.9): dòng dài hơn bề ngang thì cắt tên việc trước (oneLine), giữ trọn phần sau, nhất là "· từ HH:MM"; tên còn ít nhất
  // RUNNING_NAME_CELLS ô, pane hẹp hơn nữa thì phần cuối dòng mới bị cắt.
  const runningNodes = runningGroups(view.core, props.now ?? 0).map(group => {
    const tail = [group.range ? ` · ${l.runningRange(group.range.first, group.range.last)}` : '', ` · ${l.runningAgents(group.agents)}`, ` · ${l.taskElapsed(group.elapsedMs)}`, ` · ${l.runningSince(group.startedAt)}`].join('')
    const name = oneLine(taskLabel(l, group), Math.max(RUNNING_NAME_CELLS, width - cellsOf(tail)))
    return (
      <Text key={group.key} wrap="truncate-end">
        <Text color="claude">{name}</Text>
        <Text dimColor>{tail}</Text>
      </Text>
    )
  })

  // ----------------------------------------------------------- điều phối
  // Fable điều phối (0.8.4 C8): một dòng trạng thái, chỉ khi option conductor là fable.
  const conductorText = view.conductor !== undefined ? conductorLine(view.core, view.conductor.fallback, view.lang, view.conductor.family) : null
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
      {conductorText !== null ? <Text wrap="wrap">{conductorText}</Text> : null}
    </Box>
  ) : conductorText === null ? (
    <Text dimColor wrap="wrap">
      {l.notApplied}
    </Text>
  ) : (
    <Box flexDirection="column">
      <Text dimColor wrap="wrap">
        {l.notApplied}
      </Text>
      <Text wrap="wrap">{conductorText}</Text>
    </Box>
  )

  // ------------------------------------------------------------ chi phí
  const groups = [
    { label: l.groupMain, key: 'main' },
    { label: l.groupAgent, key: 'agent' },
    { label: l.groupRouter, key: 'analyzer' },
  ] as const
  const costCells = meterCells(BAR)
  const hasBars = costCells > 0
  const labelWidth = Math.max(...groups.map(g => cellsOf(g.label)), cellsOf(l.total))
  const moneyWidth = Math.max(cellsOf(l.costGoal), cellsOf(l.costSession), 7)
  const callWidth = Math.max(cellsOf(l.costCalls), 3)
  const maxGoal = Math.max(...groups.map(g => ledger.goal.buckets[g.key].usd))
  const barOf = (usd: number) => <Text>{ratioRuns(maxGoal > 0 ? usd / maxGoal : 0, costCells, paint, palette).map(tint)}</Text>
  const costHead = `${padEnd('', labelWidth)}${hasBars ? ' '.repeat(costCells + 1) : ''} ${padStart(l.costGoal, moneyWidth)} ${padStart(l.costSession, moneyWidth)} ${padStart(l.costCalls, callWidth)}`
  const totalCalls = groups.reduce((sum, g) => sum + ledger.session[g.key].calls, 0)
  // Phiên con (0.7.9 F1) tính vào nhóm subagent, không thêm nhóm: một dòng ghi số phiên con của mục tiêu.
  const forkCount = liveForks(view.core).length
  const extraLines = [...ledgerLines(ledger, view.lang).slice(2), ...(estimateLine(log, view.lang) ? [estimateLine(log, view.lang) as string] : []), ...(forkCount > 0 ? [l.forkCost(forkCount)] : [])]
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
          {` ${padStart(formatCost(ledger.goal.buckets[g.key].usd, view.lang), moneyWidth)}`}
          <Text dimColor>{` ${padStart(formatCost(ledger.session[g.key].usd, view.lang), moneyWidth)} ${padStart(String(ledger.session[g.key].calls), callWidth)}`}</Text>
        </Text>
      ))}
      <Text bold wrap="truncate-end">
        {`${padEnd(l.total, labelWidth)}${hasBars ? ' '.repeat(costCells + 1) : ''} ${padStart(formatCost(goalUsd(ledger), view.lang), moneyWidth)} ${padStart(formatCost(sessionUsd(ledger), view.lang), moneyWidth)} ${padStart(String(totalCalls), callWidth)}`}
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
  const constraintsShown = shownConstraints(brief.constraints, brief.constraintsBase)
  const hasEstimate = recentLog.some(entry => entry.usd !== undefined && !entry.measured)
  const logNode = (
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
                  <Text dimColor>{`${entry.measured ? '' : '~'}${formatCost(entry.usd, view.lang)}`}</Text>
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
      {/* W1: mục Cần chú ý ngay dưới thanh tiến độ, trước checklist; chỉ vẽ khi có ít nhất một mục. */}
      {attentionNode}
      {/* 0.7.5: checklist và tiến độ từng việc ngay sau phần đầu, để pane 16 dòng thấy được chúng; chế độ, hạn mức, cảnh báo sau. */}
      {/* U11: chưa có checklist thì bước dự kiến của router nằm dưới "Danh sách bước (dự kiến)"; không có bước nào thì không có mục. */}
      {checklist !== null ? (
        <Box flexDirection="column">
          {heading(l.checklist, plan.length > 0 ? countLabel(plan) : l.plannedTag)}
          {source === 'mirror' ? (
            <Text dimColor wrap="wrap">
              {l.mirrorSource}
            </Text>
          ) : null}
          {checklist}
        </Box>
      ) : null}
      {taskNodes.length > 0 ? (
        <Box flexDirection="column">
          {heading(l.taskSection, taskHeading)}
          {taskNodes}
        </Box>
      ) : null}
      {runningNodes.length > 0 ? (
        <Box flexDirection="column">
          {heading(l.running)}
          {runningNodes}
        </Box>
      ) : null}
      {modeRow}
      {quotaNode}
      {alerts}
      {hintNode}
      <Box flexDirection="column">
        {heading(l.cost)}
        {cost}
      </Box>
      {/* U7: chưa có quyết định nào thì không vẽ mục nhật ký. */}
      {recentLog.length > 0 ? (
        <Box flexDirection="column">
          {heading(l.log, String(recentLog.length))}
          {logNode}
        </Box>
      ) : null}
      <Box flexDirection="column">
        {heading(l.constraints)}
        {bullets(constraintsShown.items, l.noConstraints)}
        {/* 0.8.9 C2: tối đa 22 ràng buộc, kèm một dòng mờ nêu số mục còn lại. */}
        {constraintsShown.hidden > 0 ? <Text dimColor>{l.constraintsMore(constraintsShown.hidden)}</Text> : null}
      </Box>
      <Box flexDirection="column">
        {heading(l.quality)}
        {bullets(brief.quality, l.noQuality)}
      </Box>
      {/* U6: chi tiết điều phối (model luồng chính, độ sâu, khối lượng, loại, lý do router) ở cuối pane, mỗi ý một dòng cắt gọn. */}
      <Box flexDirection="column">
        {heading(l.routing)}
        {routeNode}
        <Text dimColor wrap="truncate-end">
          {l.routeShape(brief.depth, brief.volume, brief.kind)}
        </Text>
        {brief.why ? (
          <Text dimColor wrap="truncate-end">
            {brief.why}
          </Text>
        ) : null}
      </Box>
      <Box flexDirection="row" justifyContent="space-between">
        <Button key="band" label={view.isBandHidden ? l.showBand : l.hideBand} onPress={handlers.onToggleBand} />
        <Button key="reset" label={props.isResetArmed ? l.resetConfirm : l.reset} onPress={handlers.onReset} />
      </Box>
    </Box>
  )
}
