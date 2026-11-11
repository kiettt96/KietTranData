// Fable điều phối (0.8.4): option conductor và các định nghĩa dùng chung. Thuần: không gọi $; context.ts, parts/session.ts,
// parts/agents.ts và giao diện gọi các hàm này, không viết lại điều kiện ở chỗ khác.

import type { PluginOptions } from 'claude-code'
import type { Brief, ModelFamily } from '../../types'
import type { SessionPolicy } from './route'
import { familyOf, resolveModelId } from './route'

export type ConductorOption = 'off' | 'fable'

/** Option conductor: đúng chuỗi fable là fable; mọi giá trị khác (kể cả vắng, rỗng, Fable viết hoa) là off. */
export function conductorOf(options: PluginOptions): ConductorOption {
  return options['conductor'] === 'fable' ? 'fable' : 'off'
}

/**
 * Thời gian chờ của router khi gọi Fable, theo loại request (0.8.4 C2). Đo tuần tự trên engine 2.1.322 ngày 10/11/2026, 35 lượt
 * [Đo trực tiếp]: 1,5 lần giá trị lớn nhất làm tròn lên bội số 5 giây (đọc prompt thường lớn nhất 17,3 s, prompt dài 76,6 s, chấm
 * subagent 8,4 s, kiểm lạc đề 8,7 s, rà kế hoạch 9,3 s) đều không vượt giá trị hiện có, nên giữ đúng giá trị hiện có.
 */
export const FABLE_PROMPT_TIMEOUT_MS = 45_000
export const FABLE_LONG_TIMEOUT_MS = 120_000
export const FABLE_AGENT_TIMEOUT_MS = 20_000
export const FABLE_DRIFT_TIMEOUT_MS = 20_000
export const FABLE_REVIEW_TIMEOUT_MS = 30_000

/** Đầu vào của "Fable sẵn sàng": option, chế độ điều phối, headless-off, họ đang bị chặn, số prompt router Fable còn tạm ngừng. */
export type FableInputs = {
  option: ConductorOption
  mode: string
  headless: boolean
  blocked: ReadonlySet<ModelFamily>
  pauseLeft: number
}

/** Nguyên nhân Fable không sẵn sàng; null là sẵn sàng. */
export type FableBlocker = 'option' | 'mode' | 'headless' | 'blocked' | 'paused'

export function fableBlocker(input: FableInputs): FableBlocker | null {
  if (input.option !== 'fable') return 'option'
  if (input.headless) return 'headless'
  if (input.mode === 'off') return 'mode'
  if (input.blocked.has('fable')) return 'blocked'
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

/** Đầu vào của "điều phối khả dụng": như Fable sẵn sàng, cộng chính sách model của phiên và họ model phiên (null khi chưa biết). */
export type ConductorInputs = FableInputs & { sessionPolicy: SessionPolicy; sessionFamily: ModelFamily | null }

/** Nguyên nhân luồng chính không điều phối bằng Fable; null là điều phối khả dụng. `session`: chính sách model của phiên thắng. */
export type ConductorBlocker = FableBlocker | 'session'

export function conductorBlocker(input: ConductorInputs): ConductorBlocker | null {
  const fable = fableBlocker(input)
  if (fable !== null) return fable
  if (input.mode !== 'auto') return 'mode'
  if (input.sessionPolicy !== 'auto' && input.sessionFamily !== 'fable') return 'session'
  return null
}

export function isConductorAvailable(input: ConductorInputs): boolean {
  return conductorBlocker(input) === null
}

/** Luồng chính điều phối: điều phối khả dụng và mục tiêu hiện tại là mục tiêu lớn. */
export function isMainConducting(input: ConductorInputs, brief: Pick<Brief, 'depth' | 'kind' | 'isReference' | 'isBare'> | null): boolean {
  return isConductorAvailable(input) && isBigGoal(brief)
}

/** ID Fable cho vai điều phối: modelMap.fable, rồi ID phiên khi phiên thuộc họ fable (giữ hậu tố), rồi ID mặc định. */
export function fableModelId(map: Partial<Record<ModelFamily, string>>, sessionModelId: string | null): string {
  const override = map.fable
  if (override) return override
  if (sessionModelId !== null && familyOf(sessionModelId) === 'fable') return sessionModelId
  return resolveModelId('fable', sessionModelId ?? '', {})
}

/** Câu nêu nguyên nhân (nhật ký conductor, pane, status). */
export function blockerText(reason: ConductorBlocker): string {
  switch (reason) {
    case 'option':
      return 'option conductor là off'
    case 'mode':
      return 'chế độ điều phối không phải auto'
    case 'headless':
      return 'phiên không tương tác (headless)'
    case 'blocked':
      return 'họ fable đang bị chặn vì không phản hồi'
    case 'paused':
      return 'router Fable tạm ngừng sau các lần lỗi'
    case 'session':
      return 'sessionModel giữ model của phiên'
  }
}

/** Mở đầu câu báo router Fable tạm ngừng (0.8.4 C6): toast, cảnh báo model và test dùng chung. */
export const FABLE_PAUSE_TEXT = 'Fable điều phối tạm ngừng'

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
export type ConductorShown = { state: 'on' } | { state: 'paused' } | { state: 'off'; reason: ConductorBlocker | 'small' | 'none' }

/**
 * Trạng thái điều phối theo Core (0.8.4 C8): router Fable tạm ngừng; đã ghi sẵn sàng và mục tiêu lớn là đang điều phối; còn lại tắt, với
 * nguyên nhân đã ghi ở lần đọc prompt gần nhất (small: mục tiêu không lớn; none: chưa đọc prompt nào).
 */
export function conductorShown(core: { fable: { pauseLeft: number; ready: boolean | null; reason: string }; brief: Pick<Brief, 'depth' | 'kind' | 'isReference' | 'isBare'> | null }): ConductorShown {
  if (core.fable.pauseLeft > 0) return { state: 'paused' }
  if (core.fable.ready === true) return isBigGoal(core.brief) ? { state: 'on' } : { state: 'off', reason: 'small' }
  const known: readonly string[] = ['option', 'mode', 'headless', 'blocked', 'paused', 'session']
  return { state: 'off', reason: known.includes(core.fable.reason) ? (core.fable.reason as ConductorBlocker) : 'none' }
}
