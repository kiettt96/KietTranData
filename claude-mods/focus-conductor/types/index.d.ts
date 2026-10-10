// Hợp đồng kiểu của focus-conductor: mọi giá trị mod giữ trong $.state.
// Module hooks import các kiểu này từ '../types' (hoặc '../../types').

/** Mức độ phức tạp cũ (một trục), giữ lại để tính ngân sách tool call và hiển thị. */
export type Tier = 'trivial' | 'simple' | 'moderate' | 'complex' | 'deep'

/** Độ sâu suy luận cần thiết: quyết định model. */
export type Depth = 'none' | 'light' | 'substantial' | 'hard'

/** Khối lượng việc: quyết định effort (và ước lượng chi phí). */
export type Volume = 'small' | 'medium' | 'large'

/** Bản chất việc: trả lời, sửa code, điều tra (chỉ đọc) hay kết hợp. */
export type Kind = 'answer' | 'edit' | 'investigate' | 'mixed'

/** Quan hệ của prompt mới với mục tiêu đang mở. */
export type Relation = 'new' | 'continue' | 'refine' | 'dissatisfied'

/** Mức effort mà các model hiện tại nhận. */
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** Họ model, độc lập với model ID cụ thể của từng nhà cung cấp. */
export type ModelFamily = 'haiku' | 'sonnet' | 'opus' | 'fable'

/** Chế độ điều phối đang có hiệu lực. */
export type Mode = 'auto' | 'subagents' | 'suggest' | 'off'

/** Một lựa chọn model và effort. */
export type Choice = { family: ModelFamily; effort: Effort }

/**
 * Một việc người dùng giao trong prompt, do router tách và điều phối: làm ở luồng chính
 * hay giao subagent, với loại agent, model và effort nào.
 */
export type Task = {
  /** Thứ tự trong prompt, từ 1; việc thêm ở prompt tiếp nối được đánh số tiếp theo. */
  index: number
  title: string
  run: 'main' | 'agent'
  /** Loại agent khi giao subagent (Explore, Plan, general-purpose). */
  agentType?: string
  pick: Choice
  depth: Depth
  volume: Volume
  kind: Kind
  /** Lý do của router, kèm lý do kẹp theo chính sách nếu có. */
  why: string
}

/** Kết quả router đọc prompt: mục tiêu cuối, việc, ràng buộc, tiêu chí, và điều phối. */
export type Brief = {
  /** Tăng mỗi khi có mục tiêu mới; dùng để nhận ra đổi task. */
  goalId: number
  goal: string
  /** Bước dự kiến: tên các việc lúc đầu, sau đó theo checklist Claude chốt. */
  steps: string[]
  tasks: Task[]
  constraints: string[]
  quality: string[]
  depth: Depth
  volume: Volume
  kind: Kind
  /** Suy ra từ depth và volume, giữ cho ngân sách tool call và nhãn cũ. */
  tier: Tier
  /** Model và effort router chọn cho luồng chính; null khi router không đọc được prompt (mod không ép). */
  main: Choice | null
  /** Luồng chính mà prompt đính kèm cần nếu chạy thật (chỉ khi isReference). */
  referenceMain?: Choice
  /** Lý do router đưa ra. */
  why: string
  relation: Relation
  /** router: do router đọc; none: router không đọc được (hoặc dữ liệu từ bản cũ). */
  source: 'router' | 'none'
  isFollowUp: boolean
  /** Prompt đính kèm chỉ để đối chiếu: các việc chỉ để hiển thị, không thực thi, không giao. */
  isReference: boolean
  /** Đường dẫn người dùng giới hạn việc sửa; rỗng là không giới hạn. */
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
  /** Id của agent (chỉ với subagent), để gắn chi phí đo được vào đúng dòng. */
  agentId?: string
  /** Chi phí USD: ước tính lúc giao việc, đo được khi turn kết thúc (measured). */
  usd?: number
  measured?: boolean
  reason: string
  /** false khi chỉ là đề xuất hoặc bị giữ lại để bảo toàn cache. */
  isApplied: boolean
}

export type WarningKind = 'loop' | 'budget' | 'scope' | 'unverified' | 'open-steps' | 'model' | 'cost'

/** Cảnh báo nhất quán (lạc đề, lặp, vượt phạm vi, chưa kiểm tra, chi phí). */
export type Warning = {
  at: number
  kind: WarningKind
  text: string
}

/** Nhóm chi phí: luồng chính, subagent, hoặc lượt router đọc prompt và chấm subagent (khóa cũ 'analyzer'). */
export type Group = 'main' | 'agent' | 'analyzer'

/** Tổng token và USD của một nhóm. */
export type Bucket = {
  calls: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  usd: number
}

/** Sổ chi phí: theo phiên và theo mục tiêu hiện tại, cùng hệ số hiệu chỉnh ước lượng. */
export type Ledger = {
  session: Record<Group, Bucket>
  goal: {
    goalId: number
    buckets: Record<Group, Bucket>
    /** Số subagent đã giao trong mục tiêu này (để cảnh báo fan-out). */
    spawned: number
    fanoutWarned: boolean
  }
  /** Hệ số ước lượng theo họ model, học từ số đo; 1 nghĩa là chưa hiệu chỉnh. */
  calib: Record<ModelFamily, number>
  /** Số lần đo đã dùng để hiệu chỉnh. */
  samples: number
}

/**
 * Mục tiêu cũ còn bước mở, lưu lại khi chuyển sang mục tiêu mới, để router xếp nhầm "mục tiêu mới"
 * không làm mất tiến độ: Claude khôi phục bằng plan action "restore".
 */
export type ArchivedGoal = { brief: Brief; plan: PlanStep[] }

/** Nâng cấp theo bằng chứng, áp cho các turn sau trong cùng mục tiêu. */
export type Lift = { depth: number; effort: number }

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
  ledger: Ledger
  lift: Lift
  /** Thời điểm kết thúc turn luồng chính gần nhất (ms, $.clock.now()); 0 khi chưa có. */
  lastTurnAt: number
  /** Số token ngữ cảnh lúc bắt đầu turn gần nhất; dùng để nhận ra compaction. */
  lastContext: number
  /** Phần cố định của ngữ cảnh (system prompt, tools, bộ nhớ) đo được ở đầu phiên; 0 khi chưa đo. */
  sysTokens: number
  /** Mục tiêu cũ còn bước mở, mới nhất trước (tối đa 3). */
  archived: ArchivedGoal[]
}

declare module 'claude-code' {
  interface PluginState {
    'focus-conductor': {
      core: Core
      isBandHidden: boolean
      /** Ghi đè chế độ lúc chạy qua /conductor mode; null nghĩa là theo cấu hình. */
      mode: Mode | null
    }
  }
}
