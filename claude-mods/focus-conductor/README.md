# focus-conductor

Mod cho Claude Code thực thi ba nguyên tắc: đọc kỹ prompt trước khi làm, tự điều phối model / effort / agent theo độ phức tạp của từng bước, và giữ nhất quán với mục tiêu cuối trong suốt phiên.

## Cách hoạt động

**1. Đọc kỹ prompt trước khi làm.** Hook `prompt.submit` phân tích mỗi prompt của người dùng trước khi nó vào phiên. Bước cục bộ không tốn token: bóc mục tiêu cuối, các bước, ràng buộc, tiêu chí chất lượng, đường dẫn phạm vi, và đánh giá việc theo bốn thuộc tính: **độ sâu** (`none`, `light`, `substantial`, `hard`; quyết định model), **khối lượng** (`small`, `medium`, `large`; quyết định effort), **bản chất** (trả lời, sửa, điều tra, hỗn hợp) và **tín hiệu khó** (đồng thời, bảo mật, thiết kế liên module, migrate dữ liệu, lỗi chập chờn, nguyên nhân chưa rõ). Việc được chấm theo độ khó suy luận, không theo độ dài: một câu ngắn về race condition là việc khó, còn đổi tên ở 20 file là việc nhẹ. Phần code, log hoặc dữ liệu dán vào được tách ra trước khi chấm độ sâu; chỉ phần yêu cầu quyết định độ sâu.

Nếu bật `analyzer: model`, một lượt Haiku effort low là nguồn chính cho mục tiêu mới (bỏ qua câu xã giao dưới 4 từ) và cho bước tinh chỉnh từ 6 từ trở lên. Độ sâu của Haiku không bao giờ thấp hơn sàn từ tín hiệu khó. Khi Haiku tự báo `confidence: low`, mod lấy mức cao hơn giữa Haiku và luật cục bộ. Kết quả được gắn vào context của prompt dưới dạng khối `[focus-conductor]`, kèm yêu cầu Claude đối chiếu lại với prompt gốc và chốt checklist trước khi gọi tool thực thi đầu tiên.

Quan hệ với mục tiêu trước: "tiếp tục" giữ nguyên độ sâu; tinh chỉnh không thấp hơn một bậc so với trước; "vẫn sai", "chưa đúng" tăng một bậc. Prompt khác chủ đề là mục tiêu mới. Cùng chủ đề được nhận ra theo từ khóa có dấu, và không dấu khi người dùng gõ không dấu, nên "luồng" và "lượng" là hai từ khác nhau.

**2. Điều phối model / effort / agent.** Model theo độ sâu, effort theo khối lượng và bản chất việc:

| Độ sâu | Model luồng chính | Effort |
|---|---|---|
| none | haiku (không bao giờ cho việc sửa code) | low |
| light | sonnet | trả lời low; sửa medium; điều tra khối lượng lớn high |
| substantial | opus | việc sửa hoặc khối lượng lớn high; còn lại medium |
| hard | opus (fable nếu bật `allowFable`) | khối lượng nhỏ high; vừa hoặc lớn xhigh |

Không dùng `max` mặc định. Luồng chính chốt model và effort ở step đầu của mỗi turn và giữ nguyên cho mọi step trong turn, vì prompt cache gắn với từng model và đổi effort cũng làm mất cache phần messages.

Đổi giữa các turn được tính bằng chi phí token. Mod so lợi ích tiết kiệm trong các turn còn lại với chi phí ghi lại cache của ngữ cảnh hiện tại, và chỉ hạ cấp khi lợi ích vượt chi phí với hệ số an toàn 1,2. Nâng cấp vì chất lượng luôn được phép. Khi cache đã nguội (quá `cacheTtlMinutes` không có turn, mặc định 5 phút) hoặc ngữ cảnh vừa bị nén, đổi model không mất chi phí ghi lại. Nếu ngữ cảnh gần đầy thì không đổi sang model khác. Người dùng tự đổi model hoặc effort bằng `/model` thì mod dừng điều phối luồng chính tới mục tiêu mới; sang mục tiêu mới, quyết định đổi model được so với model đang thực sự chạy, có tính chi phí ghi lại cache. Model được chọn mà không phản hồi (không có quyền, sai ID) thì mod quay về model của phiên ngay trong turn đó và tạm ngừng dùng họ model ấy; nếu lỗi ở hai turn liên tiếp thì họ model bị chặn 5 turn.

Nâng cấp theo bằng chứng, áp cho turn sau trong cùng mục tiêu: lặp cùng một lỗi ba lần, hoặc người dùng báo "vẫn sai", thì nâng độ sâu một bậc; vượt ngân sách tool call, hoặc có ba tool call lỗi trong một turn, thì nâng effort một bậc. Mức nâng reset khi sang mục tiêu mới.

**Phân việc trước khi làm.** Khi prompt có từ ba việc con trở lên, mod tách từng việc và chấm riêng độ sâu, khối lượng, bản chất của chính việc đó ngay lúc nhận prompt, không lấy theo cả prompt. Khối context liệt kê từng việc kèm model và effort đã chọn, và cách làm: `làm trực tiếp ở luồng chính` khi việc cùng họ model với luồng chính, hoặc `giao subagent <loại> <họ>/<effort>` khi việc nhẹ hơn. Việc con chỉ lấy từ chính lời người dùng: danh sách đánh số hoặc gạch đầu dòng, hoặc với prompt viết thành đoạn văn, các vế có động từ hành động tách theo câu, chấm phẩy và từ nối (sau đó, tiếp theo, cuối cùng, ngoài ra, then, finally). Khi bật `analyzer: model`, các việc Haiku trích sát từ lời người dùng được ưu tiên (việc nào không có trong prompt bị bỏ). Các bước Haiku tự lập kế hoạch chỉ dùng cho checklist, không thành việc con. Khi có Haiku, độ sâu của mỗi việc theo Haiku nhưng không thấp hơn sàn tín hiệu khó của chính việc đó. Chỉ tra cứu thuần (tìm, liệt kê, đọc) mới xuống haiku; việc rà soát, kiểm tra, gỡ lỗi, phân tích hay tìm lỗi chạy ít nhất sonnet. Việc mở đầu bằng tổng hợp, tóm tắt, kết luận hoặc báo cáo kết quả luôn làm trực tiếp ở luồng chính. Mục liệt kê là ràng buộc (mở đầu bằng không, chỉ, phải, giữ nguyên, must, only...) không thành việc con. Kể cả khi Claude tự chọn Explore, việc có phân tích vẫn chạy sonnet. Việc tra cứu chỉ đọc được giao Explore (haiku/low) khi engine đã mời agent này; nếu chưa mời thì nhãn là general-purpose với cùng model. Các việc đã tách không bị sàn độ sâu của mục tiêu cha kéo lên: mỗi việc dùng đánh giá của chính nó. Khi Claude gọi Agent cho một việc đã tách, mod nhận ra việc đó theo thứ tự: `description` dạng `Việc N: ...` hoặc `Task N: ...` (không nhận `Bước N` vì dễ trùng số bước của checklist), `description` cùng ý với tên việc, hoặc prompt của agent chứa phần lớn từ của tên việc; khi khớp, mod dùng đúng model đã ghi sẵn, không chấm lại từ prompt của agent. Với ít hơn ba việc con thì không phân việc, và việc đi theo cách cũ. Câu dẫn mở danh sách ("Làm 3 việc sau:") không bị coi là ràng buộc; khi nó là câu đầu, mục tiêu được ghép từ câu dẫn và tên các việc. Mục việc trong danh sách không bị coi là tiêu chí chất lượng. Chuỗi Haiku viết khác ngôn ngữ của yêu cầu (yêu cầu tiếng Việt mà Haiku trả tiếng Anh) bị bỏ, mod dùng bản đọc cục bộ thay thế. Dòng "làm trực tiếp" so với model luồng chính sẽ thật sự chạy, kể cả khi mod giữ model cũ để bảo toàn cache. Nếu luồng chính tự sửa file trong khi còn việc ghi "giao subagent" chưa có Agent nào nhận, mod nhắc một lần ngay trong kết quả tool đó (trừ khi file là kế hoạch của plan mode trong `.claude/plans/`), và cuối turn ghi cảnh báo chi phí lên pane.

**Prompt dài có cấu trúc (0.3.4).** Khi prompt chia mục có mã cùng cấp (`### K4.1`, `## Bước 2`, `## 3. ...`, `Task 3`), mỗi mục là một việc, và cần ít nhất ba mục như vậy. Mục có mã được chấm theo cả nội dung của mục, và Haiku chỉ được nâng độ sâu của mục đó, không hạ. Mục dưới tiêu đề "xong khi", "done when", "tiêu chí" hoặc "acceptance", và đoạn "Xong khi: ...", "Tiêu chí hoàn thành: ...", "Điều kiện xong: ..." trong thân một việc, là tiêu chí chất lượng, không phải việc hay ràng buộc. Tiêu chí không lặp lại câu mục tiêu, và không lấy câu nằm trong một mục việc. Tiêu đề bối cảnh, định nghĩa, phụ lục hay bằng chứng không thành việc. Câu tự nêu đích ("Đích là ...", "Mục tiêu là ...") là mục tiêu cuối, và không câu nào hay vế nào của nó lặp lại trong ràng buộc. Danh sách mở bằng câu có động từ sửa ("sửa / xử lý các lỗi sau:") thì mục chỉ mô tả lỗi được chấm là việc sửa; mục có động từ riêng giữ bản chất của nó. Tiêu đề cấp 1 duy nhất ở đầu tài liệu là tên tài liệu, không bị coi là một khối, trừ khi chính nó là tiêu đề khối ngắn như `# Bối cảnh`; tài liệu có nhiều tiêu đề cấp 1 thì mỗi tiêu đề là một khối. Tiêu đề tự có loại riêng (khối khác, hoặc gọi tên phần việc như "Việc cần làm") không kế thừa khối của tiêu đề cha; tiêu đề trung tính hoặc chỉ có mã thì kế thừa. Dòng bắt đầu bằng `#` trong khối code không phải tiêu đề. Một ngoặc chưa đóng chỉ ghép các vế trong cùng dòng. Haiku đọc tới 40.000 ký tự của yêu cầu (prompt dài có thêm token và thời gian để trả JSON trọn vẹn), và việc của Haiku được gửi theo đúng mục có mã.

**Prompt đính kèm chỉ để đối chiếu (0.3.4).** Khi dòng đầu của prompt nói không cần chạy prompt đính kèm (ví dụ "Không cần chạy prompt đính kèm, chỉ dùng để test việc điều phối"), phần đính kèm bên dưới chỉ được chấm phân việc để hiển thị: mục tiêu của lượt là đối chiếu, không có ràng buộc hay tiêu chí của phần đính kèm, không giao subagent, không nhắc giao việc, và Haiku chỉ đọc phần đính kèm. Câu mở phải nhắc tới "prompt" hoặc "đính kèm"; "không cần chạy test, chỉ sửa file bên dưới" là một yêu cầu thường.

Giới hạn của phân việc: các việc làm trực tiếp chạy ở model của luồng chính; mod không chặn được Claude tự làm, chỉ ghi sẵn lựa chọn, nhắc và cảnh báo.

Subagent: mỗi subagent là một hội thoại riêng, không có cache của luồng chính để mất. Hook `tool.call` trên tool `Agent` đánh giá prompt giao việc bằng luật cục bộ (không gọi Haiku cho từng agent, để không thêm độ trễ) và chọn model theo độ khó của việc con. Tra cứu chỉ đọc (Explore) được xuống haiku. Việc sửa code hoặc điều tra không thấp hơn một bậc so với độ sâu của mục tiêu cha. Nếu lần trước cùng việc đã lỗi, lần giao lại nâng một bậc. Model Claude tự chỉ định được giữ, trừ khi thấp hơn mức việc khó cần (mod nâng lên) hoặc vượt chính sách `sessionModel` (mod giới hạn lại); cả hai trường hợp đều ghi lý do vào nhật ký. Nhiều subagent chạy song song đều được điều phối độc lập. Khi một mục tiêu giao hơn sáu subagent, mod cảnh báo chi phí một lần (chỉ cảnh báo, không chặn).

Chi phí: mỗi lượt đã kết thúc được cộng vào sổ theo ba nhóm (luồng chính, subagent, phân tích prompt), theo phiên và theo mục tiêu, bằng token đo được từ engine. Chi phí ước tính lúc giao việc được thay bằng số đo khi subagent kết thúc, và số đo được gắn vào đúng dòng nhật ký của agent đó. Hệ số ước lượng được hiệu chỉnh theo số đo trong phiên. Sổ hiện trong pane và `/conductor status`. Hệ số chỉ được hiệu chỉnh từ turn mà mod thực sự áp model và effort (chế độ `auto`). Dòng "Chi phí cả phiên theo Claude Code" trong `/conductor status` là số engine báo cho toàn phiên, gồm cả các turn trước khi mod bắt đầu ghi sổ, nên có thể lớn hơn nhiều so với sổ của mod.

Chính sách model của phiên, tùy chọn `sessionModel`: `auto` (mặc định) mod tự chọn và báo một lần khi chọn model khác model của phiên; `ceiling` không bao giờ vượt model đang dùng; `fixed` giữ model của phiên và chỉ đổi effort. Áp cho cả luồng chính và subagent, kể cả subagent tra cứu và model Claude tự chỉ định.

**3. Giữ nhất quán.** Claude duy trì mục tiêu và checklist qua tool `mcp__focus-conductor__plan` (`set`, `add`, `update`). Trạng thái `verified` bắt buộc có bằng chứng kiểm tra, `skipped` và `blocked` bắt buộc có lý do. Trong turn, hook `tool.call` theo dõi mọi tool của luồng chính và gắn lời nhắc vào kết quả tool (không sửa system prompt, nên không ảnh hưởng cache) khi gặp các dấu hiệu sau: cùng lệnh lỗi ba lần (lặp), vượt ngân sách tool call theo độ khó (lan man), sửa file ngoài phạm vi khi prompt có giới hạn kiểu "chỉ sửa X" (lạc phạm vi), và năm thay đổi liên tiếp chưa chạy bước kiểm tra nào (checkpoint tự kiểm tra). Subagent không bị nhắc; cảnh báo của subagent chỉ hiện trên pane. Khi Claude định kết thúc một turn có thực thi mà checklist còn bước `todo` hoặc `doing`, hook `classic.Stop` yêu cầu hoàn thành hoặc ghi rõ lý do, tối đa một lần mỗi lần dừng; turn chỉ hỏi đáp không bị chặn. Một mục system prompt cố định nhắc năm nguyên tắc làm việc; nội dung không đổi giữa các turn để không phá cache.

**Giao diện.** Band phía trên prompt hiện mục tiêu, độ sâu và khối lượng, model đang chạy, tiến độ checklist và cảnh báo mới nhất, kèm nút Chi tiết và Ẩn. Pane "Focus Conductor" hiện mục tiêu, ràng buộc, tiêu chí chất lượng, checklist, quyết định điều phối, chi phí ước tính và đo được, nhật ký điều phối và cảnh báo, kèm nút đổi chế độ. Status line dưới prompt có dạng `focus-conductor: complex · opus/high · 2/5` (nhãn cũ suy ra từ độ sâu và khối lượng).

## Cài đặt

Mọi lệnh bắt đầu bằng `/` trong phần này gõ ở prompt của Claude Code (mở bằng lệnh `claude`), không gõ ở terminal zsh hay bash; terminal sẽ báo `no such file or directory: /plugin`. Mod được viết và kiểm tra trên Claude Code 2.1.295.

### Cài từ marketplace (khuyến nghị)

1. Mở Claude Code: gõ `claude` ở terminal.
2. Gõ lệnh cài:

   ```
   /plugin install focus-conductor --marketplace kiettt96/KietTranData
   ```

3. Hộp thoại "Add marketplace?" hiện ra: bấm `y`.
4. Màn hình chi tiết plugin: chọn "Install for you (user scope)" để mọi phiên trên máy đều có mod.
5. Khởi động lại Claude Code: `/exit`, rồi `claude`.

Marketplace được lưu dưới tên `kiettrandata` (tên khai báo trong `.claude-plugin/marketplace.json`), không phải tên repository; các lệnh cập nhật bên dưới dùng tên này. Marketplace chỉ đọc nhánh mặc định `main`, nên thay đổi nằm trên nhánh khác chưa cài được cho tới khi merge.

### Kiểm tra đã cài đúng

- Gõ `/plugin`, chọn tab Installed, chọn `focus-conductor`: Version khớp `version` trong `.claude-plugin/plugin.json`, Status là Enabled.
- Status line dưới prompt có dòng `focus-conductor: auto`.
- Gõ `/conductor`: pane Focus Conductor mở ra.

### Cập nhật lên bản mới

```
/plugin marketplace update kiettrandata
/plugin update focus-conductor@kiettrandata
```

Sau đó khởi động lại Claude Code (`/exit`, rồi `claude`); bản mới chỉ có hiệu lực sau bước này. Thay cho lệnh đầu, có thể vào `/plugin`, tab Marketplaces, chọn `kiettrandata` rồi bấm `u`.

### Chạy từ mã nguồn, không qua marketplace

```bash
git clone https://github.com/kiettt96/KietTranData.git
claude --plugin-dir KietTranData/claude-mods/focus-conductor
```

Mod chỉ nạp cho phiên mở bằng lệnh này và tự nạp lại khi sửa file, hợp cho lúc phát triển. Muốn mọi phiên đều nạp (kể cả phiên do desktop app mở), khai báo đường dẫn tuyệt đối trong `~/.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/đường/dẫn/tuyệt/đối/KietTranData/claude-mods/focus-conductor" } }
```

### Tắt hoặc gỡ

`/conductor mode off` tắt mod trong phiên hiện tại. Tắt hẳn hoặc gỡ: `/plugin`, tab Installed, chọn `focus-conductor`, rồi "Disable plugin" hoặc "Uninstall".

### Lỗi thường gặp

| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| `zsh: no such file or directory: /plugin` | Gõ lệnh ở terminal thay vì trong Claude Code | Gõ `claude` trước, rồi gõ lệnh ở prompt của Claude Code |
| `Marketplace file not found at .../marketplace.json` | `main` chưa có `.claude-plugin/marketplace.json` | Merge nhánh chứa mod vào `main`, rồi `/plugin marketplace update kiettrandata` |
| `/focus` báo "Focus view enabled" | `/focus` là lệnh có sẵn của Claude Code, không phải lệnh của mod | Dùng `/conductor`; gõ `/focus` thêm lần nữa để tắt Focus view |
| Lệnh cập nhật không tìm thấy marketplace | Dùng tên repository thay cho tên marketplace | Dùng `kiettrandata` |
| Đã cập nhật mà hành vi chưa đổi | Chưa khởi động lại | `/exit`, rồi `claude`; kiểm tra lại Version trong tab Installed |

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
| `analyzer` | `model` | `model` dùng thêm Haiku cho mục tiêu mới và bước tinh chỉnh từ 6 từ; `heuristic` chỉ phân tích cục bộ |
| `enforceChecklist` | `true` | Chặn kết thúc khi checklist còn bước mở |
| `allowFable` | `false` | Việc khó nhất (độ sâu `hard`) dùng Fable thay cho Opus |
| `sessionModel` | `auto` | `auto` mod tự chọn model; `ceiling` không vượt model của phiên; `fixed` giữ model của phiên, chỉ đổi effort |
| `contextWindows` | trống | Cửa sổ ngữ cảnh theo họ model, dạng `opus=1000000,sonnet=1000000`; khi có, mod không đổi sang model có cửa sổ nhỏ hơn ngữ cảnh hiện tại, kể cả khi nâng cấp |
| `cacheTtlMinutes` | `5` | Sau bao nhiêu phút không có turn thì cache coi như nguội, khi đó đổi model không mất chi phí ghi lại |
| `modelMap` | rỗng | Ghi đè model ID, ví dụ `opus=claude-opus-5-5,sonnet=claude-sonnet-5-5` (cần khi dùng gateway có ID riêng) |

## Cấu trúc

```
focus-conductor/
  .claude-plugin/plugin.json   manifest, userConfig, đường dẫn type contract
  hooks/hooks.json             khai báo module hooks
  hooks/register.tsx           nối hook; mọi lệnh gọi $ nằm ở đây
  hooks/lib/analyze.ts         đọc prompt, đánh giá việc (độ sâu, khối lượng, bản chất), gộp kết quả Haiku
  hooks/lib/scale.ts           thang độ sâu, khối lượng, quan hệ tiếp nối, tier cũ
  hooks/lib/payload.ts         tách code, log và dữ liệu dán vào khỏi yêu cầu
  hooks/lib/cost.ts            giá token, chi phí turn, chi phí ghi lại cache, điểm hòa vốn
  hooks/lib/ledger.ts          sổ chi phí theo nhóm, phiên và mục tiêu; hiệu chỉnh ước lượng
  hooks/lib/route.ts           chính sách model và effort, quyết định đổi có tính cache, chọn model subagent
  hooks/lib/drift.ts           phát hiện lặp, lan man, lạc phạm vi, checkpoint
  hooks/lib/plan.ts            schema và reducer của tool plan
  hooks/lib/state.ts           giá trị khởi tạo, chuẩn hóa trạng thái cũ và reducer thuần cho $.state
  hooks/lib/text.ts            mọi văn bản gửi model và hiển thị
  hooks/ui/band.tsx            band phía trên prompt
  hooks/ui/pane.tsx            pane chi tiết
  types/index.d.ts             type contract của $.state
  tests/                       logic thuần, chi phí và sổ, bộ đánh giá điều phối, test tích hợp qua engine
  tests/fixtures/prompt-k4.ts  prompt dài thật dùng làm bộ hồi quy cho việc tách việc và câu mở đính kèm
```

Kiểm tra trước khi phát hành: `claude plugin validate .` và `claude plugin test .` (182 test).

## Giới hạn đã biết

- Tách việc trong prompt đoạn văn bằng luật cục bộ dựa vào câu, chấm phẩy và từ nối; một đoạn văn liền không có các dấu đó thì cần `analyzer: model` để tách.
- Mục có mã chỉ được nhận khi có ít nhất ba mục cùng cấp; prompt có hai mục thì theo danh sách như cũ.
- Prompt đính kèm chỉ được nhận khi dòng đầu nói không chạy và có chữ "prompt" hoặc "đính kèm", và phần đính kèm có ít nhất ba dòng; cách viết khác thì bị coi là một yêu cầu thường.
- Đánh giá việc là luật heuristic theo từ khóa tiếng Việt và tiếng Anh. Prompt ngắn mà khó có thể bị lệch nếu không chạm từ khóa nào; khi đó bật `analyzer: model` hoặc đặt lại bằng `/conductor goal`.
- Bộ đánh giá điều phối (`tests/routing-eval.test.ts`) có nhãn do tác giả đặt, và luật được chỉnh sau lần chạy đầu. Đây là kiểm tra nhất quán, không phải số đo độc lập; cần một bộ prompt thật tách riêng để đo chất lượng.
- Giá dùng để tính là bảng Claude API ghi nhận 2026-10. Đọc cache của Haiku là giả định (10% giá vào). Engine không cho biết cửa sổ ngữ cảnh của model khác họ: khai báo `contextWindows` để mod kiểm tra cả khi nâng cấp; để trống thì cửa sổ được giả định bằng cửa sổ của phiên và chỉ kiểm tra khi hạ cấp. Phần cố định của ngữ cảnh (system prompt, tools, bộ nhớ) được đo một lần ở đầu phiên từ bảng phân tích ngữ cảnh của engine (chế độ ước lượng cục bộ, không tốn request) và hiện trong `/conductor status`; khi engine không trả bảng này, dùng giả định 20k token. Kích thước turn ước lượng (số bước, token vào mới, token ra) là giả định, được hiệu chỉnh dần từ số đo trong phiên.
- Chi phí của một lượt chỉ là số đo khi lượt đó kết thúc; trong lúc chạy, sổ hiện con số ước lượng.
- Mod không đọc được nội dung suy luận của model nên phát hiện lạc đề dựa trên hành vi gọi tool, không dựa trên ngữ nghĩa từng câu trả lời.
- Một họ model lỗi (không phản hồi) ở một turn thì turn đó quay về model của phiên; lỗi ở hai turn liên tiếp thì bị tạm ngừng dùng 5 turn rồi thử lại.
- Khi engine tự đổi model (fallback do bị từ chối hoặc quá tải), mod không phân biệt được với việc người dùng tự đổi bằng `/model`, nên tạm ngừng tự điều phối luồng chính tới mục tiêu mới.
- Khi Claude chốt lại mục tiêu bằng tool `plan` (action `set`), phạm vi file được phép sửa lấy từ prompt trước vẫn được giữ; dùng `/conductor reset` nếu phạm vi đó không còn đúng.
- Prompt bị xếp nhầm là mục tiêu mới thì checklist cũ bị bỏ; mod báo cho Claude số bước còn mở để lập lại nếu thực ra là tiếp nối.
- Số đo chi phí của subagent chỉ đến khi engine gửi `turn.complete` của agent đó; agent được khởi động ngoài đường `tool.call` Agent không có dự báo và không gắn được với quyết định điều phối.
