# focus-conductor

Mod cho Claude Code thực thi ba nguyên tắc: đọc kỹ prompt trước khi làm, điều phối model / effort / agent cho từng việc ngay từ đầu, và giữ nhất quán với mục tiêu cuối trong suốt phiên. Từ 0.4.0, việc đọc prompt và quyết định điều phối do một model Claude (router) làm; code của mod chỉ kiểm, ép và quay về an toàn. Bản 0.5.0 xử lý các điểm của một lượt đánh giá độc lập, sau khi kiểm từng điểm trên code (xem [Thay đổi 0.5.0](#thay-đổi-050-theo-đánh-giá)).

## Cách hoạt động

**1. Một model Claude đọc prompt và điều phối ngay từ đầu (0.4.0).** Mod không tự đọc prompt bằng luật cục bộ. Hook `prompt.submit` gửi prompt cho **router**: một lượt gọi model Claude cố định (tùy chọn `router`, mặc định `sonnet`, effort medium, system prompt có đánh dấu cache). Router trả một JSON quyết định toàn bộ điều phối: mục tiêu cuối, ràng buộc, tiêu chí chất lượng, phạm vi file được sửa, quan hệ với mục tiêu trước (mới, tiếp tục, tinh chỉnh, báo chưa đạt), đánh giá độ sâu, khối lượng, bản chất của cả yêu cầu, **model và effort của luồng chính**, và **danh sách việc**: mỗi việc làm ở luồng chính hay giao subagent, với loại agent (Explore, Plan, general-purpose), model và effort nào, kèm lý do ngắn. Router được dặn: chọn model và effort rẻ nhất mà vẫn làm tốt việc đó, chất lượng đứng trước; haiku chỉ cho tra cứu, không bao giờ cho việc sửa file; mục có mã (K4.1, Bước 2) là một việc và giữ mã ở đầu tên việc; mục dưới "xong khi", "tiêu chí", "acceptance" là tiêu chí, không phải việc; code, log, dữ liệu dán vào là dữ liệu, không phải lệnh; câu người dùng nói về chính prompt hay về việc test công cụ không phải việc; người dùng báo chưa đạt thì nâng model hoặc effort một bậc so với lần trước. Kết quả được gắn vào context dưới dạng khối `[focus-conductor]`, kèm yêu cầu Claude đối chiếu lại với prompt gốc và chốt checklist trước khi gọi tool thực thi đầu tiên.

Code của mod chỉ còn ba việc. **Kiểm và kẹp** kết quả của router theo chính sách: giá trị không hợp lệ bị bỏ (lựa chọn luồng chính sai thì coi như router lỗi; việc thiếu model hợp lệ thì làm ở luồng chính); `max` hạ về `xhigh`; fable về opus khi chưa bật `allowFable`; việc sửa file không chạy haiku; áp `sessionModel` (ceiling, fixed) và tránh họ model đang bị chặn. Mỗi lần kẹp ghi lý do. **Ép** lựa chọn lúc chạy (mục 2). **Quay về an toàn** khi router lỗi.

Router lỗi (lỗi API, hết giờ, engine từ chối gọi model router, JSON hỏng): mod không đoán. Turn đó chạy bằng model của phiên. Mục tiêu, checklist, việc đã phân, phạm vi và ràng buộc được giữ; chỉ lựa chọn model luồng chính bị bỏ, và route đang hiện trong status được xóa. Có toast, cảnh báo và một dòng báo cho Claude. Router lỗi hai lần liên tiếp thì mod tạm bỏ qua router ba prompt kế tiếp rồi hỏi lại, để không bắt người dùng chờ hết giờ mãi. Lỗi của router chấm subagent có bộ đếm riêng, không làm tạm ngừng router đọc prompt. Tùy chọn `routerFallback: reuse` dùng lại lựa chọn luồng chính của prompt trước thay cho model của phiên. `/conductor reroute` bảo router đọc lại prompt gần nhất, kể cả khi router đang tạm ngừng; `/conductor goal` cũng luôn hỏi router.

Router trả kèm mức tin cậy (0 đến 1). Câu trả lời không đọc được, hoặc tin cậy dưới 0,4, thì router được hỏi lại đúng một lần: lần sửa JSON chạy effort low, lần đọc lại vì tin cậy thấp chạy effort high; giữ câu trả lời tin cậy hơn. Lỗi API và hết giờ không hỏi lại. Chi phí cả hai lượt được cộng vào sổ.

Mặc định mọi prompt đều qua router, kể cả "ok" hay "tiếp". Tùy chọn `routerSkip` liệt kê các câu tiếp nối ngắn (ví dụ `ok,tiếp,tiếp tục`): prompt trùng nguyên câu (không phân biệt hoa thường, bỏ dấu câu cuối) và đã có mục tiêu thì giữ nguyên phân việc và điều phối, không gọi router. Mod không dùng luật độ dài hay đoán ý để bỏ qua router, vì câu một từ như "sai" hay "chạy" có thể đổi hẳn điều phối.

Prompt tiếp nối: router thấy mục tiêu trước, các việc đã phân và model luồng chính đã thật sự chạy. Mục tiêu và phần giao còn chờ được giữ; việc mới router tách thêm được đánh số tiếp theo và vào phần chờ giao; lựa chọn luồng chính theo router. Mỗi lần router quyết lại, mức nâng theo bằng chứng của prompt trước về 0, vì router đã tự nâng khi người dùng báo chưa đạt. Việc đánh số tiếp theo cả khi có lượt router lỗi xen giữa, nên không trùng số việc cũ.

**Prompt đính kèm chỉ để đối chiếu.** Khi người dùng nói prompt đính kèm không cần chạy, chỉ dùng để test hay đối chiếu điều phối, router đánh dấu `reference`: mục tiêu của lượt là phần đối chiếu, các việc của prompt đính kèm được điều phối như khi chạy thật nhưng chỉ để hiển thị (kèm luồng chính mà prompt đó cần), không hiển thị ràng buộc hay tiêu chí của prompt đính kèm, không giao subagent, không nhắc giao việc. Sau đó người dùng bảo chạy thật (router đánh dấu `runReference`, kể cả khi relation là `new`) thì các việc đã đối chiếu thành việc thật của một mục tiêu mới, cùng ràng buộc và tiêu chí của prompt đính kèm, và được theo dõi giao việc.

**2. Ép điều phối lúc chạy.** Luồng chính chốt model và effort router chọn ở step đầu của mỗi turn và giữ nguyên cho mọi step trong turn, vì prompt cache gắn với từng model và đổi effort cũng làm mất cache phần messages. Không dùng `max`.

Đổi giữa các turn được tính bằng chi phí token. Nâng cấp luôn được áp. Hạ cấp chỉ được áp khi lợi ích tiết kiệm trong các turn còn lại vượt chi phí ghi lại cache của ngữ cảnh hiện tại với hệ số an toàn 1,2; nếu không, mod giữ model cũ và ghi lý do, và khối context ghi đúng model sẽ thật sự chạy. Khi cache đã nguội (quá `cacheTtlMinutes` không có turn, mặc định 5 phút) hoặc ngữ cảnh vừa bị nén, đổi model không mất chi phí ghi lại. Nếu ngữ cảnh gần đầy thì không đổi sang model khác. Người dùng tự đổi model hoặc effort bằng `/model` thì mod dừng điều phối luồng chính tới mục tiêu mới. Engine tự đổi model của phiên (hook `classic.PostModelSwitch` với `source` là `auto`, như khi quá tải, hoặc `resume`) không phải lựa chọn của người dùng: mod vẫn điều phối và ghi nhật ký. Khi engine không báo nguồn, mọi lần đổi giữa hai turn được coi là người dùng đổi, như trước. Model được chọn mà không phản hồi (không có quyền, sai ID) thì mod quay về model của phiên ngay trong turn đó; lỗi ở hai turn liên tiếp thì họ model bị chặn 5 turn.

Nâng theo bằng chứng trong cùng một prompt: lặp cùng một lỗi ba lần thì turn sau nâng họ model một bậc; vượt ngân sách tool call, hoặc có ba tool call lỗi trong một turn, thì nâng effort một bậc.

**Phân việc.** Khối context liệt kê từng việc kèm cách làm: `làm trực tiếp ở luồng chính (<model sẽ chạy>)` hoặc `giao <loại agent> <họ>/<effort>`. Khi Claude gọi Agent cho một việc đã phân, code của mod nhận ra việc đó chỉ theo cấu trúc: `description` mở đầu bằng `Việc N`, `Task N` hoặc `Task #N` (không nhận `Bước N` vì dễ trùng số bước của checklist), hoặc cùng mã mục với tên việc (so nguyên mã, để K4.1 không khớp K4.10). Code không đoán theo ý. Lời gọi không khớp được router chấm như một subagent; router nhận danh sách việc của mục tiêu và cho biết lời gọi đó có phải một trong số đó không (trường `task`). Nếu phải, mod dùng lựa chọn đã phân và coi việc đó đã giao. Lời gọi trượt mà có dấu hiệu nhắm một việc (`Bước N`, số việc không tồn tại, tên gần giống) được ghi vào log quyết định để chỉnh dần. Khi khớp, mod dùng đúng model, effort và loại agent router đã phân, không hỏi router lần nữa, kể cả khi Claude tự ghi model khác (có ghi nhật ký). Loại agent chỉ được đổi khi Claude để general-purpose và engine đã mời loại router chọn. Nếu luồng chính tự sửa file trong khi còn việc ghi giao subagent chưa có Agent nào nhận, mod nhắc một lần ngay trong kết quả tool đó (trừ file kế hoạch của plan mode trong `.claude/plans/`), và cuối turn ghi cảnh báo chi phí lên pane. Tùy chọn `strictDelegation` siết việc này: `remind` nhắc ở mọi lần thay đổi, kể cả lệnh Bash ghi file; `block` từ chối Edit, Write, NotebookEdit của luồng chính tối đa hai lần mỗi mục tiêu, sau đó chỉ nhắc, để không kẹt khi việc không giao được.

**Subagent ngoài phân việc.** Agent Claude tự giao (không khớp việc đã phân), agent gọi từ trong một subagent, và agent của workflow mà script không chọn model đều được router chấm khi giao (effort low, tối đa 20 giây): router nhận mục tiêu của phiên, mô tả và prompt của việc, model và loại agent Claude gợi ý, agent cha nếu có, và danh sách agent đã lỗi trong mục tiêu này (giao lại việc đã lỗi thì router tự nâng một bậc). Kết quả chấm được nhớ theo mô tả và prompt trong phiên, nên workflow lặp lại cùng một việc chỉ hỏi router một lần; mỗi lần dùng lại, kết quả được kiểm theo model của phiên hiện tại. Việc vừa lỗi trong mục tiêu thì được hỏi lại. Router lỗi khi chấm thì giữ nguyên lựa chọn của Claude và ghi lý do. Model Claude ghi không thuộc họ Claude thì cho qua nguyên vẹn. Danh mục loại agent gửi cho router gồm Explore, Plan, general-purpose, các loại engine đang mời (`agent.offer`, kèm mô tả) và các loại khai trong tùy chọn `agentTypes`. Agent engine báo đã khởi động (`classic.SubagentStart`) mà không đi qua `agent.spawn` của mod được `/conductor status` ghi là agent ngoài điều phối (untracked).

Mỗi request của từng subagent được ép về đúng model và effort đã điều phối (chế độ `auto` và `subagents`), kể cả khi nhiều subagent chạy song song. Với agent của workflow, router chấm xong trước khi agent khởi động, và điều phối được ghi ngay khi engine trả về, trước mọi bước khác; nếu engine vẫn chạy bước đầu của agent trước khi mod kịp ghi, agent đó không bị ép ở các bước sau (đổi giữa chừng phá cache của nó), và nhật ký ghi rõ. Agent workflow có model do script chọn được giữ nguyên. Nếu engine khởi động subagent ở họ model khác họ đã điều phối, mod ghi nhật ký và cảnh báo `engine chạy X thay vì Y`. Nếu model được ép không phản hồi, agent đó quay về model của engine và ngừng bị ép. Chi phí của subagent được hiệu chỉnh theo effort thật engine đã gửi. Khi một mục tiêu giao hơn sáu subagent, mod cảnh báo chi phí một lần (chỉ cảnh báo, không chặn).

Chi phí: mỗi lượt đã kết thúc được cộng vào sổ theo ba nhóm (luồng chính, subagent, router), theo phiên và theo mục tiêu, bằng token đo được từ engine. Chi phí ước tính lúc giao việc được thay bằng số đo khi subagent kết thúc, và số đo được gắn vào đúng dòng nhật ký của agent đó. Hệ số ước lượng được hiệu chỉnh theo số đo trong phiên. Sổ hiện trong pane và `/conductor status`. Hệ số chỉ được hiệu chỉnh từ turn mà mod thực sự áp model và effort (chế độ `auto`), và từ subagent có kết quả chấm của router. Token ra đo được còn được ghi theo dạng việc (độ sâu, khối lượng, bản chất), quy về effort medium; khi một dạng việc có từ ba lần đo, ước lượng chi phí lúc giao việc dùng số đo đó thay cho giả định. Chi phí router được tính theo đúng họ model của router. Dòng "Chi phí cả phiên theo Claude Code" trong `/conductor status` là số engine báo cho toàn phiên, gồm cả các turn trước khi mod bắt đầu ghi sổ, nên có thể lớn hơn nhiều so với sổ của mod.

Chính sách model của phiên, tùy chọn `sessionModel`: `auto` (mặc định) mod tự chọn và báo một lần khi chọn model khác model của phiên; `ceiling` không bao giờ vượt model đang dùng; `fixed` giữ model của phiên và chỉ đổi effort. Áp cho cả luồng chính và subagent (kể cả ở chế độ `subagents`, nơi luồng chính không đổi), và được báo cho router để nó chỉ chọn trong các model được phép.

**3. Giữ nhất quán.** Claude duy trì mục tiêu và checklist qua tool `mcp__focus-conductor__plan` (`set`, `add`, `update`, `restore`). `set` nhận thêm `scope` để đặt lại phạm vi file được sửa (mảng rỗng là bỏ giới hạn). Trạng thái `verified` bắt buộc có bằng chứng kiểm tra; bằng chứng phải nhắc một lệnh hay file đã thật sự chạy trong mục tiêu (ví dụ `npm test: 12 pass`), nếu không thì bước vẫn được ghi nhưng chưa tính là đã kiểm tra, kèm cảnh báo. `skipped` và `blocked` bắt buộc có lý do.

Khi router xếp một prompt là mục tiêu mới mà checklist cũ còn bước mở, checklist đó được cất (tối đa ba mục tiêu), không bị xóa. Claude khôi phục bằng `restore` (`index` 1 là gần nhất), trạng thái từng bước giữ nguyên. Router thiếu hoặc ghi sai quan hệ với mục tiêu trước thì mod coi là tiếp nối, không lập mục tiêu mới. Trong turn, hook `tool.call` theo dõi mọi tool của luồng chính và gắn lời nhắc vào kết quả tool. Lệnh Bash chỉ đọc (tìm kiếm, xem, `git status`, `sed -n`) không được tính là thay đổi; lệnh có chuyển hướng ghi, `sed -i`, `rm`, hay lệnh git ghi thì được tính. Ghi file kế hoạch của plan mode (`.claude/plans/*.md`) không được tính là thay đổi và không bị kiểm phạm vi (không sửa system prompt, nên không ảnh hưởng cache) khi gặp các dấu hiệu sau: cùng lệnh lỗi ba lần (lặp), vượt ngân sách tool call theo độ khó (lan man), sửa file ngoài phạm vi khi prompt có giới hạn kiểu "chỉ sửa X" (lạc phạm vi), và năm thay đổi liên tiếp chưa chạy bước kiểm tra nào (checkpoint tự kiểm tra, chỉ báo đúng lúc đếm đến bội số của năm). Mặc định subagent không bị nhắc; cảnh báo của subagent chỉ hiện trên pane. Tùy chọn `remindSubagents` nhắc subagent đã điều phối khi nó sửa file ngoài phạm vi, lặp lỗi hay vượt ngân sách, kèm việc nó được giao. Tùy chọn `semanticDrift` thêm kiểm lạc đề theo nội dung: ở mỗi checkpoint, router đọc mục tiêu, các bước còn mở và các lệnh, file gần đây; nếu thấy lệch mục tiêu thì nhắc Claude ngay trong kết quả tool và ghi cảnh báo. Khi Claude định kết thúc một turn có thực thi mà checklist còn bước `todo` hoặc `doing`, hook `classic.Stop` yêu cầu hoàn thành hoặc ghi rõ lý do, tối đa một lần mỗi lần dừng; turn chỉ hỏi đáp không bị chặn. Một mục system prompt cố định nhắc năm nguyên tắc làm việc; nội dung không đổi giữa các turn để không phá cache.

**Giao diện.** Band phía trên prompt hiện mục tiêu, độ sâu và khối lượng, model đang chạy, tiến độ checklist và cảnh báo mới nhất, kèm nút Chi tiết và Ẩn. Pane "Focus Conductor" hiện mục tiêu kèm lý do của router, ràng buộc, tiêu chí chất lượng, checklist, quyết định điều phối, chi phí ước tính và đo được, nhật ký điều phối và cảnh báo, kèm nút đổi chế độ. Status line dưới prompt có dạng `focus-conductor: complex · opus/high · 2/5` (nhãn cũ suy ra từ độ sâu và khối lượng). Tùy chọn `uiLanguage: en` đổi nhãn cố định của band và pane sang tiếng Anh; nội dung của router, cảnh báo và khối gửi Claude giữ nguyên ngôn ngữ của chúng.

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
| `/conductor status` | Tóm tắt chế độ, route luồng chính, model bị tạm ngừng, checklist, chi phí, ngày bảng giá, agent ngoài điều phối |
| `/conductor mode auto\|subagents\|suggest\|off` | Đổi chế độ trong phiên |
| `/conductor goal <mô tả>` | Đặt mục tiêu thủ công qua router (luôn là mục tiêu mới; Claude nhận bản đọc qua context) |
| `/conductor reroute` | Router đọc lại prompt gần nhất (kể cả khi đang tạm ngừng); giữ mục tiêu và checklist |
| `/conductor reset` | Xóa mục tiêu, checklist, cảnh báo, danh sách model bị tạm ngừng |

Cấu hình qua `/config` (hoặc `pluginConfigs.focus-conductor.options` trong settings):

| Trường | Mặc định | Ý nghĩa |
|---|---|---|
| `routing` | `auto` | `auto` điều phối cả luồng chính và subagent; `subagents` chỉ subagent, giữ nguyên model luồng chính (an toàn nhất cho cache); `suggest` chỉ hiển thị đề xuất (ở `suggest` và `subagents`, luồng chính trong khối context ghi là `(chỉ đề xuất)`); `off` tắt toàn bộ mod |
| `router` | `sonnet` | Model Claude đọc prompt và điều phối: alias (`haiku`, `sonnet`, `opus`) hoặc model ID. Thay cho tùy chọn `analyzer` của bản 0.3 |
| `enforceChecklist` | `true` | Chặn kết thúc khi checklist còn bước mở |
| `allowFable` | `false` | Cho router dùng Fable cho việc khó nhất; tắt thì lựa chọn fable bị kẹp về opus |
| `sessionModel` | `auto` | `auto` mod tự chọn model; `ceiling` không vượt model của phiên; `fixed` giữ model của phiên, chỉ đổi effort |
| `contextWindows` | trống | Cửa sổ ngữ cảnh theo họ model, dạng `opus=1000000,sonnet=1000000`; mod không đổi sang model có cửa sổ nhỏ hơn ngữ cảnh hiện tại, kể cả khi nâng cấp. Để trống thì họ dùng model ID mặc định của mod lấy 1M token [Nguồn: bảng model Claude 2026-10-06]; họ bị `modelMap` đổi ID thì cần khai ở đây |
| `cacheTtlMinutes` | `5` | Sau bao nhiêu phút không có turn thì cache coi như nguội, khi đó đổi model không mất chi phí ghi lại |
| `modelMap` | rỗng | Ghi đè model ID, ví dụ `opus=claude-opus-5-5,sonnet=claude-sonnet-5-5` (cần khi dùng gateway có ID riêng) |
| `routerSkip` | trống | Câu tiếp nối ngắn không cần hỏi router, phân tách bằng dấu phẩy |
| `routerFallback` | `session` | Khi router lỗi: `session` chạy theo model của phiên; `reuse` dùng lại lựa chọn luồng chính của prompt trước |
| `strictDelegation` | `off` | `off` nhắc một lần; `remind` nhắc ở mọi lần thay đổi; `block` từ chối luồng chính sửa file khi còn việc chưa giao (tối đa hai lần mỗi mục tiêu) |
| `remindSubagents` | `false` | Nhắc subagent lạc đề kèm việc được giao |
| `semanticDrift` | `false` | Router kiểm lạc đề theo nội dung ở mỗi checkpoint (thêm một lượt router mỗi lần) |
| `decisionLog` | trống | Đường dẫn file JSONL ghi mỗi quyết định điều phối (router đọc prompt, router lỗi, bỏ qua router, chấm subagent, đổi model, lạc đề), nối tiếp qua các phiên, giữ 500 dòng cuối |
| `agentTypes` | trống | Loại agent thêm cho router, phân tách bằng dấu phẩy |
| `prices` | trống | Ghi đè bảng giá, dạng `sonnet=2/10` hoặc `opus=4/20/0.2` (vào/ra/đọc cache, USD mỗi 1M token) |
| `uiLanguage` | `vi` | `vi` hoặc `en` cho nhãn của band và pane |

## Cấu trúc

```
focus-conductor/
  .claude-plugin/plugin.json   manifest, userConfig, đường dẫn type contract
  hooks/hooks.json             khai báo module hooks
  hooks/register.tsx           điểm vào: dựng ngữ cảnh, đăng ký các nhóm hook theo thứ tự
  hooks/context.ts             hằng số, tùy chọn đã đọc, trạng thái tạm và hàm thuần dùng chung (không gọi $)
  hooks/atoms.ts               hàm gộp cho derive (view, mode)
  hooks/parts/session.ts       session.start/end, mục system prompt cố định, prompt.submit (router đọc prompt)
  hooks/parts/turn.ts          turn.start, turn.step: ép model và effort cho luồng chính và subagent
  hooks/parts/agents.ts        agent ngoài điều phối, nguồn đổi model, agent.offer, lời gọi Agent, agent.spawn
  hooks/parts/consistency.ts   tool plan, theo dõi mọi tool, chặn kết thúc, cộng chi phí đo được
  hooks/parts/command.ts       lệnh /conductor
  hooks/parts/ui.tsx           band và pane
  hooks/lib/router.ts          system prompt và request của router, đọc JSON trả về, kẹp theo chính sách, hỏi lại một lần
  hooks/lib/decisions.ts       dòng log quyết định JSONL
  hooks/lib/scale.ts           nhãn độ sâu, khối lượng, bản chất, quan hệ; tier cũ
  hooks/lib/cost.ts            bảng giá có ngày, ghi đè giá, cửa sổ mặc định, chi phí turn và ghi lại cache
  hooks/lib/ledger.ts          sổ chi phí theo nhóm, phiên và mục tiêu; hiệu chỉnh; token ra theo dạng việc
  hooks/lib/route.ts           chính sách model của phiên, nâng theo bằng chứng, quyết định đổi có tính cache, khớp việc đã phân
  hooks/lib/drift.ts           phát hiện lặp, lan man, lạc phạm vi, checkpoint; đối chiếu evidence
  hooks/lib/plan.ts            schema và reducer của tool plan
  hooks/lib/state.ts           giá trị khởi tạo, chuẩn hóa trạng thái cũ, reducer thuần, cất và khôi phục mục tiêu
  hooks/lib/text.ts            mọi văn bản gửi model và hiển thị
  hooks/ui/band.tsx            band phía trên prompt
  hooks/ui/pane.tsx            pane chi tiết
  hooks/ui/labels.ts           nhãn vi/en của band và pane
  types/index.d.ts             type contract của $.state
  tests/                       logic thuần, router, chi phí và sổ, test tích hợp qua engine (router giả lập), kịch bản đầu cuối
  tests/golden/                golden-set của router: 16 prompt mẫu, kỳ vọng, câu trả lời router thật đã ghi
  tests/fixtures/prompt-k4.ts  prompt dài thật, dùng để kiểm request gửi router và phân việc nhiều mục
  scripts/eval-router.ts       eval router thật trên golden-set (không chạy trong CI)
```

Kiểm tra trước khi phát hành: `claude plugin validate .` và `claude plugin test .` (228 test, gồm replay offline golden-set). Đổi prompt router thì chạy lại `bun scripts/eval-router.ts --model sonnet --record` để chấm router thật và ghi câu trả lời mới cho golden-set.

## Giới hạn đã biết

- Mỗi prompt thêm một lượt gọi model router trước khi Claude bắt đầu làm (trừ câu trong `routerSkip`). Đo bằng `scripts/eval-router.ts` với router `sonnet`, ngày 2026-10-10, 16 ca [Nguồn: eval trong phiên phát triển]: prompt ngắn và vừa 5 đến 9 giây, dưới $0,04 mỗi lượt; prompt cỡ K4 (37.000 ký tự, 14 mục) khoảng 14 giây và khoảng $0,10. Router `haiku` trên cùng bộ đạt 14 đến 15/16 ca qua ba lần chạy, và trượt ở chỗ khác nhau mỗi lần: ca K4 đối chiếu (không tách việc nào, hoặc xếp bản chất là mixed) và ca sáu việc (luồng chính sonnet thay vì opus). Vì vậy `sonnet` vẫn là mặc định.
- Đính chính so với README 0.4.0: lượt eval trước đó bị chính mod (bản phát triển đang bật trên máy) điều phối lại request của router, nên model thật sự trả lời khác model yêu cầu. Script eval giờ chạy mỗi lượt với `CLAUDE_CONFIG_DIR` riêng và in model thật sự trả lời; số liệu ở mục trên là của lượt đã tách.
- Chất lượng điều phối phụ thuộc model router. Code chỉ kẹp theo chính sách, không sửa phán đoán của router. Golden-set chấm theo khoảng chấp nhận được (họ model, số việc, quan hệ), không theo một câu trả lời duy nhất; đây là kiểm tra trong phiên phát triển, không phải số đo độc lập.
- Router lỗi thì prompt đó không được điều phối (trừ khi bật `routerFallback: reuse`); mod không có phương án đoán thay. Dùng `/conductor reroute` khi router đã ổn lại.
- Mod không chặn hẳn Claude tự làm việc đã ghi giao subagent: `strictDelegation: block` chỉ từ chối tối đa hai lần mỗi mục tiêu rồi chuyển sang nhắc.
- Kiểm `verified` là kiểm mềm: evidence nhắc đúng lệnh hay file đã chạy thì được tính, không xác minh kết quả lệnh có đúng như evidence ghi.
- Mod không đọc được nội dung suy luận hay câu trả lời của model. Theo dõi lạc đề mặc định dựa trên hành vi gọi tool; `semanticDrift` để router đọc các lệnh và file gần đây, không đọc suy luận.
- Engine chỉ báo nguồn đổi model qua `classic.PostModelSwitch`. Không có hook này thì mod không phân biệt được engine tự đổi với người dùng đổi, và tạm ngừng điều phối luồng chính tới mục tiêu mới.
- Agent của workflow có thể chạy bước đầu trước khi mod kịp ghi điều phối (engine không có hook trước khi agent khởi động). Agent đó không bị ép ở các bước sau, để không phá cache của nó, và nhật ký ghi rõ.
- Agent ngoài điều phối (không qua `agent.spawn` của mod) chỉ được đếm và liệt kê; mod không chấm, không ép, không đo được chi phí của nó.
- Bảng giá kèm mod ghi ngày 2026-10-06 [Nguồn: bảng model Claude]; quá 180 ngày thì `/conductor status` cảnh báo. Giá Haiku 5.5 cho prompt trên 100K token được tính riêng. Đọc cache của Haiku là giả định (10% giá vào). Kích thước turn ước lượng là giả định, được hiệu chỉnh dần từ số đo trong phiên.
- Chi phí của một lượt chỉ là số đo khi lượt đó kết thúc; trong lúc chạy, sổ hiện con số ước lượng.
- Một họ model lỗi (không phản hồi) ở một turn thì turn đó quay về model của phiên; lỗi ở hai turn liên tiếp thì bị tạm ngừng dùng 5 turn rồi thử lại.
- Nhãn tiếng Anh (`uiLanguage: en`) chỉ áp cho nhãn cố định của band và pane; thông báo, cảnh báo và khối gửi Claude vẫn bằng tiếng Việt.

## Thay đổi 0.5.0 theo đánh giá

Mỗi điểm của bản đánh giá được kiểm trên code 0.4.0 trước khi sửa. Kết quả kiểm và cách xử lý:

| Điểm đánh giá | Kiểm trên 0.4.0 | Xử lý |
|---|---|---|
| Router chạy với mọi prompt, kể cả "ok" | Đúng | `routerSkip` (mặc định tắt), `/conductor reroute`, `/conductor goal` chạy cả khi router tạm ngừng |
| Không có confidence, không hỏi lại | Đúng | Trường `confidence`, hỏi lại một lần khi JSON hỏng hoặc tin cậy dưới 0,4 |
| Eval router còn yếu | Đúng | Golden-set 16 ca (thêm Anh/Việt lẫn, code block lớn, chỉ trả lời, nhiều mục tiêu mơ hồ), replay offline trong test, script eval router thật |
| Khớp việc chỉ nhận "Việc N", "Task N" | Đúng một phần: "Task #N" đã được nhận; "Bước N" bị từ chối có chủ ý | Router chấm subagent nhận ra việc đã phân; code ghi log lời gọi gần khớp, vẫn không đoán theo ý |
| Không chặn khi main tự làm việc đã giao | Đúng một phần: có nhắc một lần, lệnh Bash ghi file lọt | `strictDelegation` remind (mọi lần, kể cả Bash) và block |
| Không phân biệt engine fallback với `/model` | Đúng | `classic.PostModelSwitch` theo `source` |
| Agent ngoài lifecycle không được ghi nhận | Đúng một phần: `agent.spawn` đã ghi "không qua điều phối" | `classic.SubagentStart`, status ghi agent ngoài điều phối |
| Race agent workflow | Đã giảm nhẹ bằng đánh dấu bước đầu chạy trước | Giữ nguyên, ghi rõ trong giới hạn |
| Ba loại agent cố định | Đúng một phần | Danh mục từ `agent.offer` (kèm mô tả) và `agentTypes` |
| Ước lượng chi phí thô | Đúng | Token ra theo dạng việc; agent không có kết quả chấm không làm lệch hệ số |
| Drift không theo ngữ nghĩa | Đúng (engine không cho đọc suy luận) | `semanticDrift` (mặc định tắt) qua router |
| `verified` không kiểm evidence | Đúng; thêm: evidence tùy ý còn tắt cả checkpoint | Đối chiếu evidence với lệnh và file đã chạy; không khớp thì không tắt checkpoint |
| Relation `new` xóa checklist cũ | Đúng; ý "chỉ báo số bước" là sai vì mod đã báo | Cất mục tiêu cũ, `restore`; relation thiếu hoặc sai coi là tiếp nối |
| Scope cũ khi `plan set` | Đúng một phần: relation `new` đã đặt lại scope | `plan set` nhận `scope` |
| Subagent không được nhắc | Đúng | `remindSubagents` (mặc định tắt) |
| Router lỗi: thiếu cache brief, force-route | Đúng một phần: brief đã được giữ | `routerFallback: reuse`, `/conductor reroute` |
| Giá cứng 2026-10 | Đúng | Ngày bảng giá, cảnh báo khi cũ, `prices` ghi đè, giá Haiku prompt dài |
| `contextWindows` trống | Đúng; con số gợi ý "haiku 200k" là của Haiku 4.5, Haiku 5.5 là 1M | Mặc định 1M cho model ID mặc định |
| `register.tsx` quá lớn | Đúng (61 KB) | Tách thành `context.ts` và `hooks/parts/` |
| Thiếu test tích hợp | Sai: bốn kịch bản đã có test | Siết ca báo chưa đạt trong golden-set; thêm kịch bản đầu cuối |
| Thiếu log quyết định | Đúng | `decisionLog` JSONL |
| UI chỉ tiếng Việt | Đúng một phần: router đã trả lời theo ngôn ngữ của prompt | `uiLanguage` cho band và pane |

Kiểm thêm phát hiện vài điểm bản đánh giá không nêu, đã sửa cùng đợt:
- Lỗi của router chấm subagent làm tạm ngừng router đọc prompt.
- Lệnh `env` không kèm lệnh khác bị tính là thay đổi.
- Lệnh gán biến trước một lệnh chỉ đọc, và `npx tsc`, bị nhận sai.

Mỗi sửa đổi có test, và 27 đột biến (mỗi đột biến bỏ một sửa đổi) đều làm đỏ ít nhất một test.
