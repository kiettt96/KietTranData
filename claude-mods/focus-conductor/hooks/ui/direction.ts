// Ô hướng của band và đoạn hướng của status line (0.8.8 N2, N3): một ký hiệu và nhãn ngắn cho biết công việc đang đi đúng hướng hay cần
// người dùng nhìn. Lấy theo mục đầu tiên của attentionItems (thứ tự ở attention.ts không đổi); tạm dừng đứng trước mọi mục; không có mục
// nào thì theo checklist: xong hết là "đã kiểm k/n", còn lại là "đúng hướng". Hàm thuần: chỉ đọc Core và dữ liệu hạn mức mà hook đã tính.

import type { Core, PlanStep, QuotaState } from '../../types'
import { shownPlan } from '../lib/mirror'
import type { QuotaSettings } from '../lib/quota'
import { evaluateQuota, isPauseActive, overrideOf, softNotices } from '../lib/quota'
import * as S from '../lib/state'
import type { View } from '../lib/state'
import type { Attention } from './attention'
import { attentionItems } from './attention'
import { labels } from './labels'
import type { Lang } from './labels'
import { severityGlyph } from './style'

/** Cách tô ô hướng: chữ màu đạt hay cần chú ý trên ô thường, hay ô tô đặc dải warn, pause, done. */
export type DirectionTone = 'ok' | 'attention' | 'warn' | 'pause' | 'done'

export type Direction = { glyph: string; label: string; tone: DirectionTone; kind: 'track' | 'pause' | 'finished' | Attention['kind'] }

const CHECK = '\u2713'
const DOT = '\u25CF'
const PAUSE = '\u23F8'

/** Nhãn ô hướng của một mục cần chú ý (bảng ở DESIGN, mục 0.8.8 N2). */
function itemLabel(item: Attention, lang: Lang): string {
  const l = labels(lang)
  switch (item.kind) {
    case 'approval':
      return l.directionApproval
    case 'failed':
      return l.directionFailed
    case 'scope':
      return l.directionScope
    case 'loop':
      return l.directionLoop
    case 'notice':
      return l.directionNotice
    case 'dropped':
      return l.directionDropped
    case 'unverified':
    case 'skill':
      return l.directionUnverified
    case 'budget':
      return l.directionBudget
    default:
      return l.directionOther
  }
}

/**
 * Hướng của mục tiêu đang mở. `paused`: đang tạm dừng (hạn mức hay người dùng); `notice`: câu báo hạn mức mềm hay null; `plan`: checklist
 * đang vẽ. Mức màu theo severity của mục đầu: error là ô tô đặc warn, warning là chữ màu cần chú ý.
 */
export function directionOf(core: Core, lang: Lang, quota: { paused: boolean; notice: string | null }, plan: readonly PlanStep[]): Direction {
  const l = labels(lang)
  if (quota.paused) return { glyph: PAUSE, label: l.directionPaused, tone: 'pause', kind: 'pause' }
  const top = attentionItems(core, lang, { paused: false, notice: quota.notice })[0]
  if (top !== undefined) return { glyph: severityGlyph(top.severity), label: itemLabel(top, lang), tone: top.severity === 'error' ? 'warn' : 'attention', kind: top.kind }
  const total = plan.length
  const closed = plan.filter(step => step.status === 'done' || step.status === 'verified' || step.status === 'skipped').length
  if (total > 0 && closed === total) {
    const verified = plan.filter(step => step.status === 'verified').length
    return verified === total
      ? { glyph: CHECK, label: l.directionVerified(verified, total), tone: 'done', kind: 'finished' }
      : { glyph: DOT, label: l.directionVerified(verified, total), tone: 'attention', kind: 'finished' }
  }
  return { glyph: CHECK, label: l.directionOnTrack, tone: 'ok', kind: 'track' }
}

/** Chữ của ô hướng: ký hiệu và nhãn. */
export function directionText(direction: Direction): string {
  return `${direction.glyph} ${direction.label}`
}

/**
 * Đoạn hướng của status line (0.8.8 N3): cùng nhãn với ô hướng của band, viết thường, không màu. Không có đoạn này khi chưa có mục tiêu,
 * và khi mục đầu là tạm dừng, chờ duyệt kế hoạch hay báo hạn mức mềm: status line đã có nhãn riêng cho ba việc đó [Nguồn: chủ mod,
 * 14/11/2026]. Tạm dừng và báo mềm tính như statusText.
 */
export function statusDirection(view: View, quota: QuotaState, now: number, settings: QuotaSettings): string | undefined {
  if (view.core.brief === null) return undefined
  const evaluation = evaluateQuota(quota.readings, now, settings)
  const isPaused = settings.enabled && isPauseActive(true, evaluation.hits, quota.pause, overrideOf(quota), now)
  const notice = settings.enabled && !isPaused && softNotices(quota.readings, now, settings).length > 0 ? 'notice' : null
  const direction = directionOf(view.core, view.lang, { paused: isPaused, notice }, shownPlan(view.core).plan)
  if (direction.kind === 'pause' || direction.kind === 'approval' || direction.kind === 'notice') return undefined
  return `${direction.glyph} ${direction.label.toLocaleLowerCase(view.lang)}`
}

/** Status line của mọi hook (0.8.8 N3): statusText kèm đoạn hướng. */
export function statusTextOf(view: View, quota: QuotaState, now: number, settings: QuotaSettings): string | undefined {
  return S.statusText(view, quota, now, settings, statusDirection(view, quota, now, settings))
}
