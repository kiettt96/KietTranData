// Tool "plan" mà Claude gọi để giữ mục tiêu và checklist. Reducer ở đây
// thuần: nhận trạng thái cũ và đầu vào, trả trạng thái mới hoặc lỗi.
// Checklist chỉ do Claude đặt (không tự sinh từ heuristic), nên khi nó còn
// bước mở thì đó là cam kết thật của Claude, đủ tin cậy để chặn kết thúc.

import type { ToolSpec } from 'claude-code'

import type { PlanStep, StepStatus, Tier } from '../../types'
import { isPathLike } from './router'
import { PLAN_TOOL } from './text'
import { TIERS } from './scale'

const STATUSES: readonly StepStatus[] = ['todo', 'doing', 'done', 'verified', 'skipped', 'blocked']

export const PLAN_TOOL_SPEC: ToolSpec = {
  name: PLAN_TOOL,
  isDeferred: false,
  description:
    'Ghi và cập nhật mục tiêu cuối cùng cùng checklist các bước của task hiện tại (chỉ luồng chính). ' +
    'action "set": đặt goal (tùy chọn) và steps (thay toàn bộ checklist; steps rỗng là xóa checklist, không truyền steps là giữ checklist; ' +
    'mỗi bước có thể kèm tier để ghi độ phức tạp và check là tiêu chí nghiệm thu của bước). ' +
    '"set" có thể kèm scope (đường dẫn được phép sửa; mảng rỗng là bỏ giới hạn). ' +
    'action "update": đổi status của một bước theo id; "verified" bắt buộc có evidence (lệnh đã chạy, kết quả), ' +
    '"skipped" và "blocked" bắt buộc có note giải thích. action "add": thêm bước vào cuối. ' +
    'action "restore": khôi phục mục tiêu cũ còn bước mở đã được lưu khi chuyển mục tiêu (index 1 là gần nhất). ' +
    'Gọi "set" trước khi thực thi việc từ mức moderate trở lên, và "update" sau mỗi bước quan trọng.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['set', 'update', 'add', 'restore'] },
      goal: { type: 'string', description: 'Mục tiêu cuối cùng, một câu.' },
      steps: {
        type: 'array',
        description: 'Danh sách bước theo thứ tự (set, add).',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            tier: { type: 'string', enum: [...TIERS] },
            check: { type: 'string', description: 'Tiêu chí nghiệm thu của bước (tùy chọn): điều phải đúng để coi bước là đạt.' },
          },
          required: ['title'],
        },
      },
      step: { type: 'integer', description: 'id của bước cần cập nhật (update).' },
      status: { type: 'string', enum: [...STATUSES] },
      evidence: { type: 'string', description: 'Bằng chứng kiểm tra, bắt buộc khi status là verified.' },
      note: { type: 'string', description: 'Lý do, bắt buộc khi status là skipped hoặc blocked.' },
      scope: { type: 'array', items: { type: 'string' }, description: 'Đường dẫn được phép sửa (set); mảng rỗng là bỏ giới hạn.' },
      index: { type: 'integer', description: 'Mục tiêu đã lưu cần khôi phục (restore), 1 là gần nhất.' },
    },
    required: ['action'],
  },
}

export type PlanInput = {
  action?: unknown
  goal?: unknown
  steps?: unknown
  step?: unknown
  status?: unknown
  evidence?: unknown
  note?: unknown
  scope?: unknown
  index?: unknown
}

export type PlanOutcome =
  | { plan: PlanStep[]; goal?: string; scope?: string[]; error?: undefined }
  | { error: string; plan?: undefined; goal?: undefined }

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseSteps(value: unknown, startId: number): PlanStep[] {
  if (!Array.isArray(value)) return []
  const out: PlanStep[] = []
  for (const raw of value) {
    const item = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
    const title = typeof raw === 'string' ? raw.trim() : text(item['title'])
    if (!title) continue
    const tier = TIERS.find(t => t === item['tier']) as Tier | undefined
    const check = text(item['check']).slice(0, 200)
    out.push({ id: startId + out.length, title: title.slice(0, 160), status: 'todo', ...(tier ? { tier } : {}), ...(check ? { check } : {}) })
    if (out.length >= 20) break
  }
  return out
}

/** Phạm vi Claude ghi: danh sách đường dẫn; null khi có mục không phải đường dẫn. */
function scopeOf(items: readonly unknown[]): string[] | null {
  const paths = items.map(text).filter(Boolean)
  if (paths.some(path => !isPathLike(path))) return null
  return [...new Set(paths)].slice(0, 10)
}

export function applyPlan(current: readonly PlanStep[], input: PlanInput): PlanOutcome {
  const action = text(input.action)

  if (action === 'set') {
    const steps = parseSteps(input.steps, 1)
    const goal = text(input.goal)
    // steps: [] là thay bằng checklist rỗng (xóa); không truyền steps là giữ checklist và chỉ đổi goal hay scope.
    const hasSteps = Array.isArray(input.steps)
    const isClear = hasSteps && (input.steps as unknown[]).length === 0
    if (hasSteps && !isClear && steps.length === 0) return { error: 'action "set": steps không có bước hợp lệ nào (mỗi bước cần title).' }
    if (!hasSteps && !goal) return { error: 'action "set" cần goal hoặc steps (steps rỗng là xóa checklist).' }
    const scope = Array.isArray(input.scope) ? scopeOf(input.scope) : undefined
    if (scope === null) return { error: 'scope chỉ nhận đường dẫn file hoặc thư mục (có / hoặc phần mở rộng, không khoảng trắng).' }
    return { plan: hasSteps ? steps : [...current], ...(goal ? { goal } : {}), ...(scope !== undefined ? { scope } : {}) }
  }

  if (action === 'add') {
    const nextId = current.reduce((max, s) => Math.max(max, s.id), 0) + 1
    const steps = parseSteps(input.steps, nextId)
    if (steps.length === 0) return { error: 'action "add" cần ít nhất một bước trong steps.' }
    return { plan: [...current, ...steps] }
  }

  if (action === 'update') {
    const id = typeof input.step === 'number' ? input.step : Number.NaN
    const target = current.find(s => s.id === id)
    if (!target) return { error: `Không có bước id ${String(input.step)}. Các id hiện có: ${current.map(s => s.id).join(', ') || 'không có'}.` }
    const status = STATUSES.find(s => s === input.status)
    if (!status) return { error: `status phải là một trong: ${STATUSES.join(', ')}.` }
    const evidence = text(input.evidence)
    const note = text(input.note)
    if (status === 'verified' && !evidence) {
      return { error: 'Đánh dấu verified cần evidence: lệnh kiểm tra đã chạy và kết quả. Nếu chưa kiểm tra, dùng done.' }
    }
    if ((status === 'skipped' || status === 'blocked') && !note) {
      return { error: `Trạng thái ${status} cần note giải thích lý do.` }
    }
    const detail = (evidence || note).slice(0, 200)
    return {
      plan: current.map(s => (s.id === id ? { ...s, status, ...(detail ? { note: detail } : {}) } : s)),
    }
  }

  return { error: 'action phải là "set", "update", "add" hoặc "restore".' }
}
