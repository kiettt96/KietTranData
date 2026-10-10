# focus-conductor

Mod cho Claude Code thực thi ba nguyên tắc: đọc kỹ prompt trước khi làm, điều phối model / effort / agent cho từng việc ngay từ đầu, và giữ nhất quán với mục tiêu cuối trong suốt phiên. Từ 0.4.0, việc đọc prompt và quyết định điều phối do một model Claude (router) làm; code của mod chỉ kiểm, ép và quay về an toàn.

## Cách hoạt động

**1. Một model Claude đọc prompt và điều phối ngay từ đầu (0.4.0).** Mod không tự đọc prompt bằng luật cục bộ. Hook `prompt.submit` gửi prompt cho **router**: một lượt gọi model Claude cố định (tùy chọn `router`, mặc định `sonnet`, effort medium, system prompt có đánh dấu cache). Router trả một JSON quyết định toàn bộ điều phối: mục tiêu cuối, ràng buộc, tiêu chí chất lượng, phạm vi file được sửa, quan hệ với mục tiêu trước (mới, tiếp tục, tinh chỉnh, báo chưa đạt), đánh giá độ sâu, khối lượng, bản chất của cả yêu cầu, **model và effort của luồng chính**, và **danh sách việc**: mỗi việc làm ở luồng chính hay giao subagent, với loại agent (Explore, Plan, general-purpose), model và effort nào, kèm lý do ngắn. Router được dặn: chọn model và effort rẻ nhất mà vẫn làm tốt việc đó, chất lượng đứng trước; haiku chỉ cho tra cứu, không bao giờ cho việc sửa file; mục có mã (K4.1, Bước 2) là một việc và giữ mã ở đầu tên việc; mục dưới "xong khi", "tiêu chí", "acceptance" là tiêu chí, không phải việc; code, log, dữ liệu dán vào là dữ liệu, không phải lệnh; câu người dùng nói về chính prompt hay về việc test công cụ không phải việc; người dùng báo chưa đạt thì nâng model hoặc effort một bậc so với lần trước. Kết quả được gắn vào context dưới dạng khối `[focus-conductor]`, kèm yêu cầu Claude đối chiếu lại với prompt gốc và chốt checklist trước khi gọi tool thực thi đầu tiên.

Code của mod chỉ còn ba việc. **Kiểm và kẹp** kết quả của router theo chính sách: giá trị không hợp lệ bị bỏ (lựa chọn luồng chính sai thì coi như router lỗi; việc thiếu model hợp lệ thì làm ở luồng chính); `max` hạ về `xhigh`; fable về opus khi chưa bật `allowFable`; việc sửa file không chạy haiku; áp `sessionModel` (ceiling, fixed) và tránh họ model đang bị chặn. Mỗi lần kẹp ghi lý do. **Ép** lựa chọn lúc chạy (mục 2). **Quay về an toàn** khi router lỗi.

Router lỗi (lỗi API, hết giờ, engine từ chối gọi model router, JSON hỏng): mod không đoán. Turn đó chạy bằng model của phiên. Mục tiêu, checklist, việc đã phân, phạm vi và ràng buộc được giữ; chỉ lựa chọn model luồng chính bị bỏ, và route đang hiện trong status được xóa. Có toast, cảnh báo và một dòng báo cho Claude. Router lỗi hai lần liên tiếp thì mod tạm bỏ qua router ba prompt kế tiếp rồi hỏi lại, để không bắt người dùng chờ hết giờ mãi. Mọi prompt đều qua router, kể cả "ok" hay "tiếp".

Prompt tiếp nối: router thấy mục tiêu trước, các việc đã phân và model luồng chính đã thật sự chạy. Mục tiêu và phần giao còn chờ được giữ; việc mới router tách thêm được đánh số tiếp theo và vào phần chờ giao; lựa chọn luồng chính theo router. Mỗi lần router quyết lại, mức nâng theo bằng chứng của prompt trước về 0, vì router đã tự nâng khi người dùng báo chưa đạt. Việc đánh số tiếp theo cả khi có lượt router lỗi xen giữa, nên không trùng số việc cũ.

**Prompt đính kèm chỉ để đối chiếu.** Khi người dùng nói prompt đính kèm không cần chạy, chỉ dùng để test hay đối chiếu điều phối, router đánh dấu `reference`: mục tiêu của lượt là phần đối chiếu, các việc của prompt đính kèm được điều phối như khi chạy thật nhưng chỉ để hiển thị (kèm luồng chính mà prompt đó cần), không hiển thị ràng buộc hay tiêu chí của prompt đính kèm, không giao subagent, không nhắc giao việc. Sau đó người dùng bảo chạy thật (router đánh dấu `runReference`, kể cả khi relation là `new`) thì các việc đã đối chiếu thành việc thật của một mục tiêu mới, cùng ràng buộc và tiêu chí của prompt đính kèm, và được theo dõi giao việc.

**2. Ép điều phối lúc chạy.** Luồng chính chốt model và effort router chọn ở step đầu của mỗi turn và giữ nguyên cho mọi step trong turn, vì prompt cache gắn với từng model và đổi effort cũng làm mất cache phần messages. Không dùng `max`.

Đổi giữa các turn được tính bằng chi phí token. Nâng cấp luôn được áp. Hạ cấp chỉ được áp khi lợi ích tiết kiệm trong các turn còn lại vượt chi phí ghi lại cache của ngữ cảnh hiện tại với hệ số an toàn 1,2; nếu không, mod giữ model cũ và ghi lý do, và khối context ghi đúng model sẽ thật sự chạy. Khi cache đã nguội (quá `cacheTtlMinutes` không có turn, mặc định 5 phút) hoặc ngữ cảnh vừa bị nén, đổi model không mất chi phí ghi lại. Nếu ngữ cảnh gần đầy thì không đổi sang model khác. Người dùng tự đổi model hoặc effort bằng `/model` thì mod dừng điều phối luồng chính tới mục tiêu mới. Model được chọn mà không phản hồi (không có quyền, sai ID) thì mod quay về model của phiên ngay trong turn đó; lỗi ở hai turn liên tiếp thì họ model bị chặn 5 turn.

Nâng theo bằng chứng trong cùng một prompt: lặp cùng một lỗi ba lần thì turn sau nâng họ model một bậc; vượt ngân sách tool call, hoặc có ba tool call lỗi trong một turn, thì nâng effort một bậc.

**Phân việc.** Khối context liệt kê từng việc kèm cách làm: `làm trực tiếp ở luồng chính (<model sẽ chạy>)` hoặc `giao <loại agent> <họ>/<effort>`. Khi Claude gọi Agent cho một việc đã phân, mod nhận ra việc đó chỉ theo cấu trúc: `description` mở đầu bằng `Việc N` hoặc `Task N` (không nhận `Bước N` vì dễ trùng số bước của checklist), hoặc cùng mã mục với tên việc (so nguyên mã, để K4.1 không khớp K4.10). Mod không đoán theo ý. Khi khớp, mod dùng đúng model, effort và loại agent router đã phân, không hỏi router lần nữa, kể cả khi Claude tự ghi model khác (có ghi nhật ký). Loại agent chỉ được đổi khi Claude để general-purpose và engine đã mời loại router chọn. Nếu luồng chính tự sửa file trong khi còn việc ghi giao subagent chưa có Agent nào nhận, mod nhắc một lần ngay trong kết quả tool đó (trừ file kế hoạch của plan mode trong `.claude/plans/`), và cuối turn ghi cảnh báo chi phí lên pane. Mod không chặn được Claude tự làm; nó chỉ ghi sẵn lựa chọn, nhắc và cảnh báo.

**Subagent ngoài phân việc.** Agent Claude tự giao (không khớp việc đã phân), agent gọi từ trong một subagent, và agent của workflow mà script không chọn model đều được router chấm khi giao (effort low, tối đa 20 giây): router nhận mục tiêu của phiên, mô tả và prompt của việc, model và loại agent Claude gợi ý, agent cha nếu có, và danh sách agent đã lỗi trong mục tiêu này (giao lại việc đã lỗi thì router tự nâng một bậc). Kết quả chấm được nhớ theo mô tả và prompt trong phiên, nên workflow lặp lại cùng một việc chỉ hỏi router một lần; mỗi lần dùng lại, kết quả được kiểm theo model của phiên hiện tại. Việc vừa lỗi trong mục tiêu thì được hỏi lại. Router lỗi khi chấm thì giữ nguyên lựa chọn của Claude và ghi lý do. Model Claude ghi không thuộc họ Claude thì cho qua nguyên vẹn.

Mỗi request của từng subagent được ép về đúng model và effort đã điều phối (chế độ `auto` và `subagents`), kể cả khi nhiều subagent chạy song song. Với agent của workflow, router chấm xong trước khi agent khởi động, và điều phối được ghi ngay khi engine trả về, trước mọi bước khác; nếu engine vẫn chạy bước đầu của agent trước khi mod kịp ghi, agent đó không bị ép ở các bước sau (đổi giữa chừng phá cache của nó), và nhật ký ghi rõ. Agent workflow có model do script chọn được giữ nguyên. Nếu engine khởi động subagent ở họ model khác họ đã điều phối, mod ghi nhật ký và cảnh báo `engine chạy X thay vì Y`. Nếu model được ép không phản hồi, agent đó quay về model của engine và ngừng bị ép. Chi phí của subagent được hiệu chỉnh theo effort thật engine đã gửi. Khi một mục tiêu giao hơn sáu subagent, mod cảnh báo chi phí một lần (chỉ cảnh báo, không chặn).

Chi phí: mỗi lượt đã kết thúc được cộng vào sổ theo ba nhóm (luồng chính, subagent, router), theo phiên và theo mục tiêu, bằng token đo được từ engine. Chi phí ước tính lúc giao việc được thay bằng số đo khi subagent kết thúc, và số đo được gắn vào đúng dòng nhật ký của agent đó. Hệ số ước lượng được hiệu chỉnh theo số đo trong phiên. Sổ hiện trong pane và `/conductor status`. Hệ số chỉ được hiệu chỉnh từ turn mà mod thực sự áp model và effort (chế độ `auto`). Chi phí router được tính theo đúng họ model của router. Dòng "Chi phí cả phiên theo Claude Code" trong `/conductor status` là số engine báo cho toàn phiên, gồm cả các turn trước khi mod bắt đầu ghi sổ, nên có thể lớn hơn nhiều so với sổ của mod.

Chính sách model của phiên, tùy chọn `sessionModel`: `auto` (mặc định) mod tự chọn và báo một lần khi chọn model khác model của phiên; `ceiling` không bao giờ vượt model đang dùng; `fixed` giữ model của phiên và chỉ đổi effort. Áp cho cả luồng chính và subagent (kể cả ở chế độ `subagents`, nơi luồng chính không đổi), và được báo cho router để nó chỉ chọn trong các model được phép.

**3. Giữ nhất quán.** Claude duy trì mục tiêu và checklist qua tool `mcp__focus-conductor__plan` (`set`, `add`, `update`). Trạng thái `verified` bắt buộc có bằng chứng kiểm tra, `skipped` và `blocked` bắt buộc có lý do. Trong turn, hook `tool.call` theo dõi mọi tool của luồng chính và gắn lời nhắc vào kết quả tool. Lệnh Bash chỉ đọc (tìm kiếm, xem, `git status`, `sed -n`) không được tính là thay đổi; lệnh có chuyển hướng ghi, `sed -i`, `rm`, hay lệnh git ghi thì được tính. Ghi file kế hoạch của plan mode (`.claude/plans/*.md`) không được tính là thay đổi và không bị kiểm phạm vi (không sửa system prompt, nên không ảnh hưởng cache) khi gặp các dấu hiệu sau: cùng lệnh lỗi ba lần (lặp), vượt ngân sách tool call theo độ khó (lan man), sửa file ngoài phạm vi khi prompt có giới hạn kiểu "chỉ sửa X" (lạc phạm vi), và năm thay đổi liên tiếp chưa chạy bước kiểm tra nào (checkpoint tự kiểm tra, chỉ báo đúng lúc đếm đến bội số của năm). Subagent không bị nhắc; cảnh báo của subagent chỉ hiện trên pane. Khi Claude định kết thúc một turn có thực thi mà checklist còn bước `todo` hoặc `doing`, hook `classic.Stop` yêu cầu hoàn thành hoặc ghi rõ lý do, tối đa một lần mỗi lần dừng; turn chỉ hỏi đáp không bị chặn. Một mục system prompt cố định nhắc năm nguyên tắc làm việc; nội dung không đổi giữa các turn để không phá cache.

**Giao diện.** Band phía trên prompt hiện mục tiêu, độ sâu và khối lượng, model đang chạy, tiến độ checklist và cảnh báo mới nhất, kèm nút Chi tiết và Ẩn. Pane "Focus Conductor" hiện mục tiêu kèm lý do của router, ràng buộc, tiêu chí chất lượng, checklist, quyết định điều phối, chi phí ước tính và đo được, nhật ký điều phối và cảnh báo, kèm nút đổi chế độ. Status line dưới prompt có dạng `focus-conductor: complex · opus/high · 2/5` (nhãn cũ suy ra từ độ sâu và khối lượng).

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
| `/conductor goal <mô tả>` | Đặt mục tiêu thủ công qua router (luôn là mục tiêu mới; Claude nhận bản đọc qua context) |
| `/conductor reset` | Xóa mục tiêu, checklist, cảnh báo, danh sách model bị tạm ngừng |

Cấu hình qua `/config` (hoặc `pluginConfigs.focus-conductor.options` trong settings):

| Trường | Mặc định | Ý nghĩa |
|---|---|---|
| `routing` | `auto` | `auto` điều phối cả luồng chính và subagent; `subagents` chỉ subagent, giữ nguyên model luồng chính (an toàn nhất cho cache); `suggest` chỉ hiển thị đề xuất (ở `suggest` và `subagents`, luồng chính trong khối context ghi là `(chỉ đề xuất)`); `off` tắt toàn bộ mod |
| `router` | `sonnet` | Model Claude đọc prompt và điều phối: alias (`haiku`, `sonnet`, `opus`) hoặc model ID. Thay cho tùy chọn `analyzer` của bản 0.3 |
| `enforceChecklist` | `true` | Chặn kết thúc khi checklist còn bước mở |
| `allowFable` | `false` | Cho router dùng Fable cho việc khó nhất; tắt thì lựa chọn fable bị kẹp về opus |
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
  hooks/lib/router.ts          system prompt và request của router, đọc JSON trả về, kiểm và kẹp theo chính sách
  hooks/lib/scale.ts           nhãn độ sâu, khối lượng, bản chất, quan hệ; tier cũ
  hooks/lib/cost.ts            giá token, chi phí turn, chi phí ghi lại cache, điểm hòa vốn
  hooks/lib/ledger.ts          sổ chi phí theo nhóm, phiên và mục tiêu; hiệu chỉnh ước lượng
  hooks/lib/route.ts           chính sách model của phiên, nâng theo bằng chứng, quyết định đổi có tính cache, khớp việc đã phân
  hooks/lib/drift.ts           phát hiện lặp, lan man, lạc phạm vi, checkpoint
  hooks/lib/plan.ts            schema và reducer của tool plan
  hooks/lib/state.ts           giá trị khởi tạo, chuẩn hóa trạng thái cũ và reducer thuần cho $.state
  hooks/lib/text.ts            mọi văn bản gửi model và hiển thị
  hooks/ui/band.tsx            band phía trên prompt
  hooks/ui/pane.tsx            pane chi tiết
  types/index.d.ts             type contract của $.state
  tests/                       logic thuần, router, chi phí và sổ, test tích hợp qua engine (router giả lập)
  tests/fixtures/prompt-k4.ts  prompt dài thật, dùng để kiểm request gửi router và phân việc nhiều mục
```

Kiểm tra trước khi phát hành: `claude plugin validate .` và `claude plugin test .` (148 test).

## Giới hạn đã biết

- Mỗi prompt thêm một lượt gọi model router trước khi Claude bắt đầu làm. Đo bằng `claude -p` với đúng request của mod, model `sonnet`, bản prompt router cuối, ngày 2026-10-10 [Nguồn: eval trong phiên phát triển, 12 ca]: prompt ngắn và vừa 7 đến 20 giây, dưới $0,05 mỗi lượt; prompt cỡ K4 (37.000 ký tự, 14 mục) khoảng 45 giây và khoảng $0,24. Chạy thử `haiku` trên cùng bộ prompt cho kết quả kém hơn: ở prompt K4 đối chiếu nó gộp bước đầu thành một việc, và trước khi siết luật của Explore nó giao việc rà soát bảo mật cho Explore. Vì vậy `sonnet` là mặc định.
- Chất lượng điều phối phụ thuộc model router. Code chỉ kẹp theo chính sách, không sửa phán đoán của router (ví dụ router giao một việc cho agent hay giữ ở luồng chính).
- Router lỗi thì prompt đó không được điều phối; mod không có phương án đoán thay.
- Mod chỉ biết một lời gọi Agent thuộc việc đã phân khi `description` mở đầu bằng `Việc N`, `Task N` hoặc mã mục; cách viết khác được router chấm lại như một subagent tự phát.
- Prompt tiếp nối dùng lại mục tiêu và các việc đã phân; việc router tách thêm được nối tiếp, không thay danh sách cũ.
- Test chạy với engine và router giả lập. Hành vi của router thật được kiểm riêng bằng eval qua `claude -p` trên 12 prompt mẫu (tra cứu, sửa nhỏ, race condition, đổi tên nhiều file, refactor nhiều bước, 3 và 6 việc, tiếp nối, báo chưa đạt, log dán vào, K4 có và không có câu mở đối chiếu); đây là kiểm tra trong phiên phát triển, không phải số đo độc lập.
- Giá dùng để tính là bảng Claude API ghi nhận 2026-10. Đọc cache của Haiku là giả định (10% giá vào). Engine không cho biết cửa sổ ngữ cảnh của model khác họ: khai báo `contextWindows` để mod kiểm tra cả khi nâng cấp; để trống thì cửa sổ được giả định bằng cửa sổ của phiên và chỉ kiểm tra khi hạ cấp. Phần cố định của ngữ cảnh (system prompt, tools, bộ nhớ) được đo một lần ở đầu phiên từ bảng phân tích ngữ cảnh của engine (chế độ ước lượng cục bộ, không tốn request) và hiện trong `/conductor status`; khi engine không trả bảng này, dùng giả định 20k token. Kích thước turn ước lượng (số bước, token vào mới, token ra) là giả định, được hiệu chỉnh dần từ số đo trong phiên.
- Chi phí của một lượt chỉ là số đo khi lượt đó kết thúc; trong lúc chạy, sổ hiện con số ước lượng.
- Mod không đọc được nội dung suy luận của model nên phát hiện lạc đề dựa trên hành vi gọi tool, không dựa trên ngữ nghĩa từng câu trả lời.
- Một họ model lỗi (không phản hồi) ở một turn thì turn đó quay về model của phiên; lỗi ở hai turn liên tiếp thì bị tạm ngừng dùng 5 turn rồi thử lại.
- Khi engine tự đổi model (fallback do bị từ chối hoặc quá tải), mod không phân biệt được với việc người dùng tự đổi bằng `/model`, nên tạm ngừng tự điều phối luồng chính tới mục tiêu mới.
- Khi Claude chốt lại mục tiêu bằng tool `plan` (action `set`), phạm vi file được phép sửa lấy từ prompt trước vẫn được giữ; dùng `/conductor reset` nếu phạm vi đó không còn đúng.
- Prompt bị router xếp là mục tiêu mới thì checklist cũ bị bỏ; mod báo cho Claude số bước còn mở để lập lại nếu thực ra là tiếp nối.
- Mod ép model và effort ở từng request của subagent nên không phụ thuộc engine áp effort trước. Agent của workflow có model do script chọn không bị ép, vì script đã quyết định.
- Số đo chi phí của subagent chỉ đến khi engine gửi `turn.complete` của agent đó; agent được khởi động ngoài đường `tool.call` Agent và ngoài workflow không có dự báo và không gắn được với quyết định điều phối.
