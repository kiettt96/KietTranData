// Nhãn cố định của band và pane theo option uiLanguage (vi mặc định, en). Nội dung động (mục tiêu, lý do của
// router, cảnh báo, nhật ký, sổ chi phí) giữ nguyên ngôn ngữ của nó: router trả lời theo ngôn ngữ của prompt.

export type Lang = 'vi' | 'en'

export function langOf(value: unknown): Lang {
  return value === 'en' ? 'en' : 'vi'
}

const VI = {
  goal: 'Mục tiêu',
  step: (closed: number, total: number) => `bước ${closed}/${total}`,
  plannedSteps: (n: number) => `${n} bước dự kiến`,
  suggest: 'đề xuất',
  run: 'chạy',
  mode: 'chế độ',
  details: 'Chi tiết',
  hide: 'Ẩn',
  modeLabel: 'Chế độ',
  noGoal: 'Chưa có mục tiêu. Gửi một prompt, hoặc dùng /conductor goal kèm mô tả mục tiêu.',
  noChecklist: 'Claude chưa chốt checklist.',
  volume: 'khối lượng',
  notRead: 'router chưa đọc',
  constraints: 'Ràng buộc',
  noConstraints: 'Không nhận ra ràng buộc rõ ràng.',
  quality: 'Tiêu chí chất lượng',
  noQuality: 'Không nhận ra tiêu chí riêng.',
  planned: 'Việc dự kiến (router)',
  mainRouting: 'Điều phối luồng chính',
  forWork: (depth: string, volume: string) => ` cho việc ${depth}, khối lượng ${volume}`,
  notApplied: 'Chưa áp dụng; luồng chính đang dùng model của phiên.',
  cost: 'Chi phí (số đo và phần còn ước tính)',
  delegations: 'Việc giao subagent',
  delegationState: { pending: 'chờ giao', running: 'đang chạy', done: 'xong', failed: 'lỗi, chưa giao lại' } as Record<'pending' | 'running' | 'done' | 'failed', string>,
  log: 'Nhật ký điều phối',
  noLog: 'Chưa có quyết định nào.',
  main: 'chính',
  estimated: ' (ước tính)',
  skipped: ' (không áp dụng)',
  warnings: 'Cảnh báo nhất quán',
  noWarnings: 'Không có cảnh báo.',
  reset: 'Đặt lại mục tiêu',
  showBand: 'Hiện band',
  hideBand: 'Ẩn band',
}

const EN: typeof VI = {
  goal: 'Goal',
  step: (closed, total) => `step ${closed}/${total}`,
  plannedSteps: n => `${n} planned steps`,
  suggest: 'suggest',
  run: 'run',
  mode: 'mode',
  details: 'Details',
  hide: 'Hide',
  modeLabel: 'Mode',
  noGoal: 'No goal yet. Send a prompt, or use /conductor goal with a description.',
  noChecklist: 'Claude has not set a checklist yet.',
  volume: 'volume',
  notRead: 'not read by the router',
  constraints: 'Constraints',
  noConstraints: 'No explicit constraints found.',
  quality: 'Quality criteria',
  noQuality: 'No specific criteria found.',
  planned: 'Planned work (router)',
  mainRouting: 'Main thread routing',
  forWork: (depth, volume) => ` for ${depth} work, volume ${volume}`,
  notApplied: 'Not applied; the main thread runs the session model.',
  cost: 'Cost (measured and still estimated)',
  delegations: 'Delegated tasks',
  delegationState: { pending: 'not delegated yet', running: 'running', done: 'done', failed: 'failed, not re-delegated' },
  log: 'Routing log',
  noLog: 'No decisions yet.',
  main: 'main',
  estimated: ' (estimated)',
  skipped: ' (not applied)',
  warnings: 'Consistency warnings',
  noWarnings: 'No warnings.',
  reset: 'Reset goal',
  showBand: 'Show band',
  hideBand: 'Hide band',
}

export function labels(lang: Lang): typeof VI {
  return lang === 'en' ? EN : VI
}
