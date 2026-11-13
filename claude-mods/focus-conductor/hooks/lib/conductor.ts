// Vai điều phối (0.8.4 Fable điều phối; 0.8.7 G1: theo họ model): option conductor và các định nghĩa dùng chung. Thuần: không gọi $;
// context.ts, parts/session.ts, parts/agents.ts và giao diện gọi các hàm này, không viết lại điều kiện ở chỗ khác. Họ điều phối chính là giá
// trị của option conductor (một họ có cờ điều phối trong bảng họ model, hooks/lib/families.ts). Các tên còn chữ fable (FableInputs,
// fableBlocker, isFableReady, fableModelId, FABLE_*_TIMEOUT_MS, Core.fable) giữ vì trạng thái đã lưu, test và mẫu đột biến cũ dùng chúng;
// từ 0.8.7 G1 chúng mang nghĩa "họ điều phối chính".

import type { PluginOptions } from 'claude-code'
import type { ApprovalStatus, Brief, ModelFamily } from '../../types'
import type { SessionPolicy } from './route'
import { familyOf, resolveModelId } from './route'
import { CONDUCTOR_FAMILIES, DEFAULT_CONDUCTOR, conductorTimeouts, familyLabel } from './families'

/** Option conductor: off hay họ điều phối chính (0.8.7 G1). */
export type ConductorOption = 'off' | ModelFamily

/**
 * Option conductor: đúng tên một họ có cờ điều phối trong bảng họ model (fable, opus) là họ đó; mọi giá trị khác (kể cả vắng, rỗng, viết
 * hoa, họ không có cờ điều phối) là off.
 */
export function conductorOf(options: PluginOptions): ConductorOption {
  const raw = options['conductor']
  return CONDUCTOR_FAMILIES.find(f => f === raw) ?? 'off'
}

/**
 * Thời gian chờ của router khi gọi họ điều phối mặc định, theo loại request (0.8.4 C2). Đo tuần tự trên engine 2.1.322 ngày 10/11/2026,
 * 35 lượt [Đo trực tiếp]: 1,5 lần giá trị lớn nhất làm tròn lên bội số 5 giây (đọc prompt thường lớn nhất 17,3 s, prompt dài 76,6 s, chấm
 * subagent 8,4 s, kiểm lạc đề 8,7 s, rà kế hoạch 9,3 s) đều không vượt giá trị hiện có, nên giữ đúng giá trị hiện có. Từ 0.8.7 G1 các số
 * nằm trong bảng họ model; mỗi lượt router dùng thời gian chờ của chính họ đã gọi (conductorTimeouts).
 */
export const FABLE_PROMPT_TIMEOUT_MS = conductorTimeouts(DEFAULT_CONDUCTOR).prompt
export const FABLE_LONG_TIMEOUT_MS = conductorTimeouts(DEFAULT_CONDUCTOR).long
export const FABLE_AGENT_TIMEOUT_MS = conductorTimeouts(DEFAULT_CONDUCTOR).agent
export const FABLE_DRIFT_TIMEOUT_MS = conductorTimeouts(DEFAULT_CONDUCTOR).drift
export const FABLE_REVIEW_TIMEOUT_MS = conductorTimeouts(DEFAULT_CONDUCTOR).review

/** Đầu vào của "Fable sẵn sàng": option, chế độ điều phối, headless-off, họ đang bị chặn, số prompt router Fable còn tạm ngừng. */
export type FableInputs = {
  option: ConductorOption
  mode: string
  headless: boolean
  blocked: ReadonlySet<ModelFamily>
  pauseLeft: number
}

/** Option conductorFallback (0.8.7 F1): opus (mặc định) hay sonnet; off là không có họ dự phòng; giá trị khác là mặc định [Giả định]. */
export type FallbackOption = 'opus' | 'sonnet' | null

export function conductorFallbackOf(options: PluginOptions): FallbackOption {
  const raw = options['conductorFallback']
  if (raw === 'off') return null
  return raw === 'sonnet' ? 'sonnet' : 'opus'
}

/** Nguyên nhân Fable không sẵn sàng; null là sẵn sàng. */
export type FableBlocker = 'option' | 'mode' | 'headless' | 'blocked' | 'paused'

/** Nguyên nhân họ điều phối chính không sẵn sàng (0.8.7 G1: họ là giá trị của option conductor); null là sẵn sàng. */
export function fableBlocker(input: FableInputs): FableBlocker | null {
  if (input.option === 'off') return 'option'
  if (input.headless) return 'headless'
  if (input.mode === 'off') return 'mode'
  if (input.blocked.has(input.option)) return 'blocked'
  if (input.pauseLeft > 0) return 'paused'
  return null
}

export function isFableReady(input: FableInputs): boolean {
  return fableBlocker(input) === null
}

/**
 * Mục tiêu lớn: không phải đối chiếu, không phải mục tiêu tối thiểu, và hoặc đã từng là mục tiêu lớn (`isBig`, 0.8.4 X1) hoặc độ sâu
 * substantial hay hard với loại khác answer.
 */
export function isBigGoal(brief: Pick<Brief, 'depth' | 'kind' | 'isReference' | 'isBare' | 'isBig'> | null): boolean {
  if (brief === null || brief.isReference || brief.isBare === true) return false
  return brief.isBig === true || ((brief.depth === 'substantial' || brief.depth === 'hard') && brief.kind !== 'answer')
}

/** Trạng thái của một mục tiêu cần cho định nghĩa "mục tiêu đang dở" (0.8.5): số bước mở, số bước, trạng thái duyệt, số turn thực thi đã kết thúc. */
export type PendingState = { open: number; total: number; approval: ApprovalStatus; turnsDone?: number }

/**
 * Mục tiêu đang dở (0.8.4 A1, 0.8.5 K2, K8): có brief, không phải đối chiếu, và checklist còn bước mở, hay cổng duyệt đang planning hay
 * presented, hay mục tiêu lớn chưa lập checklist mà chưa có turn thực thi nào của luồng chính cho nó kết thúc. Dùng chung cho tin ngoài
 * lề, cất mục tiêu, giữ mục tiêu khi router xếp new tin cậy thấp và quay lại mục tiêu đã cất.
 */
export function isPendingGoal(brief: Brief | null, state: PendingState): boolean {
  if (brief === null || brief.isReference) return false
  if (state.open > 0 || state.approval === 'planning' || state.approval === 'presented') return true
  return isBigGoal(brief) && state.total === 0 && (state.turnsDone ?? 0) === 0
}

/**
 * Đầu vào của "điều phối khả dụng": như Fable sẵn sàng, cộng chính sách model của phiên và họ model phiên (null khi chưa biết), họ dự
 * phòng (0.8.7 F1, null là không có) và số prompt router họ dự phòng còn tạm ngừng.
 */
export type ConductorInputs = FableInputs & { sessionPolicy: SessionPolicy; sessionFamily: ModelFamily | null; fallback?: ModelFamily | null; fallbackPauseLeft?: number }

/** Họ đang điều phối (0.8.7 F1): fable khi Fable sẵn sàng; họ dự phòng khi Fable không dùng được, kèm lý do; null là không có. */
export type ActiveConductor = { family: ModelFamily; isFallback: boolean; reason: 'blocked' | 'paused' | null }

/**
 * Họ đang điều phối (0.8.7 F1). Fable sẵn sàng thì fable. Fable không dùng được (họ fable bị chặn hay router Fable tạm ngừng; nguyên nhân
 * là cấu hình thì không) thì họ dự phòng, khi có, khác fable, không bị chặn, router của nó không tạm ngừng, chế độ là auto và chính sách
 * model của phiên không giữ model khác. Còn lại null, như 0.8.6.
 */
export function activeConductor(input: ConductorInputs): ActiveConductor | null {
  const blocker = fableBlocker(input)
  if (input.option === 'off') return null
  const primary = input.option
  if (blocker === null) return { family: primary, isFallback: false, reason: null }
  if (blocker !== 'blocked' && blocker !== 'paused') return null
  const fallback = input.fallback ?? null
  // Họ dự phòng trùng họ chính (0.8.7 G1) là không có dự phòng.
  if (fallback === null || fallback === primary || input.blocked.has(fallback) || (input.fallbackPauseLeft ?? 0) > 0) return null
  if (input.mode !== 'auto') return null
  if (input.sessionPolicy !== 'auto' && input.sessionFamily !== primary) return null
  return { family: fallback, isFallback: true, reason: blocker }
}

/** Nguyên nhân luồng chính không điều phối bằng Fable; null là điều phối khả dụng. `session`: chính sách model của phiên thắng. */
export type ConductorBlocker = FableBlocker | 'session'

export function conductorBlocker(input: ConductorInputs): ConductorBlocker | null {
  const fable = fableBlocker(input)
  // Họ dự phòng đang nhận vai (0.8.7 F1): điều phối khả dụng; activeConductor đã xét chế độ và chính sách của phiên.
  if (fable !== null && activeConductor(input) !== null) return null
  if (fable !== null) return fable
  if (input.mode !== 'auto') return 'mode'
  if (input.sessionPolicy !== 'auto' && input.sessionFamily !== input.option) return 'session'
  return null
}

export function isConductorAvailable(input: ConductorInputs): boolean {
  return conductorBlocker(input) === null
}

/** Luồng chính điều phối: điều phối khả dụng và mục tiêu hiện tại là mục tiêu lớn. */
export function isMainConducting(input: ConductorInputs, brief: Pick<Brief, 'depth' | 'kind' | 'isReference' | 'isBare'> | null): boolean {
  return isConductorAvailable(input) && isBigGoal(brief)
}

/**
 * Model của router Fable: modelMap.fable, rồi ID phiên khi phiên thuộc họ fable (giữ hậu tố), rồi (0.8.7 M1) alias fable để engine chọn
 * phiên bản hiện hành ($.model.complete nhận alias ở mọi engine đã kiểm); ID phiên có tiền tố nhà cung cấp thì tiền tố cộng ID ghim.
 */
export function fableModelId(map: Partial<Record<ModelFamily, string>>, sessionModelId: string | null, family: ModelFamily = DEFAULT_CONDUCTOR): string {
  const override = map[family]
  if (override) return override
  if (sessionModelId !== null && familyOf(sessionModelId) === family) return sessionModelId
  return resolveModelId(family, sessionModelId ?? '', {}, true)
}

/** Câu nêu nguyên nhân (nhật ký conductor, pane, status); `family` là họ điều phối chính (0.8.7 G1). */
export function blockerText(reason: ConductorBlocker, family: ModelFamily = DEFAULT_CONDUCTOR): string {
  switch (reason) {
    case 'option':
      return 'option conductor là off'
    case 'mode':
      return 'chế độ điều phối không phải auto'
    case 'headless':
      return 'phiên không tương tác (headless)'
    case 'blocked':
      return `họ ${family} đang bị chặn vì không phản hồi`
    case 'paused':
      return `router ${familyLabel(family)} tạm ngừng sau các lần lỗi`
    case 'session':
      return 'sessionModel giữ model của phiên'
  }
}

/** Mở đầu câu báo router của họ điều phối chính tạm ngừng (0.8.4 C6; 0.8.7 G1 theo họ): toast, cảnh báo model và test dùng chung. */
export function pauseText(family: ModelFamily = DEFAULT_CONDUCTOR): string {
  return `${familyLabel(family)} điều phối tạm ngừng`
}
export const FABLE_PAUSE_TEXT = pauseText()

/**
 * Bộ đếm lỗi của router Fable sau một lượt gọi (0.8.4 C6): đạt thì về 0; lỗi thì cộng một, đủ `limit` lần liên tiếp thì tạm ngừng
 * `pause` prompt và bộ đếm về 0. `isPausedNow`: lượt này vừa làm router Fable tạm ngừng.
 */
export function fableAfterCall(state: { failures: number; pauseLeft: number }, isOk: boolean, limit: number, pause: number): { failures: number; pauseLeft: number; isPausedNow: boolean } {
  if (isOk) return { failures: 0, pauseLeft: state.pauseLeft, isPausedNow: false }
  const failures = state.failures + 1
  if (failures < limit) return { failures, pauseLeft: state.pauseLeft, isPausedNow: false }
  return { failures: 0, pauseLeft: pause, isPausedNow: true }
}

/** Trạng thái điều phối để hiện (0.8.4 C8): đang điều phối, tạm ngừng, hay tắt kèm nguyên nhân. */
export type ConductorShown = { state: 'on' } | { state: 'paused' } | { state: 'fallback'; family: ModelFamily; reason: 'blocked' | 'paused'; isBig: boolean } | { state: 'off'; reason: ConductorBlocker | 'small' | 'none' }

/**
 * Trạng thái điều phối theo Core (0.8.4 C8): router Fable tạm ngừng; đã ghi sẵn sàng và mục tiêu lớn là đang điều phối; còn lại tắt, với
 * nguyên nhân đã ghi ở lần đọc prompt gần nhất (small: mục tiêu không lớn; none: chưa đọc prompt nào).
 */
export function conductorShown(core: { fable: { pauseLeft: number; ready: boolean | null; reason: string; promptPaused?: boolean }; fallback?: { active: ModelFamily | null }; brief: Pick<Brief, 'depth' | 'kind' | 'isReference' | 'isBare'> | null }, primary: ModelFamily = DEFAULT_CONDUCTOR): ConductorShown {
  // Họ dự phòng đang điều phối (0.8.7 F1, Core.fallback.active ghi ở lần đọc prompt gần nhất): lý do là router của họ chính tạm ngừng hay
  // họ chính bị chặn.
  const backup = core.fallback?.active ?? null
  if (backup !== null && backup !== primary) return { state: 'fallback', family: backup, reason: core.fable.pauseLeft > 0 || core.fable.promptPaused === true ? 'paused' : 'blocked', isBig: isBigGoal(core.brief) }
  if (core.fable.pauseLeft > 0) return { state: 'paused' }
  if (core.fable.ready === true) return isBigGoal(core.brief) ? { state: 'on' } : { state: 'off', reason: 'small' }
  const known: readonly string[] = ['option', 'mode', 'headless', 'blocked', 'paused', 'session']
  return { state: 'off', reason: known.includes(core.fable.reason) ? (core.fable.reason as ConductorBlocker) : 'none' }
}
