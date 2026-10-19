// Tool "plan" mà Claude gọi để giữ mục tiêu và checklist. Reducer ở đây
// thuần: nhận trạng thái cũ và đầu vào, trả trạng thái mới hoặc lỗi.
// Checklist chỉ do Claude đặt (không tự sinh từ heuristic), nên khi nó còn
// bước mở thì đó là cam kết thật của Claude, đủ tin cậy để chặn kết thúc.

import type { ToolSpec } from 'claude-code'

import type { PlanStep, StepStatus, Tier } from '../../types'
import { isPathLike } from './router'
import { PLAN_TOOL } from './text'
import { TIERS } from './scale'

const STATUSES: readonly StepStatus[] = ['todo', 'doing', 'done', 'verified', 'skipped', 'blocked', 'waiting']

export const PLAN_TOOL_SPEC: ToolSpec = {
  name: PLAN_TOOL,
  isDeferred: false,
  description:
    'Ghi và cập nhật mục tiêu cuối cùng cùng checklist các bước của task hiện tại (chỉ luồng chính). ' +
    'action "set": đặt goal (tùy chọn) và steps (thay toàn bộ checklist; steps rỗng là xóa checklist, không truyền steps là giữ checklist; ' +
    'mỗi bước có thể kèm tier để ghi độ phức tạp và check là tiêu chí nghiệm thu của bước). ' +
    '"set" có thể kèm scope (đường dẫn được phép sửa; mảng rỗng là bỏ giới hạn). ' +
    'action "update": đổi status của một bước (step), của nhiều bước (ids) hoặc của mọi bước đang mở (allOpen true), đúng một trong ba; ' +
    'ids và allOpen chỉ nhận waiting, blocked, skipped (kèm một note chung) và todo (chỉ ids), để dừng hay đặt lại cả checklist bằng một lần gọi. ' +
    '"verified" bắt buộc có evidence (lệnh đã chạy, kết quả); mod tự nâng bước done thành verified khi lệnh test chạy đạt sau thay đổi cuối, ' +
    '"skipped", "blocked" và "waiting" bắt buộc có note giải thích. "waiting" là đang chờ việc bên ngoài rồi sẽ tiếp tục (lệnh nền, CI, người dùng); ' +
    '"blocked" là không tiến hành được và không có việc nào đang chạy để chờ. action "add": thêm bước vào cuối. ' +
    'action "restore": khôi phục mục tiêu cũ còn bước mở đã được lưu khi chuyển mục tiêu (index 1 là gần nhất). ' +
    'Kết quả của "update" và "add" chỉ liệt kê các bước vừa đổi; action "show" xem lại toàn bộ checklist, không đổi gì. ' +
    'action "checkpoint": chỉ khi mod tạm dừng, note ghi bước kế tiếp. ' +
    'Gọi "set" trước khi thực thi việc từ mức moderate trở lên, và "update" sau mỗi bước quan trọng.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['set', 'update', 'add', 'restore', 'show', 'checkpoint'] },
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
      ids: { type: 'array', items: { type: 'integer' }, description: 'id của nhiều bước cần cập nhật cùng một status (update hàng loạt).' },
      allOpen: { type: 'boolean', description: 'true: cập nhật mọi bước todo hoặc doing cùng một status (update hàng loạt).' },
      status: { type: 'string', enum: [...STATUSES] },
      evidence: { type: 'string', description: 'Bằng chứng kiểm tra, bắt buộc khi status là verified.' },
      note: { type: 'string', description: 'Lý do, bắt buộc khi status là skipped, blocked hoặc waiting.' },
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
  ids?: unknown
  allOpen?: unknown
  status?: unknown
  evidence?: unknown
  note?: unknown
  scope?: unknown
  index?: unknown
}

/** `changed`: id các bước đã đổi (update) hoặc vừa thêm (add); `bulk` có mặt khi update hàng loạt (ids, allOpen). */
export type PlanOutcome =
  | { plan: PlanStep[]; goal?: string; scope?: string[]; changed?: number[]; bulk?: { status: StepStatus; note: string }; checkpointNote?: string; error?: undefined }
  | { error: string; plan?: undefined; goal?: undefined; changed?: undefined; bulk?: undefined }

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

const BULK_STATUSES: readonly StepStatus[] = ['waiting', 'blocked', 'skipped', 'todo']
const IS_CLOSED: readonly StepStatus[] = ['done', 'verified', 'skipped']

/**
 * Update hàng loạt (0.5.6): ids hoặc allOpen cùng một status và một note. Tất cả hoặc không gì; không bao giờ đụng bước đã đóng.
 * doing, done, verified bị từ chối vì mỗi bước cần cam kết riêng; todo chỉ với ids và xóa note cũ khi không kèm note mới.
 */
function bulkUpdate(current: readonly PlanStep[], input: PlanInput, status: StepStatus): PlanOutcome {
  const isAll = input.allOpen === true
  if (!BULK_STATUSES.includes(status)) {
    return { error: `Cập nhật hàng loạt chỉ nhận waiting, blocked, skipped hoặc todo; ${status} cần cập nhật từng bước bằng step (mỗi bước cam kết riêng).` }
  }
  if (isAll && status === 'todo') return { error: 'allOpen không nhận todo (các bước mở đã là todo hoặc doing); dùng ids để đặt bước waiting hay blocked về todo.' }
  const note = text(input.note)
  if (status !== 'todo' && !note) return { error: `Trạng thái ${status} cần note giải thích lý do.` }
  let ids: number[]
  if (isAll) {
    ids = current.filter(s => s.status === 'todo' || s.status === 'doing').map(s => s.id)
    if (ids.length === 0) return { error: 'Không có bước mở nào để cập nhật hàng loạt.' }
  } else {
    if (!Array.isArray(input.ids) || input.ids.length === 0 || input.ids.some(v => typeof v !== 'number' || !Number.isInteger(v))) {
      return { error: 'ids phải là mảng số nguyên không rỗng (id của các bước cần cập nhật).' }
    }
    ids = [...new Set(input.ids as number[])].sort((a, b) => a - b)
    const unknown = ids.filter(id => !current.some(s => s.id === id))
    const closed = ids.filter(id => IS_CLOSED.includes(current.find(s => s.id === id)?.status as StepStatus))
    if (unknown.length > 0 || closed.length > 0) {
      const parts = [
        unknown.length > 0 ? `không có bước id ${unknown.join(', ')}` : '',
        closed.length > 0 ? `bước id ${closed.join(', ')} đã đóng (done, verified hoặc skipped)` : '',
      ].filter(Boolean)
      return { error: `Không đổi bước nào: ${parts.join('; ')}. Các id hiện có: ${current.map(s => s.id).join(', ')}.` }
    }
  }
  const detail = note.slice(0, 200)
  const set = new Set(ids)
  const plan = current.map(s => {
    if (!set.has(s.id)) return s
    const { note: _old, auto: _auto, ...rest } = s
    return { ...rest, status, ...(detail ? { note: detail } : {}) }
  })
  return { plan, changed: ids, bulk: { status, note: detail } }
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
    return { plan: [...current, ...steps], changed: steps.map(step => step.id) }
  }

  if (action === 'update') {
    const chosen = [input.step !== undefined, input.ids !== undefined, input.allOpen === true]
    if (chosen.filter(Boolean).length > 1) return { error: 'action "update" chỉ nhận một trong step, ids hoặc allOpen.' }
    if (!chosen.some(Boolean)) return { error: 'action "update" cần đúng một trong step, ids hoặc allOpen.' }
    const status = STATUSES.find(s => s === input.status)
    if (input.step === undefined && !status) return { error: `status phải là một trong: ${STATUSES.join(', ')}.` }
    if (input.step === undefined) return bulkUpdate(current, input, status as StepStatus)
    const id = typeof input.step === 'number' ? input.step : Number.NaN
    const target = current.find(s => s.id === id)
    if (!target) return { error: `Không có bước id ${String(input.step)}. Các id hiện có: ${current.map(s => s.id).join(', ') || 'không có'}.` }
    if (!status) return { error: `status phải là một trong: ${STATUSES.join(', ')}.` }
    const evidence = text(input.evidence)
    const note = text(input.note)
    if (status === 'verified' && !evidence) {
      return { error: 'Đánh dấu verified cần evidence: lệnh kiểm tra đã chạy và kết quả. Nếu chưa kiểm tra, dùng done.' }
    }
    if ((status === 'skipped' || status === 'blocked' || status === 'waiting') && !note) {
      return { error: `Trạng thái ${status} cần note giải thích lý do.` }
    }
    const detail = (evidence || note).slice(0, 200)
    return {
      plan: current.map(s => {
        if (s.id !== id) return s
        const { auto: _auto, ...rest } = s
        return { ...rest, status, ...(detail ? { note: detail } : {}) }
      }),
      changed: [id],
    }
  }

  if (action === 'checkpoint') {
    // Điểm dừng do bảo vệ hạn mức (0.6.0): chỉ ghi note, không đổi checklist. Hook kiểm mod có đang tạm dừng không.
    const note = text(input.note)
    if (!note) return { error: 'action "checkpoint" cần note: bước kế tiếp cụ thể, việc đã xong không làm lại, điều cần kiểm khi quay lại.' }
    return { plan: [...current], checkpointNote: note.slice(0, 600) }
  }

  return { error: 'action phải là "set", "update", "add", "restore", "show" hoặc "checkpoint".' }
}
