// Hợp đồng kiểu của focus-conductor: mọi giá trị mod giữ trong $.state.
// Module hooks import các kiểu này từ '../types' (hoặc '../../types').

/** Mức độ phức tạp của một yêu cầu hoặc một bước. */
export type Tier = 'trivial' | 'simple' | 'moderate' | 'complex' | 'deep'

/** Mức effort mà các model hiện tại nhận. */
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** Họ model, độc lập với model ID cụ thể của từng nhà cung cấp. */
export type ModelFamily = 'haiku' | 'sonnet' | 'opus' | 'fable'

/** Chế độ điều phối đang có hiệu lực. */
export type Mode = 'auto' | 'subagents' | 'suggest' | 'off'

/** Kết quả đọc prompt: mục tiêu cuối, các bước, ràng buộc, tiêu chí chất lượng. */
export type Brief = {
  /** Tăng mỗi khi có mục tiêu mới; dùng để nhận ra đổi task. */
  goalId: number
  goal: string
  steps: string[]
  constraints: string[]
  quality: string[]
  tier: Tier
  /** Điểm phức tạp 0..100. */
  score: number
  /** Các tín hiệu dẫn tới điểm số, để người dùng thấy vì sao. */
  signals: string[]
  source: 'heuristic' | 'model'
  isFollowUp: boolean
  /** Từ khóa trọng tâm, dùng để nhắc lại mục tiêu khi có dấu hiệu lạc đề. */
  keywords: string[]
  /** Đường dẫn được nhắc trong prompt: phạm vi được phép sửa nếu khác rỗng. */
  scopePaths: string[]
  /** Prompt gốc (cắt ngắn) để đối chiếu. */
  prompt: string
  at: number
}

export type StepStatus = 'todo' | 'doing' | 'done' | 'verified' | 'skipped' | 'blocked'

/** Một mục trong checklist mà Claude duy trì qua tool plan. */
export type PlanStep = {
  id: number
  title: string
  status: StepStatus
  tier?: Tier
  /** Bằng chứng kiểm tra (bắt buộc khi verified) hoặc lý do (skipped, blocked). */
  note?: string
}

/** Lựa chọn model và effort đang áp cho luồng chính. */
export type Route = {
  family: ModelFamily
  effort: Effort
  tier: Tier
  /** goalId mà route này phục vụ. */
  goalId: number
  reason: string
}

/** Một dòng nhật ký điều phối. */
export type RouteEvent = {
  at: number
  where: 'main' | 'agent'
  label: string
  family: ModelFamily
  effort?: Effort
  agentType?: string
  reason: string
  /** false khi chỉ là đề xuất hoặc bị giữ lại để bảo toàn cache. */
  isApplied: boolean
}

export type WarningKind = 'loop' | 'budget' | 'scope' | 'unverified' | 'open-steps' | 'model'

/** Cảnh báo nhất quán (lạc đề, lặp, vượt phạm vi, chưa kiểm tra). */
export type Warning = {
  at: number
  kind: WarningKind
  text: string
}

/**
 * Trạng thái mục tiêu của phiên, gộp một chỗ để mỗi thay đổi là một lần
 * update nguyên tử (reducer thuần) và mỗi lần vẽ chỉ cần một lần đọc.
 */
export type Core = {
  brief: Brief | null
  plan: PlanStep[]
  /** Route đã áp cho luồng chính ở turn gần nhất (vùng cache đang dùng). */
  route: Route | null
  warnings: Warning[]
  log: RouteEvent[]
}

declare module 'claude-code' {
  interface PluginState {
    'focus-conductor': {
      core: Core
      isBandHidden: boolean
      /** Ghi đè chế độ lúc chạy qua /focus mode; null nghĩa là theo cấu hình. */
      mode: Mode | null
    }
  }
}
