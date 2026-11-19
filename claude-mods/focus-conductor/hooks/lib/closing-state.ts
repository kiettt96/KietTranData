/**
 * Trạng thái cổng đóng nằm trong $.state (0.9.0 vòng 2 M6): kết luận của các lượt có vai, lần chạy và mốc check của từng bước, ghi chú ống
 * lệnh, số lần chặn và khóa trạng thái của cổng đóng, số vòng chưa đạt. Trước đó các phần này ở biến cục bộ của lần nạp mod nên mất khi mod
 * nạp lại. Bản ghi của bản cũ không có trường nào thì đọc ra giá trị mặc định; trần số phần tử như ở biến cục bộ.
 */

import type { ModelFamily, Role } from '../../types'
import type { StepRun } from './drift/stepcheck'
import { STEP_OUTPUT_CHARS, STEP_RUNS } from './drift/stepcheck'
import type { Verdict } from './verdict'
import { FAMILY_NAMES } from './families'

/** Một kết luận đã nhận (cùng dạng VerdictRun của hooks/context.ts). */
export type ClosingVerdictRun = {
  agentId: string
  role: Role
  verdict: Verdict | null
  isClean: boolean
  isReview: boolean
  count?: string
  seq: number
  family: ModelFamily
  taskIndex?: number
  description: string
  changed?: string[]
  unclear?: true
  unread?: true
}

export type ClosingSnapshot = {
  verdicts: { goalId: number; items: ClosingVerdictRun[] }
  stepRuns: { goalId: number; runs: StepRun[]; checkSeq: Array<[number, number]> }
  pipeNotes: { goalId: number; n: number; last: null | { seq: number; command: string } }
  closingState: { goalId: number; blocks: number; key: string }
  rounds: Array<[string, number]>
}

/** Trần số phần tử, cùng trần của biến cục bộ. */
export const CLOSING_VERDICTS = 100
export const CLOSING_ROUNDS = 200
export const CLOSING_CHECK_SEQ = 200

export const EMPTY_CLOSING: ClosingSnapshot = {
  verdicts: { goalId: -1, items: [] },
  stepRuns: { goalId: -1, runs: [], checkSeq: [] },
  pipeNotes: { goalId: -1, n: 0, last: null },
  closingState: { goalId: -1, blocks: 0, key: '' },
  rounds: [],
}

const ROLES: readonly string[] = ['design', 'review', 'build', 'search', 'audit']
const VERDICTS: readonly string[] = ['pass', 'fail', 'ready', 'not-ready']
const FAMILIES: readonly string[] = FAMILY_NAMES
const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)
const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d)

function verdictOfRaw(raw: unknown): ClosingVerdictRun | null {
  if (!isObj(raw) || typeof raw['agentId'] !== 'string' || typeof raw['description'] !== 'string' || !ROLES.includes(raw['role'] as string)) return null
  const verdict = raw['verdict'] === null || VERDICTS.includes(raw['verdict'] as string) ? (raw['verdict'] as Verdict | null) : null
  const family = FAMILIES.includes(raw['family'] as string) ? (raw['family'] as ModelFamily) : 'sonnet'
  return {
    agentId: raw['agentId'],
    role: raw['role'] as Role,
    verdict,
    isClean: raw['isClean'] === true,
    isReview: raw['isReview'] === true,
    ...(typeof raw['count'] === 'string' ? { count: raw['count'] } : {}),
    seq: num(raw['seq'], -1),
    family,
    ...(typeof raw['taskIndex'] === 'number' ? { taskIndex: raw['taskIndex'] } : {}),
    description: raw['description'],
    ...(Array.isArray(raw['changed']) ? { changed: (raw['changed'] as unknown[]).filter((p): p is string => typeof p === 'string').slice(0, 20) } : {}),
    ...(raw['unclear'] === true ? { unclear: true as const } : {}),
    ...(raw['unread'] === true ? { unread: true as const } : {}),
  }
}

function runOfRaw(raw: unknown): StepRun | null {
  if (!isObj(raw) || !Array.isArray(raw['keys'])) return null
  return { keys: (raw['keys'] as unknown[]).filter((k): k is string => typeof k === 'string'), output: typeof raw['output'] === 'string' ? raw['output'].slice(0, STEP_OUTPUT_CHARS) : '', passed: raw['passed'] === true, seq: num(raw['seq'], -1) }
}

/** Đọc bản ghi đã lưu; sai dạng hay thiếu trường thì giá trị mặc định của trường đó. */
export function normalizeClosing(raw: unknown): ClosingSnapshot {
  if (!isObj(raw)) return { ...EMPTY_CLOSING }
  const v = isObj(raw['verdicts']) ? raw['verdicts'] : {}
  const s = isObj(raw['stepRuns']) ? raw['stepRuns'] : {}
  const p = isObj(raw['pipeNotes']) ? raw['pipeNotes'] : {}
  const c = isObj(raw['closingState']) ? raw['closingState'] : {}
  const last = isObj(p['last']) && typeof p['last']['command'] === 'string' ? { seq: num(p['last']['seq'], -1), command: p['last']['command'] } : null
  return {
    verdicts: { goalId: num(v['goalId'], -1), items: (Array.isArray(v['items']) ? v['items'] : []).map(verdictOfRaw).filter((x): x is ClosingVerdictRun => x !== null).slice(-CLOSING_VERDICTS) },
    stepRuns: {
      goalId: num(s['goalId'], -1),
      runs: (Array.isArray(s['runs']) ? s['runs'] : []).map(runOfRaw).filter((x): x is StepRun => x !== null).slice(-STEP_RUNS),
      checkSeq: (Array.isArray(s['checkSeq']) ? s['checkSeq'] : []).filter((e): e is [number, number] => Array.isArray(e) && typeof e[0] === 'number' && typeof e[1] === 'number').slice(-CLOSING_CHECK_SEQ),
    },
    pipeNotes: { goalId: num(p['goalId'], -1), n: num(p['n'], 0), last },
    closingState: { goalId: num(c['goalId'], -1), blocks: num(c['blocks'], 0), key: typeof c['key'] === 'string' ? c['key'] : '' },
    rounds: (Array.isArray(raw['rounds']) ? raw['rounds'] : []).filter((e): e is [string, number] => Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'number').slice(-CLOSING_ROUNDS),
  }
}

/** Phần trạng thái cổng đóng của biến cục bộ mà bản ghi lưu và khôi phục. */
export type ClosingLocal = {
  verdicts: { goalId: number; items: ClosingVerdictRun[] }
  stepRuns: { goalId: number; runs: StepRun[]; checkSeq: Map<number, number> }
  pipeNotes: { goalId: number; n: number; last: null | { seq: number; command: string } }
  closingState: { goalId: number; blocks: number; key: string }
  verdictRounds: Map<string, number>
}

export function closingSnapshot(local: ClosingLocal): ClosingSnapshot {
  return {
    verdicts: { goalId: local.verdicts.goalId, items: local.verdicts.items.slice(-CLOSING_VERDICTS) },
    stepRuns: { goalId: local.stepRuns.goalId, runs: local.stepRuns.runs.slice(-STEP_RUNS), checkSeq: [...local.stepRuns.checkSeq].slice(-CLOSING_CHECK_SEQ) },
    pipeNotes: { goalId: local.pipeNotes.goalId, n: local.pipeNotes.n, last: local.pipeNotes.last },
    closingState: { ...local.closingState },
    rounds: [...local.verdictRounds].slice(-CLOSING_ROUNDS),
  }
}

export function restoreClosing(local: ClosingLocal, snap: ClosingSnapshot): void {
  local.verdicts = { goalId: snap.verdicts.goalId, items: snap.verdicts.items.slice() }
  local.stepRuns = { goalId: snap.stepRuns.goalId, runs: snap.stepRuns.runs.slice(), checkSeq: new Map(snap.stepRuns.checkSeq) }
  local.pipeNotes = { goalId: snap.pipeNotes.goalId, n: snap.pipeNotes.n, last: snap.pipeNotes.last }
  local.closingState = { ...snap.closingState }
  local.verdictRounds = new Map(snap.rounds)
}
