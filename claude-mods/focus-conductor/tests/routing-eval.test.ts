// Bộ đánh giá điều phối: prompt có nhãn (cả tiếng Việt và tiếng Anh) và các
// kịch bản nhiều subagent, chấm trên đường cục bộ (không gọi model). Cổng cứng:
//   - việc khó (hard) luôn chạy opus; việc nhẹ (none, light) không bao giờ chạy opus;
//   - việc sửa code không bao giờ giao cho haiku;
//   - subagent sửa hoặc điều tra không thấp hơn một bậc so với mục tiêu cha;
//   - tối thiểu 90% prompt chọn đúng họ model.

import { describe, expect, test } from 'claude-code/testing'

import type { ModelFamily } from '../types'
import { analyzeHeuristic } from '../hooks/lib/analyze'
import { planAgent, chooseMain } from '../hooks/lib/route'

type Labeled = { text: string; family: ModelFamily; note: string }

/** Prompt có nhãn: nhóm, văn bản và họ model kỳ vọng. */
const PROMPTS: Labeled[] = [
  // Ngắn mà khó: chấm theo bản chất, không theo độ dài.
  { text: 'Fix race condition trong worker pool khi hai job cùng ghi một key', family: 'opus', note: 'ngắn khó' },
  { text: 'Vì sao test này thỉnh thoảng fail trên CI?', family: 'opus', note: 'ngắn khó' },
  { text: 'Tìm lỗ hổng SQL injection trong module báo cáo', family: 'opus', note: 'ngắn khó' },
  { text: 'Deadlock khi hai goroutine cùng lấy hai lock theo thứ tự ngược', family: 'opus', note: 'ngắn khó' },
  { text: 'Find the root cause of this intermittent failure in the CI pipeline', family: 'opus', note: 'ngắn khó' },
  { text: 'Chứng minh thuật toán sắp xếp này luôn cho kết quả đúng', family: 'opus', note: 'ngắn khó' },
  { text: 'Tối ưu hiệu năng truy vấn báo cáo, tìm nguyên nhân chậm', family: 'opus', note: 'ngắn khó' },
  { text: 'Lỗi 500 khi đăng nhập, log báo timeout, tìm nguyên nhân', family: 'opus', note: 'ngắn khó' },
  // Kiến trúc, dữ liệu, bảo mật: việc khó dù ngắn.
  { text: 'Thiết kế kiến trúc đa tiền tệ cho hệ thống thanh toán, nêu trade-off', family: 'opus', note: 'kiến trúc' },
  { text: 'Đề xuất kiến trúc microservice cho module kho hàng', family: 'opus', note: 'kiến trúc' },
  { text: 'Refactor module thanh toán sang kiến trúc hướng sự kiện', family: 'opus', note: 'kiến trúc' },
  { text: 'Migrate bảng orders sang schema mới và giữ nguyên dữ liệu cũ', family: 'opus', note: 'migrate' },
  { text: 'Viết hàm kiểm tra chữ ký JWT và xử lý hết hạn token', family: 'opus', note: 'bảo mật' },
  { text: 'Thêm xác thực OAuth cho API và kiểm tra lỗ hổng phiên', family: 'opus', note: 'bảo mật' },
  { text: 'Phân tích race condition trong cache và đề xuất cách sửa', family: 'opus', note: 'đồng thời' },
  // Dài mà dễ hoặc có dữ liệu dán vào: không được đẩy lên opus.
  {
    text: `Đổi tên biến userId thành accountId trong các file sau:\n${Array.from({ length: 20 }, (_, i) => `- src/mod${i}.ts`).join('\n')}`,
    family: 'sonnet',
    note: 'dài mà dễ',
  },
  {
    text: `Giải thích lỗi này:\n\`\`\`\nTypeError: x is undefined\n    at foo (a.ts:1)\n\`\`\``,
    family: 'haiku',
    note: 'dán vào',
  },
  {
    text: `Sửa hàm này cho đúng:\n\`\`\`ts\nfunction add(a, b) { return a - b }\n\`\`\``,
    family: 'sonnet',
    note: 'dán vào, sửa code',
  },
  // Hỏi đáp và xã giao: haiku.
  { text: 'Liệt kê các hàm export trong utils.ts', family: 'haiku', note: 'hỏi đáp' },
  { text: 'Cảm ơn bạn nhé', family: 'haiku', note: 'xã giao' },
  { text: 'Explain what this function does', family: 'haiku', note: 'hỏi đáp tiếng Anh' },
  { text: 'Tóm tắt lịch sử thay đổi của dự án', family: 'haiku', note: 'hỏi đáp' },
  // Sửa code nhỏ: sonnet, không bao giờ haiku.
  { text: 'sửa typo trong README', family: 'sonnet', note: 'sửa nhỏ' },
  { text: 'Thêm unit test cho hàm slugify', family: 'sonnet', note: 'sửa nhỏ' },
  { text: 'Viết hàm parseDate nhận chuỗi ISO và trả về Date', family: 'sonnet', note: 'viết hàm' },
  { text: 'Viết README mô tả cách cài đặt plugin', family: 'sonnet', note: 'tài liệu' },
  { text: 'Đổi màu nút từ xanh sang đỏ', family: 'sonnet', note: 'sửa nhỏ' },
  { text: 'Tạo file .env.example liệt kê các biến môi trường', family: 'sonnet', note: 'tạo file' },
  { text: 'Sửa lỗi hiển thị nút bị lệch trên trang đăng nhập', family: 'sonnet', note: 'sửa lỗi nhẹ' },
  { text: 'Tách các hàm trong utils.ts sang 5 file riêng', family: 'sonnet', note: 'refactor nhẹ' },
  // Điều tra nhẹ và so sánh: sonnet.
  { text: 'Hãy kiểm tra lại đoạn code này có đúng không', family: 'sonnet', note: 'kiểm tra nhẹ' },
  { text: 'So sánh hai thư viện state management, nêu trade-off', family: 'sonnet', note: 'so sánh' },
  { text: 'Đọc file package.json và cho tôi biết version', family: 'sonnet', note: 'đọc nhẹ' },
  { text: 'Trang báo lỗi undefined khi bấm lưu, xem giúp', family: 'sonnet', note: 'báo lỗi nhẹ' },
]

describe('bộ đánh giá điều phối: việc đơn', () => {
  const predicted = PROMPTS.map(item => {
    const brief = analyzeHeuristic(item.text, null, 1)
    const pick = chooseMain({ depth: brief.depth, volume: brief.volume, kind: brief.kind, allowFable: false })
    return { ...item, got: pick.family, depth: brief.depth, kind: brief.kind }
  })

  test('cổng: việc khó luôn chạy opus', () => {
    const missed = predicted.filter(p => p.family === 'opus' && p.got !== 'opus')
    expect(missed.map(p => `${p.note}: ${p.text}`)).toEqual([])
  })

  test('cổng: việc nhẹ (none, light) không bao giờ chạy opus', () => {
    const overshot = predicted.filter(p => p.family !== 'opus' && p.got === 'opus')
    expect(overshot.map(p => `${p.note}: ${p.text} (${p.depth})`)).toEqual([])
  })

  test('cổng: việc sửa code không bao giờ giao cho haiku', () => {
    const edits = predicted.filter(p => p.kind === 'edit' || p.kind === 'mixed')
    expect(edits.filter(p => p.got === 'haiku').map(p => p.text)).toEqual([])
  })

  test('cổng: ít nhất 90% prompt chọn đúng họ model', () => {
    const right = predicted.filter(p => p.got === p.family).length
    const ratio = right / predicted.length
    const wrong = predicted.filter(p => p.got !== p.family).map(p => `${p.note}: ${p.text} → ${p.got}`)
    expect(ratio >= 0.9, `đúng ${right}/${predicted.length}: ${wrong.join(' | ')}`).toBe(true)
  })
})

type AgentCase = {
  description: string
  prompt: string
  subagentType?: string
  family: ModelFamily
  note: string
}

type Scenario = { name: string; goal: string; agents: AgentCase[] }

/** Kịch bản nhiều subagent: mỗi agent có họ model kỳ vọng theo việc của nó và mục tiêu cha. */
const SCENARIOS: Scenario[] = [
  {
    name: 'mục tiêu khó: tra cứu song song, sửa bảo mật, sửa nhẹ',
    goal: 'Thiết kế lại xác thực JWT và kiểm tra lỗ hổng phiên',
    agents: [
      { description: 'Tìm file auth', prompt: 'Tìm trong codebase các file xử lý đăng nhập và liệt kê đường dẫn.', family: 'haiku', note: 'tra cứu' },
      { description: 'Sửa login', prompt: 'Sửa hàm login trong src/auth.ts để kiểm tra mật khẩu đúng cách', family: 'opus', note: 'sửa bảo mật' },
      { description: 'Đổi tên', prompt: 'Đổi tên biến token thành accessToken trong utils.ts', family: 'opus', note: 'sửa nhẹ dưới mục tiêu khó' },
    ],
  },
  {
    name: 'mục tiêu khó: ba tra cứu Explore song song',
    goal: 'Tìm nguyên nhân lỗi thanh toán thỉnh thoảng fail',
    agents: [
      { description: 'Tìm log', prompt: 'Tìm trong logs các dòng có timeout của dịch vụ thanh toán', subagentType: 'Explore', family: 'haiku', note: 'Explore' },
      { description: 'Tìm gọi hàm', prompt: 'Tìm nơi gọi hàm charge để liệt kê đường dẫn', subagentType: 'Explore', family: 'haiku', note: 'Explore' },
      { description: 'Tìm cấu hình', prompt: 'Tìm file cấu hình retry và đọc giá trị timeout', subagentType: 'Explore', family: 'haiku', note: 'Explore' },
    ],
  },
  {
    name: 'mục tiêu nhẹ: sửa tài liệu và tra cứu',
    goal: 'Viết README mô tả cách cài đặt',
    agents: [
      { description: 'Thêm mục cài đặt', prompt: 'Thêm mục cài đặt vào README', family: 'sonnet', note: 'sửa nhẹ, không bao giờ haiku' },
      { description: 'Tìm lệnh', prompt: 'Tìm lệnh cài đặt trong package.json', family: 'haiku', note: 'tra cứu nhẹ' },
    ],
  },
  {
    name: 'mục tiêu nhẹ: việc sửa code không bao giờ haiku',
    goal: 'Sửa lỗi chính tả trong các comment',
    agents: [
      { description: 'Sửa comment', prompt: 'Sửa lỗi chính tả trong comment của file utils.ts', family: 'sonnet', note: 'sửa nhẹ' },
    ],
  },
  {
    name: 'mục tiêu khó: lập kế hoạch và thực thi',
    goal: 'Migrate bảng orders sang schema mới',
    agents: [
      { description: 'Lập kế hoạch', prompt: 'Lập kế hoạch migrate bảng orders và trade-off về downtime', subagentType: 'Plan', family: 'opus', note: 'Plan' },
      { description: 'Viết migration', prompt: 'Viết script migration cho bảng orders và kiểm tra dữ liệu', family: 'opus', note: 'migrate dữ liệu' },
    ],
  },
  {
    name: 'mục tiêu vừa: điều tra có suy luận',
    goal: 'Tìm nơi gây memory leak trong worker',
    agents: [
      { description: 'Điều tra leak', prompt: 'Điều tra memory leak trong worker: tìm nơi listener không được gỡ', family: 'opus', note: 'điều tra' },
      { description: 'Đọc log', prompt: 'Đọc log worker và liệt kê các lần cảnh báo', family: 'haiku', note: 'đọc log' },
    ],
  },
  {
    name: 'mục tiêu vừa: refactor nhiều file',
    goal: 'Refactor module thanh toán sang kiến trúc hướng sự kiện',
    agents: [
      { description: 'Đổi tên hàm', prompt: 'Đổi tên hàm xử lý thanh toán trong 12 file', family: 'opus', note: 'sửa dưới mục tiêu khó' },
      { description: 'Tìm chỗ dùng', prompt: 'Tìm mọi nơi gọi hàm charge trong codebase', family: 'haiku', note: 'tra cứu' },
    ],
  },
  {
    name: 'mục tiêu nhẹ: hỏi đáp và tra cứu',
    goal: 'Giải thích cấu trúc thư mục',
    agents: [
      { description: 'Liệt kê thư mục', prompt: 'Liệt kê các thư mục con trong src', family: 'haiku', note: 'liệt kê' },
      { description: 'Giải thích module', prompt: 'Giải thích module hooks làm gì', family: 'haiku', note: 'giải thích nhẹ' },
    ],
  },
  {
    name: 'mục tiêu khó: bảo mật, subagent tra cứu có Explore sẵn',
    goal: 'Kiểm tra lỗ hổng XSS trong form đăng ký',
    agents: [
      { description: 'Tìm form', prompt: 'Tìm file định nghĩa form đăng ký', family: 'haiku', note: 'tra cứu' },
      { description: 'Kiểm tra XSS', prompt: 'Kiểm tra lỗ hổng XSS trong form đăng ký và liệt kê các chỗ không escape', family: 'opus', note: 'bảo mật' },
    ],
  },
  {
    name: 'mục tiêu khó: đồng thời, sửa nhiều agent cùng lúc',
    goal: 'Fix race condition trong queue',
    agents: [
      { description: 'Sửa lock', prompt: 'Sửa race condition trong queue bằng lock đúng thứ tự', family: 'opus', note: 'đồng thời' },
      { description: 'Viết test', prompt: 'Thêm unit test cho hàm enqueue', family: 'opus', note: 'sửa dưới mục tiêu khó' },
    ],
  },
  {
    name: 'mục tiêu không có việc con: subagent không liên quan',
    goal: 'Đổi màu nút',
    agents: [
      { description: 'Đổi màu', prompt: 'Đổi màu nút từ xanh sang đỏ trong button.css', family: 'sonnet', note: 'sửa nhẹ' },
    ],
  },
  {
    name: 'mục tiêu khó: kiến trúc, Plan và Explore',
    goal: 'Thiết kế kiến trúc phân tán cho đặt vé',
    agents: [
      { description: 'Thiết kế', prompt: 'Thiết kế kiến trúc phân tán cho đặt vé, nêu trade-off', subagentType: 'Plan', family: 'opus', note: 'Plan' },
      { description: 'Tìm dịch vụ', prompt: 'Tìm các dịch vụ hiện có liên quan đến đặt vé', subagentType: 'Explore', family: 'haiku', note: 'Explore' },
    ],
  },
]

describe('bộ đánh giá điều phối: nhiều subagent trong một phiên', () => {
  test('mỗi subagent có họ model theo việc của nó và mục tiêu cha', () => {
    const offered = new Set(['Explore', 'Plan'])
    const failures: string[] = []
    for (const scenario of SCENARIOS) {
      const parent = analyzeHeuristic(scenario.goal, null, 1)
      for (const agent of scenario.agents) {
        const plan = planAgent({
          prompt: agent.prompt,
          description: agent.description,
          subagentType: agent.subagentType,
          offered,
          blocked: new Set<ModelFamily>(),
          allowFable: false,
          parent: { depth: parent.depth },
          session: null,
        })
        if (plan.family !== agent.family) failures.push(`${scenario.name} / ${agent.note}: ${plan.family}, kỳ vọng ${agent.family}`)
        if ((plan.kind === 'edit' || plan.kind === 'mixed') && plan.family === 'haiku') failures.push(`${scenario.name}: việc sửa giao haiku`)
        // Mục tiêu khó: việc con không phải tra cứu chỉ đọc phải chạy opus, không thấp hơn sàn.
        const isLookupPlan = plan.reason.startsWith('tra cứu')
        if (parent.depth === 'hard' && !isLookupPlan && plan.family !== 'opus') {
          failures.push(`${scenario.name} / ${agent.note}: dưới sàn của mục tiêu khó (${plan.family})`)
        }
      }
    }
    expect(failures).toEqual([])
  })
})
