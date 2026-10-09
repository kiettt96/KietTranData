# focus-conductor

Mod cho Claude Code thực thi ba nguyên tắc: đọc kỹ prompt trước khi làm, tự điều phối model / effort / agent theo độ phức tạp của từng bước, và giữ nhất quán với mục tiêu cuối trong suốt phiên.

## Cách hoạt động

**1. Đọc kỹ prompt trước khi làm.** Hook `prompt.submit` phân tích mỗi prompt của người dùng trước khi nó vào phiên. Tầng heuristic chạy cục bộ, không tốn token: bóc mục tiêu cuối, các bước liệt kê, câu ràng buộc (phải, không được, chỉ, must, only...), tiêu chí chất lượng, đường dẫn phạm vi, và chấm điểm phức tạp 0 đến 100 thành năm tier `trivial`, `simple`, `moderate`, `complex`, `deep`. Nếu bật `analyzer: model`, một lượt Haiku effort low tinh chỉnh kết quả (tier của Haiku bị kẹp trong biên một bậc quanh tier heuristic). Kết quả được gắn vào context của prompt dưới dạng khối `[focus-conductor]`, kèm yêu cầu Claude đối chiếu lại với prompt gốc và chốt checklist trước khi gọi tool thực thi đầu tiên. Prompt tiếp nối ("tiếp tục", "sửa lại...", câu ngắn) giữ nguyên mục tiêu cũ thay vì mở mục tiêu mới.

**2. Điều phối model / effort / agent.** Chính sách theo tier:

| Tier | Luồng chính | Subagent mặc định | Ngân sách tool call |
|---|---|---|---|
| trivial | haiku / low | haiku / low | 8 |
| simple | sonnet / low | haiku / low | 15 |
| moderate | sonnet / medium | sonnet / low | 30 |
| complex | opus / high | sonnet / medium | 60 |
| deep | opus / xhigh (fable / high nếu bật `allowFable`) | opus / medium | 100 |

Luồng chính được điều phối ở hook `turn.step`: step đầu tiên của mỗi turn chốt model và effort, mọi step sau trong cùng turn giữ nguyên. Lý do là prompt cache gắn với từng model, và đổi effort giữa hội thoại cũng làm mất cache phần messages; đổi qua lại giữa các step sẽ khiến toàn bộ lịch sử bị ghi lại cache nhiều lần. Giữa các turn, mod chỉ đổi khi hội thoại còn ngắn (từ 6 message trở xuống), khi bắt đầu mục tiêu mới, hoặc khi cần nâng cấp; hạ cấp giữa chừng một mục tiêu dài bị giữ lại và ghi vào nhật ký là "không áp dụng". Người dùng tự đổi model hoặc effort bằng `/model` thì mod dừng điều phối luồng chính tới mục tiêu mới. Model được chọn mà không phản hồi (không có quyền, sai ID) thì mod quay về model của phiên ngay trong turn đó và tạm ngừng dùng họ model ấy.

Subagent là nơi điều phối tiết kiệm nhất vì mỗi subagent là một hội thoại mới, không có cache để mất. Hook `tool.call` trên tool `Agent` chấm độ khó của nhiệm vụ giao (điểm độ dài giảm một nửa vì prompt giao việc thường dài), điền `model` và `effort` khi Claude để trống, giữ nguyên khi Claude đã chỉ định. Nhiệm vụ chỉ đọc (tìm, liệt kê, tra cứu, không có động từ ghi) giao cho `general-purpose` sẽ được chuyển sang `Explore` với haiku hoặc sonnet effort low, nếu Explore đang khả dụng; `Plan` dùng opus cho việc từ complex trở lên. Hook `agent.spawn` ghi model mà engine thực sự dùng vào nhật ký.

**3. Giữ nhất quán.** Claude duy trì mục tiêu và checklist qua tool `mcp__focus-conductor__plan` (`set`, `add`, `update`). Trạng thái `verified` bắt buộc có bằng chứng kiểm tra, `skipped` và `blocked` bắt buộc có lý do. Trong turn, hook `tool.call` theo dõi mọi tool của luồng chính và gắn lời nhắc vào kết quả tool (không sửa system prompt, nên không ảnh hưởng cache) khi gặp các dấu hiệu sau: cùng lệnh lỗi ba lần (lặp), vượt ngân sách tool call của tier (lan man), sửa file ngoài phạm vi khi prompt có giới hạn kiểu "chỉ sửa X" (lạc phạm vi), và năm thay đổi liên tiếp chưa chạy bước kiểm tra nào (checkpoint tự kiểm tra). Khi Claude định kết thúc một turn có thực thi mà checklist còn bước `todo` hoặc `doing`, hook `classic.Stop` yêu cầu hoàn thành hoặc ghi rõ lý do, tối đa một lần mỗi lần dừng; turn chỉ hỏi đáp không bị chặn. Một mục system prompt cố định nhắc năm nguyên tắc làm việc; nội dung không đổi giữa các turn để không phá cache.

**Giao diện.** Band phía trên prompt hiện mục tiêu, tier, model đang chạy, tiến độ checklist và cảnh báo mới nhất, kèm nút Chi tiết và Ẩn. Pane "Focus Conductor" hiện đầy đủ mục tiêu, ràng buộc, tiêu chí chất lượng, checklist, quyết định điều phối, nhật ký điều phối và cảnh báo, kèm nút đổi chế độ. Status line dưới prompt có dạng `focus: complex · opus/high · 2/5`.

## Cài đặt

Chạy trực tiếp từ thư mục (phù hợp khi đang phát triển, tự hot-reload khi sửa file):

```bash
claude --plugin-dir /đường/dẫn/tới/conductor-conductor
```

Hoặc khai báo cố định trong `~/.claude/settings.json` để mọi phiên (kể cả phiên do desktop app mở) đều nạp:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/đường/dẫn/tới/conductor-conductor" } }
```

Repository `kiettt96/KietTranData` có sẵn `.claude-plugin/marketplace.json` liệt kê mod này. Sau khi nhánh chứa mod được merge vào nhánh mặc định, cài bằng một dòng tại prompt của terminal session, trả lời `y` để thêm marketplace rồi chọn scope (user scope để mọi phiên đều có):

```
/plugin install focus-conductor --marketplace kiettt96/KietTranData
```

## Sử dụng

| Lệnh | Tác dụng |
|---|---|
| `/conductor` | Mở pane Focus Conductor |
| `/conductor status` | Tóm tắt chế độ, route luồng chính, model bị tạm ngừng, checklist |
| `/conductor mode auto\|subagents\|suggest\|off` | Đổi chế độ trong phiên |
| `/conductor goal <mô tả>` | Đặt mục tiêu thủ công (Claude nhận khối phân tích qua context) |
| `/conductor reset` | Xóa mục tiêu, checklist, cảnh báo, danh sách model bị tạm ngừng |

Cấu hình qua `/config` (hoặc `pluginConfigs.focus-conductor.options` trong settings):

| Trường | Mặc định | Ý nghĩa |
|---|---|---|
| `routing` | `auto` | `auto` điều phối cả luồng chính và subagent; `subagents` chỉ subagent, giữ nguyên model luồng chính (an toàn nhất cho cache); `suggest` chỉ hiển thị đề xuất; `off` tắt toàn bộ mod |
| `analyzer` | `model` | `model` dùng thêm một lượt Haiku cho prompt từ 12 từ trở lên; `heuristic` chỉ phân tích cục bộ |
| `enforceChecklist` | `true` | Chặn kết thúc khi checklist còn bước mở |
| `allowFable` | `false` | Tier deep dùng Fable thay cho Opus xhigh |
| `modelMap` | rỗng | Ghi đè model ID, ví dụ `opus=claude-opus-5-5,sonnet=claude-sonnet-5-5` (cần khi dùng gateway có ID riêng) |

## Cấu trúc

```
focus-conductor/
  .claude-plugin/plugin.json   manifest, userConfig, đường dẫn type contract
  hooks/hooks.json             khai báo module hooks
  hooks/register.tsx           nối hook; mọi lệnh gọi $ nằm ở đây
  hooks/lib/analyze.ts         đọc prompt, chấm độ phức tạp, gộp kết quả Haiku
  hooks/lib/route.ts           chính sách tier, quyết định có tính cache, chọn model subagent
  hooks/lib/drift.ts           phát hiện lặp, lan man, lạc phạm vi, checkpoint
  hooks/lib/plan.ts            schema và reducer của tool plan
  hooks/lib/state.ts           giá trị khởi tạo và reducer thuần cho $.state
  hooks/lib/text.ts            mọi văn bản gửi model và hiển thị
  hooks/ui/band.tsx            band phía trên prompt
  hooks/ui/pane.tsx            pane chi tiết
  types/index.d.ts             type contract của $.state
  tests/                       test logic thuần và test tích hợp qua engine
```

Kiểm tra trước khi phát hành: `claude plugin validate .` và `claude plugin test .` (24 test).

## Giới hạn đã biết

Điểm phức tạp là heuristic theo từ khóa tiếng Việt và tiếng Anh, có thể lệch với prompt ngắn nhưng khó; khi đó dùng `analyzer: model` hoặc đặt lại bằng `/conductor goal`. Mod không đọc được nội dung suy luận của model nên phát hiện lạc đề dựa trên hành vi gọi tool, không dựa trên ngữ nghĩa từng câu trả lời. Giá dùng để thiết kế bảng chính sách: Haiku 5.5 $0.10 / $0.50, Sonnet 5.5 $2 / $10, Opus 5.5 $4 / $20, Fable 5.1 $10 / $50 mỗi 1 triệu token input / output [Nguồn: bảng giá Claude API trong skill claude-api, cập nhật 2026-10-06].
