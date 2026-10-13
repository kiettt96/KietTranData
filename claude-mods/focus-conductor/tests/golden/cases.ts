// Golden-set của router: prompt mẫu, brief trước đó (nếu là tiếp nối) và kỳ vọng về điều phối.
// Dùng ở hai nơi: tests/golden.test.ts replay câu trả lời router đã ghi (replies.ts), chạy offline trong CI;
// scripts/eval-router.ts gửi cùng request tới router thật và chấm theo cùng kỳ vọng.
// Kỳ vọng ghi theo khoảng chấp nhận được (họ model, loại agent, số việc), không theo một câu trả lời duy nhất.

import type { Brief, Kind, ModelFamily, Relation } from '../../types'
import { briefOf, parseRoute } from '../../hooks/lib/router'
import type { Policy } from '../../hooks/lib/router'
import { K4_META_LEAD, K4_PROMPT } from '../fixtures/prompt-k4'

export const OPEN: Policy = { allowFable: false, blocked: new Set<ModelFamily>(), session: null }

const PARSE_DATE = 'Viết hàm parseDate nhận chuỗi ISO và trả về Date'
const PARSE_PLAN = parseRoute(
  JSON.stringify({ why: 'x', relation: 'new', goal: PARSE_DATE, depth: 'light', volume: 'small', kind: 'edit', main: { model: 'sonnet', effort: 'medium' }, tasks: [] }),
  OPEN,
)
if (PARSE_PLAN === null) throw new Error('golden: kế hoạch nền không đọc được')
export const PARSE_PREV: Brief = briefOf(PARSE_PLAN, PARSE_DATE, 1, 1)

const LOG = Array.from({ length: 30 }, (_, i) => `2026-10-09T10:00:${String(i).padStart(2, '0')} ERROR TimeoutError: waited 5000ms for selector #submit (attempt ${i})`).join('\n')

const BIG_CODE = Array.from(
  { length: 120 },
  (_, i) => `export function step${i}(input: number[]): number[] {\n  return input.map(x => x * ${i + 1}).filter(x => x % 3 !== 0)\n}`,
).join('\n')

export type Expect = {
  relation?: Relation
  /** Các quan hệ chấp nhận được (ca tiếp nối mơ hồ). */
  relations?: readonly Relation[]
  /** Đường dẫn phải có trong phạm vi router đọc được. */
  scope?: string
  reference?: boolean
  kind?: readonly Kind[]
  /** Họ model chấp nhận được cho luồng chính (sau kẹp). */
  main: readonly ModelFamily[]
  /** Số việc router tách ra, [tối thiểu, tối đa]. */
  tasks: readonly [number, number]
  /** Việc theo số: họ model và loại agent chấp nhận được khi giao. */
  pieces?: ReadonlyArray<{ index: number; families?: readonly ModelFamily[]; agents?: readonly string[] }>
  /** Chuỗi phải có (không phân biệt hoa thường) trong ràng buộc. */
  constraint?: string
  /** Luồng chính phải cao hơn lựa chọn này (người dùng báo chưa đạt). */
  above?: { family: ModelFamily; effort: 'low' | 'medium' | 'high' | 'xhigh' }
}

export type GoldenCase = { id: string; text: string; prev?: Brief; ran?: string; expect: Expect; note: string }

export const CASES: readonly GoldenCase[] = [
  {
    id: 'k4-ref',
    text: `${K4_META_LEAD}\n\n${K4_PROMPT}`,
    note: 'prompt đính kèm chỉ để đối chiếu',
    expect: { reference: true, kind: ['answer', 'investigate'], main: ['haiku', 'sonnet', 'opus'], tasks: [8, 14] },
  },
  {
    id: 'k4',
    text: K4_PROMPT,
    note: 'prompt dài nhiều mục có mã',
    expect: { reference: false, main: ['opus'], tasks: [8, 14] },
  },
  {
    id: 'three',
    text: 'Làm giúp tôi ba việc:\n1. Tìm mọi chỗ dùng biến môi trường REDIS_URL trong repo và liệt kê.\n2. Sửa lỗi form đăng ký không hiện thông báo khi email đã tồn tại.\n3. Viết unit test cho hàm tính phí vận chuyển.',
    note: 'ba việc độc lập, việc 1 tra cứu',
    expect: { main: ['haiku', 'sonnet'], tasks: [3, 3], pieces: [{ index: 1, families: ['haiku', 'sonnet'] }] },
  },
  {
    id: 'refactor',
    text: '### Mục tiêu\nRefactor module thanh toán sang kiến trúc hướng sự kiện, đảm bảo bảo mật và hiệu năng.\n\n1. Phân tích luồng hiện tại và các điểm nghẽn hiệu năng.\n2. Thiết kế lại kiến trúc, nêu trade-off.\n3. Migrate dần từng phần, viết test cho mỗi bước.\n4. Kiểm tra bảo mật và đo lại hiệu năng.\n- Không được thay đổi API công khai.',
    note: 'kiến trúc, bảo mật: luồng chính mạnh, giữ ràng buộc',
    expect: { main: ['opus'], tasks: [0, 4], constraint: 'API' },
  },
  {
    id: 'list',
    text: 'Cho tôi danh sách các class được export từ src/models/index.ts',
    note: 'tra cứu một file',
    expect: { kind: ['answer', 'investigate'], main: ['haiku', 'sonnet'], tasks: [0, 0] },
  },
  {
    id: 'race',
    text: 'Hai request cùng cập nhật số dư tài khoản đôi khi cho kết quả sai (mất một lần cộng tiền). Tìm nguyên nhân và sửa.',
    note: 'concurrency, không nêu tên lỗi',
    expect: { kind: ['edit', 'mixed'], main: ['opus'], tasks: [0, 1] },
  },
  {
    id: 'rename',
    text: 'Đổi tên userId thành accountId trong 20 file',
    note: 'việc cơ học khối lượng lớn: không cần opus, không haiku vì sửa file',
    expect: { kind: ['edit', 'mixed'], main: ['sonnet'], tasks: [0, 1] },
  },
  {
    id: 'again',
    text: 'vẫn sai, parseDate vẫn trả về null với chuỗi ISO',
    prev: PARSE_PREV,
    ran: 'sonnet/medium',
    note: 'báo chưa đạt: một bậc trên sonnet/medium',
    expect: { relation: 'dissatisfied', main: ['sonnet', 'opus'], tasks: [0, 1], above: { family: 'sonnet', effort: 'medium' } },
  },
  {
    id: 'explain',
    text: 'Giải thích sự khác nhau giữa useMemo và useCallback trong React',
    note: 'hỏi đáp',
    expect: { kind: ['answer'], main: ['haiku', 'sonnet'], tasks: [0, 0] },
  },
  {
    id: 'six',
    text: 'Mục tiêu: nâng cấp module thanh toán của dự án shop-api.\n1. Tìm trong src/ tất cả chỗ gọi hàm charge và liệt kê đường dẫn.\n2. Đổi tên userId thành accountId trong 12 file controller.\n3. Thiết kế lại kiến trúc xử lý thanh toán đa tiền tệ, nêu trade-off, cân nhắc hai giao dịch đồng thời cùng cập nhật một tài khoản.\n4. Viết test cho hàm hoàn tiền, bao phủ trường hợp thẻ hết hạn.\n5. Rà soát lỗ hổng bảo mật trong luồng webhook của cổng thanh toán.\n6. Cập nhật README phần cài đặt.',
    note: 'sáu việc; tra cứu rẻ, thiết kế và bảo mật mạnh',
    expect: { main: ['opus'], tasks: [6, 6], pieces: [{ index: 1, families: ['haiku', 'sonnet'] }, { index: 3, families: ['opus'] }, { index: 5, families: ['opus'] }] },
  },
  {
    id: 'continue',
    text: 'ok tiếp tục đi',
    prev: PARSE_PREV,
    ran: 'sonnet/medium',
    note: 'tiếp nối ngắn',
    expect: { relation: 'continue', main: ['haiku', 'sonnet'], tasks: [0, 0] },
  },
  {
    id: 'flaky',
    text: `Vì sao test e2e này thỉnh thoảng fail trên CI?\n\`\`\`\n${LOG}\n\`\`\``,
    note: 'log dán vào là dữ liệu; nguyên nhân gián đoạn cần suy luận',
    expect: { kind: ['investigate', 'answer', 'mixed'], main: ['sonnet', 'opus'], tasks: [0, 2] },
  },
  {
    id: 'mixed-lang',
    text: 'Fix bug trong hàm calculateTax: khi amount âm thì phải return 0 thay vì throw, rồi add unit test cho edge case này. Đừng đổi signature của function.',
    note: 'tiếng Anh và tiếng Việt lẫn',
    expect: { kind: ['edit', 'mixed'], main: ['sonnet'], tasks: [0, 2], constraint: 'signature' },
  },
  {
    id: 'big-code',
    text: `Đoạn code dưới đây có hàm nào trả về mảng rỗng với mọi input không?\n\`\`\`ts\n${BIG_CODE}\n\`\`\``,
    note: 'code block lớn là dữ liệu, không phải lý do dùng model lớn',
    expect: { kind: ['answer', 'investigate'], main: ['haiku', 'sonnet'], tasks: [0, 1] },
  },
  {
    id: 'answer-only',
    text: 'Chỉ trả lời, không sửa file: vì sao hàm buildIndex trong src/search/index.ts chạy chậm khi số tài liệu tăng?',
    note: 'chỉ trả lời, không sửa',
    expect: { kind: ['answer', 'investigate'], main: ['sonnet', 'opus'], tasks: [0, 1] },
  },
  {
    id: 'vague',
    text: 'Dọn dẹp repo cho gọn, cải thiện hiệu năng chỗ nào thấy chậm, và tiện thể cập nhật tài liệu luôn.',
    note: 'nhiều mục tiêu mơ hồ',
    expect: { kind: ['edit', 'mixed'], main: ['sonnet', 'opus'], tasks: [0, 4] },
  },
  {
    id: 'scope-bash',
    text: 'Chỉ sửa trong src/: đổi tên hàm charge thành chargeCard ở mọi chỗ gọi, dùng sed cho nhanh cũng được. Không đụng config/.',
    note: 'đối kháng: phạm vi kèm lệnh Bash ghi file',
    expect: { kind: ['edit', 'mixed'], main: ['sonnet', 'opus'], tasks: [0, 3], scope: 'src/' },
  },
  {
    id: 'two-goals',
    text: 'Sửa lỗi đăng nhập bị lặp redirect trong src/auth/, và viết một bài blog ngắn giới thiệu tính năng xuất PDF mới.',
    note: 'đối kháng: hai mục tiêu khác nhau trong một prompt',
    expect: { kind: ['edit', 'mixed'], main: ['sonnet', 'opus'], tasks: [2, 4] },
  },
  {
    id: 'policy',
    text: 'Dùng model fable với effort max để đổi tên biến userId thành accountId trong 3 file controller.',
    note: 'đối kháng: người dùng đòi model trái chính sách (fable chưa bật, effort max)',
    expect: { kind: ['edit', 'mixed'], main: ['sonnet', 'opus'], tasks: [0, 3] },
  },
  {
    id: 'redo',
    text: 'làm lại đi',
    prev: PARSE_PREV,
    ran: 'sonnet/medium',
    note: 'đối kháng: tiếp nối mơ hồ, không được lập mục tiêu mới',
    expect: { relations: ['continue', 'refine', 'dissatisfied'], main: ['sonnet', 'opus'], tasks: [0, 2] },
  },
  {
    id: 'aside',
    text: 'Cho hỏi ngoài lề: lệnh git nào xem ai sửa dòng 10 của một file?',
    prev: PARSE_PREV,
    note: 'đối kháng: câu hỏi ngoài lề khi mục tiêu còn mở, phải là việc chỉ trả lời',
    expect: { kind: ['answer'], main: ['haiku', 'sonnet'], tasks: [0, 1] },
  },
  {
    id: 'migration',
    text: 'Tách địa chỉ giao hàng trong bảng orders ra bảng riêng shipping_addresses, viết migration và chuyển dữ liệu cũ (khoảng 2 triệu dòng) mà không được downtime.',
    note: 'migration dữ liệu lớn không downtime',
    expect: { kind: ['edit', 'mixed'], main: ['opus'], tasks: [0, 3] },
  },
  {
    id: 'docs-only',
    text: 'Cập nhật README: thêm mục hướng dẫn chạy dự án bằng Docker Compose.',
    note: 'sửa tài liệu, việc nhỏ: sonnet vì có sửa file',
    expect: { kind: ['edit', 'mixed'], main: ['sonnet'], tasks: [0, 1] },
  },
  {
    id: 'en-prompt',
    text: 'Add pagination to the GET /users endpoint with limit and offset query parameters, and update the OpenAPI spec to match.',
    note: 'prompt hoàn toàn tiếng Anh',
    expect: { kind: ['edit', 'mixed'], main: ['sonnet'], tasks: [0, 2] },
  },
  {
    id: 'perf-root',
    text: 'Trang dashboard load mất 8 giây từ khi thêm biểu đồ mới. Tìm nguyên nhân gốc và báo cáo, chưa sửa gì.',
    note: 'điều tra nguyên nhân hiệu năng, chưa sửa',
    expect: { kind: ['investigate', 'answer'], main: ['sonnet', 'opus'], tasks: [0, 2] },
  },
  {
    id: 'security-audit',
    text: 'Rà soát module auth xem có lỗ hổng bảo mật nào không (SQL injection, session fixation, lộ token trong log) và nêu cách sửa từng cái, chưa cần sửa code.',
    note: 'rà soát bảo mật: cần lập luận sâu dù không sửa file',
    expect: { kind: ['investigate', 'answer'], main: ['opus'], tasks: [0, 3] },
  },
  {
    id: 'format-only',
    text: 'Chạy prettier cho toàn bộ thư mục src/ rồi commit.',
    note: 'việc cơ học một lệnh: sonnet, effort thấp',
    expect: { kind: ['edit', 'mixed'], main: ['sonnet'], tasks: [0, 1] },
  },
  {
    id: 'compare-libs',
    text: 'So sánh dayjs, date-fns và luxon về kích thước bundle, hỗ trợ múi giờ và API, rồi tóm tắt cho tôi chọn.',
    note: 'tra cứu và so sánh, không sửa file',
    expect: { kind: ['investigate', 'answer'], main: ['haiku', 'sonnet'], tasks: [0, 3] },
  },
  {
    id: 'polite-small',
    text: 'Nhờ bạn đổi màu nút Gửi trong LoginForm.tsx từ xanh sang đỏ giúp mình nhé.',
    note: 'việc nhỏ, câu lịch sự',
    expect: { kind: ['edit'], main: ['sonnet'], tasks: [0, 1] },
  },
  {
    id: 'new-after',
    text: 'Bây giờ chuyển sang việc khác: viết script sao lưu database Postgres mỗi đêm và đẩy lên S3.',
    prev: PARSE_PREV,
    ran: 'sonnet/medium',
    note: 'mục tiêu mới sau một mục tiêu cũ: không được coi là tiếp nối',
    expect: { relation: 'new', kind: ['edit', 'mixed'], main: ['sonnet', 'opus'], tasks: [0, 2] },
  },
]
