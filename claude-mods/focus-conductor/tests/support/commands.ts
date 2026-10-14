// Dựng tool call giả (Bash, Edit) và brief mẫu cho các test của hooks/lib/drift: đối chiếu evidence với dấu vết thực thi,
// theo dõi một turn sau khi sửa file rồi chạy lệnh. Một bộ hàm dùng chung cho mọi tệp test về lệnh, evidence và báo cáo.

import { expect } from 'claude-code/testing'

import type { Brief } from '../../types'
import { acceptsVerified, evidenceStrength, newEvidenceLog, newTracker, noteEvidence, observe } from '../../hooks/lib/drift'

/** Brief mẫu của một mục tiêu sửa code; `over` ghi đè từng trường. */
export function makeBrief(over: Partial<Brief> = {}): Brief {
  return {
    goalId: 1, goal: 'Sửa module thanh toán', steps: [], tasks: [], constraints: [], quality: [], depth: 'substantial', volume: 'medium',
    kind: 'edit', tier: 'complex', main: { family: 'opus', effort: 'high' }, why: '', relation: 'new', source: 'router', isFollowUp: false,
    isReference: false, scopePaths: [], prompt: '', at: 1, ...over,
  }
}

type Extra = { isError?: boolean; output?: string; isReadOnly?: boolean }

/**
 * Tool call Bash. Tham số thứ hai: `true` là lệnh lỗi; một chuỗi là output; hay một đối tượng `{ isError, output, isReadOnly }`.
 * Không nêu output thì tool call không có trường output.
 */
export function bash(command: string, extra: boolean | string | Extra = {}) {
  const e: Extra = typeof extra === 'boolean' ? { isError: extra } : typeof extra === 'string' ? { output: extra } : extra
  return {
    tool: 'Bash',
    input: { command },
    isError: e.isError ?? false,
    isReadOnly: e.isReadOnly ?? false,
    ...(e.output !== undefined ? { output: e.output } : {}),
  }
}

/** Tool call Edit lên một file. */
export const edit = (path = '/repo/src/a.ts') => ({ tool: 'Edit', input: { file_path: path }, isError: false, isReadOnly: false })

/** Một lần chạy: lệnh, hoặc [lệnh, tùy chọn]. Lệnh bắt đầu bằng `!` là lần chạy lỗi. */
export type Run = string | readonly [string, Extra?]

function callOf(run: Run) {
  if (typeof run !== 'string') return bash(run[0], run[1] ?? {})
  return run.startsWith('!') ? bash(run.slice(1), { isError: true }) : bash(run)
}

/** Sửa một file, chạy các lần chạy theo thứ tự, rồi đối chiếu evidence: mức, lý do và có được nhận verified không. */
export function strength(runs: readonly Run[], evidence: string) {
  const log = newEvidenceLog(1)
  noteEvidence(log, edit())
  for (const run of runs) noteEvidence(log, callOf(run))
  const result = evidenceStrength(evidence, log)
  return { ...result, accepted: acceptsVerified(result, log) }
}

/** verified có được nhận không: một lần chạy (chuỗi) hay nhiều lần chạy theo thứ tự. */
export const accepted = (runs: string | readonly Run[], evidence: string): boolean => strength(typeof runs === 'string' ? [runs] : runs, evidence).accepted

/** Ca âm: không nhận, mức stale, lý do trung tính nêu yêu cầu khớp chính xác. */
export function rejected(run: string, evidence: string) {
  const result = strength([run], evidence)
  expect(result.accepted, `${run} / ${evidence}`).toBe(false)
  expect(result.level, `${run} / ${evidence}`).toBe('stale')
  expect(result.reason ?? '', `${run} / ${evidence}`).toContain('khớp chính xác')
}

/** Như rejected, và lý do không khẳng định "chưa chạy" (so khớp nghiêm ngặt không biết lệnh có chạy hay không). */
export function rejectedNeutral(run: string, evidence: string) {
  rejected(run, evidence)
  expect(strength([run], evidence).reason ?? '', `${run} / ${evidence}`).not.toContain('chưa chạy')
}

/** Lặp các ca âm: mỗi ca là một lệnh expect độc lập. */
export function rejectAll(run: string, claims: string[], suffix: string) {
  for (const claim of claims) rejected(run, `${claim}${suffix}`)
}

/** Trạng thái đã kiểm tra sau: sửa một file, rồi chạy lệnh (mã thoát 0 trừ khi nói khác) có output cho trước. */
export function verifiedAfter(command: string, extra: string | { isError?: boolean; output?: string } = {}): boolean {
  const tracker = newTracker('t')
  const brief = makeBrief()
  observe(tracker, edit(), brief, [])
  observe(tracker, bash(command, extra), brief, [])
  return tracker.isVerified
}
