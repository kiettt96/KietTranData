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
  /** Số thứ tự (từ 1) các yêu cầu của prompt (Brief.requirements) mà việc này phủ; vắng khi router không ghi (0.7.0). */
  covers?: number[]
}

/** Kết quả router đọc prompt: mục tiêu cuối, việc, ràng buộc, tiêu chí, và điều phối. */
export type Brief = {
  /** Tăng mỗi khi có mục tiêu mới; dùng để nhận ra đổi task. */
  goalId: number
  goal: string
  /** Mọi yêu cầu, ràng buộc và đầu ra router đọc được từ prompt (tối đa 30); vắng với brief từ bản cũ (0.7.0). */
  requirements?: string[]
  /** Số yêu cầu đầu danh sách đến từ prompt lập mục tiêu (0.7.5): không bao giờ bị thay khi đầy trần; vắng thì coi mọi yêu cầu hiện có là của prompt đó. */
  requirementsBase?: number
  /** Bước dự kiến: tên các việc lúc đầu, sau đó theo checklist Claude chốt. */
  steps: string[]
  tasks: Task[]
  constraints: string[]
  /** Số ràng buộc đầu danh sách đến từ prompt lập mục tiêu (0.7.5), như requirementsBase. */
  constraintsBase?: number
  quality: string[]
  depth: Depth
  volume: Volume
  kind: Kind
  /** Suy ra từ depth và volume, giữ cho ngân sách tool call và nhãn cũ. */
  tier: Tier
  /** Model và effort router chọn cho luồng chính; null khi router không đọc được prompt (mod không ép). */
  main: Choice | null
  /** Main của prompt lập mục tiêu (0.7.5, vòng sửa 2): sàn cho prompt tiếp nối; vắng ở brief cũ thì dùng `main`. */
  mainBase?: Choice
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
  /** Mục tiêu tối thiểu mod lập khi router lỗi ở prompt đầu (0.7.2): câu mục tiêu và tier chỉ là đoán, router đọc được lần sau thì nâng cấp. */
  isBare?: boolean
  /** Đường dẫn người dùng giới hạn việc sửa; rỗng là không giới hạn. */
  scopePaths: string[]
  /** Prompt gốc (cắt ngắn) để đối chiếu. */
  prompt: string
  at: number
}

/** `waiting`: bước đang chờ một việc bên ngoài rồi sẽ tiếp tục (lệnh nền, CI, người dùng); khác `blocked`: không tiến hành được và không có việc nào đang chạy để chờ. */
export type StepStatus = 'todo' | 'doing' | 'done' | 'verified' | 'skipped' | 'blocked' | 'waiting'

/** Một mục trong checklist mà Claude duy trì qua tool plan. */
export type PlanStep = {
  id: number
  title: string
  status: StepStatus
  tier?: Tier
  /** Tiêu chí nghiệm thu của bước (tùy chọn), Claude ghi khi lập checklist. */
  check?: string
  /** Bằng chứng kiểm tra (bắt buộc khi verified) hoặc lý do (skipped, blocked, waiting). */
  note?: string
  /** Bước verified do mod tự nâng (lệnh test chạy đạt sau thay đổi cuối): có thay đổi mới thì hạ về done (0.7.0). */
  auto?: boolean
  /** Mốc đóng (0.7.5, nội bộ, không có trong schema tool plan): giá trị của Core.closing.seq lúc bước thành done hay bị hạ về done. */
  closedSeq?: number
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

export type WarningKind = 'loop' | 'budget' | 'scope' | 'scope-unknown' | 'unverified' | 'open-steps' | 'model' | 'cost' | 'drift'

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

/**
 * So với chạy thuần (không điều phối): cùng số token đo được, tính theo giá của model phiên. Phần ghi lại cache do mod đổi
 * model hay effort giữa hai turn (mà chạy thuần đã đọc được) tính theo giá đọc; cache đã nguội hay vừa nén thì không bù.
 * Lợi ích ròng = pure − (covered + chi phí router).
 */
export type Baseline = {
  /** Turn luồng chính đã tính phần chuyển đổi gần nhất (tính một lần mỗi turn, kể cả khi mod nạp lại giữa turn). */
  turn: string
  /** Model và effort của phiên ở turn luồng chính gần nhất (lựa chọn của người dùng); family null khi chưa biết. */
  family: ModelFamily | null
  effort: string
  /** Model và effort mod phục vụ ở turn luồng chính gần nhất; null trước turn đầu. */
  served: { family: ModelFamily; effort: string } | null
  /** Token ghi cache của turn luồng chính đang chạy mà chạy thuần đọc được; dùng một lần khi turn kết thúc. */
  rewrite: number
  /** USD nếu các lượt đã vào sổ chạy thuần theo model của phiên. */
  pure: { session: number; goal: number }
  /** USD thật của đúng các lượt đó (luồng chính và subagent), không gồm router. */
  covered: { session: number; goal: number }
}

/** Sổ chi phí: theo phiên và theo mục tiêu hiện tại, cùng hệ số hiệu chỉnh ước lượng. */
export type Ledger = {
  session: Record<Group, Bucket>
  goal: {
    goalId: number
    buckets: Record<Group, Bucket>
    /** Số subagent đã giao (chạy thật ở luồng chính) trong mục tiêu này. */
    spawned: number
    /** Trong số đó, lời gọi không khớp việc đã phân (0.7.5): cảnh báo fan-out đếm theo số này; vắng ở trạng thái cũ. */
    unplanned?: number
    fanoutWarned: boolean
  }
  /** Hệ số ước lượng theo họ model, học từ số đo; 1 nghĩa là chưa hiệu chỉnh. */
  calib: Record<ModelFamily, number>
  /** Số lần đo đã dùng để hiệu chỉnh. */
  samples: number
  /**
   * Token ra đo được theo dạng việc ("depth/volume/kind"), quy về effort medium: trung bình và số lần đo.
   * Dùng để ước lượng chi phí lúc giao việc khi đã đủ số đo (không có ở trạng thái từ bản cũ).
   */
  shapes?: Record<string, { samples: number; output: number }>
  /** Cơ sở so với chạy thuần; không có ở trạng thái từ bản cũ hoặc khi chưa biết model của phiên. */
  baseline?: Baseline
}

/**
 * Mục tiêu cũ còn bước mở, lưu lại khi chuyển sang mục tiêu mới, để router xếp nhầm "mục tiêu mới"
 * không làm mất tiến độ: Claude khôi phục bằng plan action "restore".
 */
export type ArchivedGoal = { brief: Brief; plan: PlanStep[] }

/** Trạng thái một việc router ghi giao subagent: chờ giao, đang chạy, xong, hoặc lỗi. */
export type DelegationState = 'pending' | 'running' | 'done' | 'failed'

/** Một việc giao subagent của mục tiêu hiện tại, để pane và /conductor status hiện trạng thái. */
export type DelegationItem = { index: number; title: string; state: DelegationState }

/**
 * Một bước của danh sách việc Claude Code tự ghi (TodoWrite, TaskCreate, TaskUpdate), phản chiếu để vẽ tiến độ (0.6.1).
 * `key` là id của TaskCreate, hoặc thứ tự trong danh sách của TodoWrite. Claude Code không có trạng thái verified: bước verified ở
 * đây luôn do mod tự nâng khi lệnh test chạy đạt sau thay đổi cuối (0.7.1) và hạ về done khi có thay đổi mới.
 */
export type MirrorStep = { key: string; title: string; status: 'todo' | 'doing' | 'done' | 'verified'; closedSeq?: number }

/** Trạng thái của một lần gọi Agent (0.6.1): đang chạy, xong, lỗi, hoặc bị cắt vì tạm dừng hạn mức. */
export type AgentState = 'running' | 'done' | 'failed' | 'cut'

/** Tiến độ của một lần gọi Agent, gắn theo agentId (0.6.1). */
export type AgentProgress = {
  agentId: string
  title: string
  /** Việc router phân mà agent này làm; vắng khi Claude tự giao ngoài phân việc. */
  taskIndex?: number
  family: ModelFamily
  effort?: Effort
  state: AgentState
  /** Số tool call agent đã chạy. */
  tools: number
  startedAt: number
  endedAt?: number
  /** Danh sách việc agent tự ghi bằng TodoWrite hay TaskCreate, TaskUpdate (phản chiếu như luồng chính). */
  steps: MirrorStep[]
}

/**
 * Bộ đếm các lần gọi Agent của một việc trong mục tiêu (0.7.5), giữ ngoài danh sách dòng tiến độ có trần: việc đã phân theo
 * số (`task-N`), việc Claude tự giao theo dạng mô tả bỏ chữ số (`own-...`). `cut` (bị cắt vì tạm dừng) đếm vào `failed`.
 */
export type AgentTally = { key: string; title: string; taskIndex?: number; spawned: number; done: number; failed: number; running: number }

/** Nâng cấp theo bằng chứng, áp cho các turn sau trong cùng mục tiêu. */
export type Lift = { depth: number; effort: number }

/**
 * Trạng thái mục tiêu của phiên, gộp một chỗ để mỗi thay đổi là một lần
 * update nguyên tử (reducer thuần) và mỗi lần vẽ chỉ cần một lần đọc.
 */
/** Loại lỗi của router: hết giờ chờ, lỗi API, câu trả lời sai định dạng, rỗng, engine từ chối, hay router đang tạm ngừng. */
export type RouterFailKind = 'timeout' | 'api' | 'format' | 'empty' | 'engine' | 'paused'

/** Lần router lỗi gần nhất (0.7.2): để status line, /conductor status và nhật ký cho biết vì sao mod không đọc được prompt. */
export type RouterFail = {
  at: number
  kind: RouterFailKind
  /** Lý do bằng chữ (failureReason). */
  reason: string
  /** Mili giây đã chờ router (0 khi router bị bỏ qua vì tạm ngừng). */
  ms: number
  timeoutMs: number | null
  maxTokens: number | null
  outputTokens: number | null
}

/** Gợi ý khai option checkCommands cho mục tiêu goalId (0.7.3): các lệnh dạng sẽ khớp, và đã báo toast chưa (một lần mỗi mục tiêu). */
export type CheckHint = { goalId: number; commands: string[]; isToasted: boolean }

/**
 * Turn của luồng chính chết vì lỗi (turn.complete reason "error", 0.7.3): bản ghi riêng, không chung khóa với điểm dừng hạn mức.
 * `openSteps` là tiêu đề các bước còn mở lúc đó (tối đa 5). Tự xóa khi turn kế tiếp của luồng chính kết thúc bằng câu trả lời.
 */
export type TurnFault = { goalId: number | null; goal: string | null; openSteps: string[]; at: number }

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
  /** Trạng thái các việc giao subagent của mục tiêu goalId (không có ở trạng thái từ bản cũ). */
  delegations: { goalId: number; items: DelegationItem[] }
  /**
   * Danh sách việc của Claude Code ở luồng chính, phản chiếu cho mục tiêu goalId (0.6.1; không có ở trạng thái từ bản
   * cũ). Chỉ để hiển thị khi `plan` (checklist của tool plan) còn rỗng: cổng Stop, nhắc checkpoint, tiêu chí chất lượng,
   * verified và bảo vệ hạn mức chỉ đọc `plan`.
   */
  mirror: { goalId: number; steps: MirrorStep[] }
  /** Tiến độ từng lần gọi Agent của mục tiêu goalId, tối đa 20 (0.6.1; không có ở trạng thái từ bản cũ). */
  /** `tally` và `open` (agentId đang chạy đến khóa bộ đếm) từ 0.7.5; vắng ở trạng thái cũ. */
  agentProgress: { goalId: number; items: AgentProgress[]; tally?: AgentTally[]; open?: Record<string, string> }
  /** Số lần luồng chính thay đổi file trong mục tiêu goalId: cho trạng thái của việc làm trực tiếp khi chưa có bước (0.6.1). */
  activity: { goalId: number; changes: number }
  /** Lần router lỗi gần nhất cho tới khi router đọc được lại (0.7.2); null là không có. */
  routerFail: RouterFail | null
  /** Gợi ý khai checkCommands khi script kiểm đã chạy mà mod chưa nhận (0.7.3); null là không có. */
  checkHint: CheckHint | null
  /** Turn lỗi gần nhất của luồng chính cho tới khi một turn trả lời xong (0.7.3); null là không có. */
  turnFault: TurnFault | null
  /**
   * Mốc đóng bước (0.7.5): `seq` tăng mỗi lần một bước thành done, bị hạ về done hay có lần kiểm đạt; `lastPassSeq` là mốc của
   * lần kiểm đạt gần nhất của mục tiêu goalId (null là chưa có). Lần kiểm đạt chỉ nâng bước có closedSeq lớn hơn mốc đó.
   */
  closing: { seq: number; goalId: number; lastPassSeq: number | null }
}

/** Một cửa sổ hạn mức đã qua ngưỡng lúc dừng (0.6.0). */
export type QuotaReason = { kind: 'five_hour' | 'seven_day'; percentUsed: number; resetsAt?: string; thresholdRemainingPct: number }

/** Số đo hạn mức engine báo, giữ nguyên dạng SessionRateLimit. */
export type QuotaReading = { kind: string; percentUsed: number; resetsAt?: string }

/** Một lần dừng đang có hiệu lực: do hạn mức (tự mở khi hạn mức làm mới) hay do người dùng (/conductor pause). */
export type QuotaPause = {
  at: number
  source: 'quota' | 'user'
  reason: QuotaReason[]
  /** Số lần từ chối tool của luồng chính trong turn denialTurn (dừng cứng ở lần thứ ba). */
  denials: number
  denialTurn: string
  /** Đã gọi $.turn.abort cho turn denialTurn. */
  aborted: boolean
  /** Lệnh đầu tiên bị từ chối của lần dừng này: điểm tiếp tục chính xác. */
  denied: { tool: string; input: string } | null
}

/** Phần mục tiêu cần để tiếp tục (cắt từ Brief); goal rỗng khi lúc dừng chưa có mục tiêu. */
export type CheckpointBrief = {
  goal: string
  constraints: string[]
  quality: string[]
  scopePaths: string[]
  tasks: Array<{ index: number; title: string; run: 'main' | 'agent'; agentType?: string; pick: Choice }>
  kind: Kind
}

/** Điểm dừng bền (0.6.0), trong $.store theo khóa của thư mục làm việc. Không chứa output tool hay nội dung file. */
export type QuotaCheckpoint = {
  version: 1
  id: string
  createdAt: number
  cwd: string
  status: 'open' | 'resuming' | 'consumed'
  reason: QuotaReason[]
  brief: CheckpointBrief
  plan: PlanStep[]
  /** id các bước doing lúc dừng. */
  doing: number[]
  /** Câu Claude ghi bằng plan action "checkpoint" (tối đa 600 ký tự); rỗng khi Claude chưa kịp ghi. */
  note: string
  denied: { tool: string; input: string } | null
  /** Năm tool call cuối của luồng chính: tool, đối tượng rút gọn, lỗi hay không. */
  recent: string[]
  files: Array<{ path: string; mtimeMs: number; size: number }>
  delegations: DelegationItem[]
}

/** Trạng thái bảo vệ hạn mức trong $.state (0.6.0). */
export type QuotaState = {
  zone: 'ok' | 'pause' | 'unknown'
  readings: QuotaReading[]
  measuredAt: number
  pause: QuotaPause | null
  /** /conductor resume force: tới mốc này (ms) các cửa sổ trong overrideKinds không gây dừng; 0 khi không ép. */
  overrideUntil: number
  /** Các cửa sổ đang chạm ngưỡng lúc gõ force: chỉ chúng được miễn, cửa sổ khác chạm ngưỡng vẫn dừng. */
  overrideKinds: Array<QuotaReason['kind']>
  /** Người dùng vừa gõ /conductor resume (hay force) khi có điểm dừng mở: prompt kế tiếp tiếp tục từ đó. */
  resumeArmed: boolean
  /** Turn luồng chính đang chạy (từ turn.start), cho $.turn.abort. */
  mainTurnId: string
  /** Bản sao của điểm dừng mới nhất của thư mục này (vẫn có khi $.store từ chối ghi). */
  checkpoint: QuotaCheckpoint | null
  /** Điểm dừng đang được tiếp tục: turn luồng chính đầu tiên sau khi chèn khối (turnId rỗng tới turn.start). */
  resume: { id: string; turnId: string } | null
  /** /conductor resume discard đang chờ gõ lần hai tới mốc này (ms); 0 khi không chờ. */
  discardArmedUntil: number
  /** Năm tool call cuối của luồng chính (tool, đối tượng rút gọn, lỗi hay không): dữ liệu cho điểm dừng. */
  recent: string[]
  /** File thấy bị sửa trong mục tiêu goalId (tối đa 50): dữ liệu cho điểm dừng. */
  touched: { goalId: number; paths: string[] }
  /** Cửa sổ đã báo hạn mức mềm (0.7.4), khóa kind cộng mốc làm mới: mỗi cửa sổ báo một lần; cửa sổ mới báo lại. */
  noticed: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'focus-conductor': {
      core: Core
      isBandHidden: boolean
      /** Mốc thời gian (ms) tới khi nút Đặt lại đang chờ bấm lần hai; 0 khi không chờ. */
      resetArmedUntil: number
      /** Ghi đè chế độ lúc chạy qua /conductor mode; null nghĩa là theo cấu hình. */
      mode: Mode | null
      /** Bảo vệ hạn mức (0.6.0). */
      quota: QuotaState
      /** Mục tiêu mà người dùng đã tự đóng pane chi tiết; -1 là chưa (0.7.2). */
      paneClosedGoal: number
    }
  }
}
