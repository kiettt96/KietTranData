# focus-conductor

Mod cho Claude Code thực thi ba nguyên tắc: đọc kỹ prompt trước khi làm, điều phối model / effort / agent cho từng việc ngay từ đầu, và giữ nhất quán với mục tiêu cuối trong suốt phiên. Từ 0.4.0, việc đọc prompt và quyết định điều phối do một model Claude (router) làm; code của mod chỉ kiểm, ép và quay về an toàn. Bản 0.5.0 xử lý các điểm của một lượt đánh giá độc lập, sau khi kiểm từng điểm trên code (xem [Thay đổi 0.5.0](CHANGELOG.md#thay-đổi-050-theo-đánh-giá)). Bản 0.5.1 sửa sáu lỗ hổng của lượt đánh giá thứ ba về kiểm chứng, phạm vi và cưỡng chế hoàn thành (xem [Thay đổi 0.5.1](CHANGELOG.md#thay-đổi-051-theo-đánh-giá)). Bản 0.5.4 xử lý một lượt rà soát toàn mod: bảng giá và hệ số ghi cache theo bậc, nhận diện lệnh kiểm tra và lệnh tự sửa, nút Đặt lại hai bước, lợi ích ròng so với chạy thuần, golden-set có băm request, CI và type-check (xem [Thay đổi 0.5.4](CHANGELOG.md#thay-đổi-054-theo-đánh-giá-toàn-mod)). Bản 0.5.5 sửa nhận diện cờ tự sửa đặt trong nháy và nâng action của CI lên Node 24 (xem [Thay đổi 0.5.5](CHANGELOG.md#thay-đổi-055-cờ-tự-sửa-đặt-trong-nháy-và-action-node-24)). Bản 0.5.6 xử lý năm điểm rút ra từ một phiên làm việc thật: trạng thái `waiting`, cập nhật checklist hàng loạt, kết quả plan gọn kèm action `show`, lệnh `sqlite3` và Python nội dòng chỉ đọc không còn bị đếm là thay đổi, và gợi ý `checkCommands` khi `verified` bị hạ (xem [Thay đổi 0.5.6](CHANGELOG.md#thay-đổi-056-trạng-thái-waiting-cập-nhật-hàng-loạt-kết-quả-plan-gọn-lệnh-nội-dòng-chỉ-đọc-gợi-ý-checkcommands)). Bản 0.7.0 xử lý bốn nhận xét từ một phiên thật: "Đã kiểm chứng" do mod tự nâng và hạ theo kết quả lệnh test thay vì đòi Claude chép đúng lệnh, giám sát giữa phiên bằng `semanticDrift` bật mặc định cùng phát hiện của turn trước gửi kèm router, router đọc kỹ prompt, liệt kê yêu cầu và tự chia việc, cùng bốn sửa nhỏ về khôi phục checklist, phạm vi, ngân sách và mức nâng (xem [Thay đổi 0.7.0](CHANGELOG.md#thay-đổi-070-đã-kiểm-chứng-do-mod-tự-nâng-giám-sát-chủ-động-giữa-phiên-router-đọc-kỹ-và-tự-chia-việc)). Bản 0.7.1 khép chỗ hở còn lại của "Đã kiểm chứng": danh sách việc Claude Code tự ghi (`TaskCreate`, `TaskUpdate`, `TodoWrite`) cũng được mod tự nâng và hạ `verified`, và status line làm mới khi bước tự nâng bị hạ (xem [Thay đổi 0.7.1](CHANGELOG.md#thay-đổi-071-đã-kiểm-chứng-cho-danh-sách-việc-phản-chiếu-và-status-line-làm-mới-khi-hạ)). Bản 0.7.2 xử lý phiên thật chỉ thấy status line: pane chi tiết tự mở ở mỗi mục tiêu mới (option `autoPane`), router lỗi ở prompt đầu không còn làm mod mất band, phản chiếu và giám sát (mod lập mục tiêu tối thiểu rồi nâng cấp khi router đọc được), lỗi router tự để lại bằng chứng trên status line và `/conductor status`, lượt kiểm lại của router có hạn chung và chỉ chạy khi còn yêu cầu chưa được phủ (xem [Thay đổi 0.7.2](CHANGELOG.md#thay-đổi-072-pane-tự-mở-mục-tiêu-tối-thiểu-khi-router-lỗi-router-kiểm-lại-có-điều-kiện)).


## Tổng quan

Mod làm ba việc, mỗi việc ứng với một nhóm hook:

1. **Đọc kỹ prompt.** Hook `prompt.submit` gửi prompt cho **router**, một lượt gọi model Claude (tùy chọn `router`, mặc định `sonnet`), và nhận một JSON: mục tiêu cuối, ràng buộc, tiêu chí chất lượng, phạm vi file được sửa, quan hệ với mục tiêu trước, đánh giá độ sâu và khối lượng, model và effort của luồng chính, và danh sách việc kèm cách làm (luồng chính hay giao subagent, với loại agent, model, effort). Kết quả vào context của Claude dưới khối `[focus-conductor]`.
2. **Điều phối lúc chạy.** Luồng chính chốt model và effort ở step đầu của mỗi turn; đổi model giữa các turn được tính theo chi phí ghi lại cache; subagent đã phân dùng đúng lựa chọn của router, subagent khác được router chấm khi giao.
3. **Giữ nhất quán.** Checklist qua tool plan, chặn kết thúc khi checklist còn bước mở, theo dõi lặp lệnh lỗi, lạc đề và ghi file ngoài phạm vi, và đối chiếu evidence của bước `verified` với dấu vết thực thi thật.

Router lỗi thì mod không đoán thay: prompt đó chạy theo model của phiên. Code của mod chỉ kiểm, ép theo chính sách và quay về an toàn. Mô tả từng cơ chế: [docs/DESIGN.md](docs/DESIGN.md).

**Tài liệu khác:** [CHANGELOG.md](CHANGELOG.md) (lịch sử thay đổi theo bản), [docs/VERIFICATION.md](docs/VERIFICATION.md) (số đo kiểm chứng của HEAD hiện tại), [docs/DESIGN.md](docs/DESIGN.md) (cách hoạt động chi tiết và hợp đồng đối chiếu evidence của `verified`).

## Cài đặt

Mọi lệnh bắt đầu bằng `/` trong phần này gõ ở prompt của Claude Code (mở bằng lệnh `claude`), không gõ ở terminal zsh hay bash; terminal sẽ báo `no such file or directory: /plugin`. Lần kiểm tra gần nhất chạy trên Claude Code 2.1.296 (xem mục "Kiểm chứng HEAD hiện tại").

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
| `/conductor status` | Tóm tắt chế độ, route luồng chính, model bị tạm ngừng, checklist, trạng thái việc giao subagent, chi phí đo được và phần còn ước tính, lợi ích ròng so với chạy thuần, ngày bảng giá, cặp bậc cache đang dùng (kèm cảnh báo khi lệch), độ trễ router, agent ngoài điều phối, mục Hạn mức (phiên và tuần: đã dùng, còn lại, giờ làm mới, ngưỡng, trạng thái, điểm dừng đang mở) |
| `/conductor mode auto\|subagents\|suggest\|off` | Đổi chế độ trong phiên |
| `/conductor goal <mô tả>` | Đặt mục tiêu thủ công qua router (luôn là mục tiêu mới; Claude nhận bản đọc qua context) |
| `/conductor reroute` | Router đọc lại prompt gần nhất (kể cả khi đang tạm ngừng); giữ mục tiêu và checklist |
| `/conductor reset` | Xóa mục tiêu, checklist, cảnh báo, mục tiêu đã cất, sổ chi phí, danh sách model bị tạm ngừng; giữ nhật ký điều phối và hệ số hiệu chỉnh đã học. Nút Đặt lại trong pane làm cùng việc nhưng hai bước: bấm lần đầu chỉ chờ xác nhận (10 giây), bấm lần hai mới xóa |
| `/conductor pause` | Tạm dừng chủ động như khi hạn mức sắp hết: mọi tool trừ `plan` bị từ chối, điểm dừng được ghi ngay |
| `/conductor resume` | Mở lại sau `pause` và báo điểm dừng đang mở; prompt kế tiếp tiếp tục từ đó, kể cả khi router xếp nó là việc khác |
| `/conductor resume force` | Chạy tiếp khi hạn mức chưa làm mới: chỉ miễn các cửa sổ đang chạm ngưỡng lúc gõ, tới mốc làm mới sớm nhất của chúng (không có mốc thì 4 giờ), rồi bảo vệ tự bật lại; cửa sổ khác chạm ngưỡng sau đó vẫn dừng. Không có cửa sổ nào chạm ngưỡng thì báo không có gì để ép và không đặt mốc. Điểm dừng giữ nguyên |
| `/conductor resume discard` | Bỏ điểm dừng đang mở; gõ lần hai trong 10 giây để xác nhận |

Cấu hình qua `/config` (hoặc `pluginConfigs.focus-conductor.options` trong settings):

| Trường | Mặc định | Ý nghĩa |
|---|---|---|
| `routing` | `auto` | `auto` điều phối cả luồng chính và subagent; `subagents` chỉ subagent, giữ nguyên model luồng chính (an toàn nhất cho cache); `suggest` chỉ hiển thị đề xuất (ở `suggest` và `subagents`, luồng chính trong khối context ghi là `(chỉ đề xuất)`); `off` tắt toàn bộ mod |
| `router` | `sonnet` | Model Claude đọc prompt và điều phối: alias (`haiku`, `sonnet`, `opus`) hoặc model ID. Thay cho tùy chọn `analyzer` của bản 0.3 |
| `enforceChecklist` | `true` | Chặn kết thúc khi checklist còn bước mở |
| `allowFable` | `false` | Cho router dùng Fable cho việc khó nhất; tắt thì lựa chọn fable bị kẹp về opus |
| `sessionModel` | `auto` | `auto` mod tự chọn model; `ceiling` không vượt model của phiên; `fixed` giữ model của phiên, chỉ đổi effort |
| `contextWindows` | trống | Cửa sổ ngữ cảnh theo họ model, dạng `opus=1000000,sonnet=1000000`; mod không đổi sang model có cửa sổ nhỏ hơn ngữ cảnh hiện tại, kể cả khi nâng cấp. Để trống thì họ dùng model ID mặc định của mod lấy 1M token [Nguồn: trang giá Anthropic 2026-10-13]; họ bị `modelMap` đổi ID thì cần khai ở đây (ví dụ `haiku=1000000`) |
| `cacheTtlMinutes` | `60` | Sau bao nhiêu phút không có turn thì cache coi như nguội, khi đó đổi model không mất chi phí ghi lại. Giá trị là chuỗi số. Đi cặp với `cacheWrite`: bậc 1 giờ là `60` và `2`, bậc 5 phút là `5` và `1.25` |
| `cacheWrite` | `2` | Giá ghi cache bằng bao nhiêu lần giá vào [Nguồn: trang giá Anthropic 2026-10-13: 1,25 lần ở bậc 5 phút, 2 lần ở bậc 1 giờ]. Mod kẹp giá trị trong 1,25 đến 2. Mặc định bậc 1 giờ theo một phép đo `claude -p` (xem "Đo bậc cache"), chưa kiểm trên mọi tài khoản |
| `checkCommands` | trống | Lệnh kiểm tra riêng của dự án, phân tách bằng dấu phẩy, ví dụ `make ci,./scripts/check.sh,python3 tests/`. Từ 0.7.3, khi token đầu là python thì phần thư mục (`/usr/bin/python3`) và cờ không giá trị (`-B`, `-u`...) được bỏ qua, và token kết thúc bằng `/` là tiền tố thư mục: mọi script dưới thư mục đó được tin mã thoát và không tính là thay đổi, nên chỉ khai thư mục chỉ chứa script kiểm (script in FAIL mà thoát mã 0 vẫn bị tính là đạt). Khớp theo tiền tố token, được tin mã thoát, tính là kiểm tra chạy hành vi, đối chiếu evidence nghiêm ngặt (`./scripts/check.sh --fast` khác `./scripts/check.sh`); kèm cờ tự sửa (`--fix`, `--write`) thì vẫn là ghi file. Khi `verified` bị hạ xuống `done` vì lệnh kiểm tra không nhận ra, mod nhắc option này kèm một ví dụ lấy từ script đã chạy; từ 0.7.3 mod cũng gợi ý tới anh (toast một lần mỗi mục tiêu, dòng trong pane và `/conductor status`) khi đến checkpoint mà có script kiểm chưa được nhận. Từ 0.7.5 lệnh khai chạy qua `| tail` hay `| head`, sau `cd <dir> &&` hay với `set -o pipefail` vẫn được tính (luật ở mục "Turn lỗi và lệnh kiểm riêng"); cách chắc nhất là chạy lệnh kiểm không qua ống hoặc có `set -o pipefail`. Mod chỉ gợi ý script có từ kiểm ở đầu tên (`check_`, `kiem_tra`, `verify_`, `test_`...), không gợi ý tiền tố thư mục. Model không tự khai được |
| `modelMap` | rỗng | Ghi đè model ID, ví dụ `opus=claude-opus-5-5,sonnet=claude-sonnet-5-5` (cần khi dùng gateway có ID riêng) |
| `routerSkip` | trống | Câu tiếp nối ngắn không cần hỏi router, phân tách bằng dấu phẩy, ví dụ `ok,tiếp,tiếp tục,go` |
| `routerFallback` | `session` | Khi router lỗi: `session` chạy theo model của phiên; `reuse` dùng lại lựa chọn luồng chính của prompt trước |
| `strictDelegation` | `off` | `off` nhắc một lần; `remind` nhắc ở mọi lần thay đổi; `block` từ chối luồng chính sửa file khi còn việc chưa giao (tối đa `blockLimit` lần mỗi mục tiêu) |
| `blockLimit` | `2` | Số lần `block` từ chối trong một mục tiêu, từ 1 đến 10 |
| `remindSubagents` | `false` | Nhắc subagent lạc đề kèm việc được giao |
| `semanticDrift` | `true` | Ở checkpoint, router kiểm lạc đề theo nội dung (một lượt router mỗi lần). Tối đa một lượt mỗi `driftIntervalMinutes` phút, tự tắt khi hạn mức vào vùng gần ngưỡng. Đặt `false` để tắt; chi phí ở mục "Giám sát giữa phiên" |
| `driftIntervalMinutes` | `10` | Từ 0.7.5: số phút tối thiểu giữa hai lượt kiểm lạc đề, kẹp 5 đến 120. Phiên dài nhiều giờ nên đặt `30` |
| `autoPane` | `true` | Mỗi mục tiêu mới thì mở pane chi tiết (không chiếm phím, xin 16 dòng khi nằm trên prompt). Anh tự đóng pane thì không mở lại trong mục tiêu đó; sang mục tiêu mới thì mở lại. Pane chỉ được đặt khi surface và độ rộng cho phép. Đặt `false` để tắt |
| `netResume` | `false` | Sau một turn của luồng chính kết thúc vì lỗi, dò nhẹ (GET `https://api.anthropic.com` mỗi 30 giây, tối đa 120 lần, không gửi dữ liệu của phiên) rồi tự gửi một prompt tiếp tục khi có phản hồi, tối đa một lần cho mỗi mục tiêu. Không chạy khi mod đang dừng vì hạn mức hay `mode` là `off`; anh gõ prompt thì hủy chờ. Mặc định tắt: chỉ nên bật sau khi `decisionLog` đã ghi được một dòng `net` thật ở một turn lỗi |
| `decisionLog` | trống | Đường dẫn file JSONL ghi mỗi quyết định điều phối (router đọc prompt, router lỗi, bỏ qua router, chấm subagent, đổi model, lạc đề, `verify-reject` khi `verified` bị hạ xuống `done`, `verify-auto` khi mod tự nâng lên `verified`), nối tiếp qua các phiên, giữ 500 dòng cuối. Log có trích 300 ký tự đầu của prompt và của evidence: chỉ bật khi đường dẫn nằm ngoài thư mục chia sẻ hay commit |
| `agentTypes` | trống | Loại agent thêm cho router, phân tách bằng dấu phẩy |
| `prices` | trống | Ghi đè bảng giá, dạng `sonnet=2/10` hoặc `opus=4/20/0.2` (vào/ra/đọc cache, USD mỗi 1M token). Thiếu giá trị thứ ba thì đọc cache theo tỷ lệ của đúng họ đó trong bảng kèm mod (Sonnet và Opus 5%, Fable 2,5%, Haiku 10% giá vào). Catalog giá mà router thấy khi chọn model dựng từ bảng này |
| `uiLanguage` | `vi` | `vi` hoặc `en` cho nhãn của band và pane |
| `quotaGuard` | `true` | Bảo vệ hạn mức (xem mục dưới). Tắt thì mod chạy như 0.5.6 |
| `pauseSessionRemainingPct` | `5` | Dừng khi hạn mức phiên (cửa sổ 5 giờ) còn không quá giá trị này, tính bằng phần trăm còn lại. Kẹp trong 0,5 đến 99 |
| `pauseWeekRemainingPct` | `2` | Dừng khi hạn mức tuần còn không quá giá trị này, tính bằng phần trăm còn lại. Kẹp trong 0,5 đến 99 |
| `noticeWeekRemainingPct` | `0` (tắt) | Từ 0.7.4: khi hạn mức tuần còn không quá giá trị này, báo một lần cho Claude ở kết quả tool kế tiếp (không chặn tool) để Claude áp quy tắc dừng theo hạn mức của prompt. Phải lớn hơn `pauseWeekRemainingPct`, nếu không thì bị bỏ qua và mod báo một lần |
| `noticeSessionRemainingPct` | `0` (tắt) | Như trên, cho hạn mức phiên (5 giờ); phải lớn hơn `pauseSessionRemainingPct` |
| `pauseAllowPaths` | trống | Từ 0.7.5: đường dẫn phân tách bằng dấu phẩy (tương đối theo thư mục gốc của phiên hoặc tuyệt đối), ví dụ `.checkpoint/`. Khi dừng cứng vì hạn mức, luồng chính vẫn được Write, Edit hay chạy Bash mà mọi đích ghi nằm trong các đường dẫn này, để ghi file điểm dừng theo quy tắc dừng của prompt. Mục kết thúc bằng `/` là thư mục; mục `.` và `./` (cả cây) bị bỏ kèm cảnh báo một lần. Mọi tác động ghi của lệnh phải có đường dẫn và mọi đường dẫn đều nằm trong danh sách (nguồn của `mv` tính là ghi); `ln` và lệnh không có đường dẫn đích (`git commit`, `git push`) bị từ chối; tool Read vào các đường dẫn này được qua. Mỗi đường dẫn còn phải đáp thật vào trong danh sách (`$.fs.stat` với `resolve`): symlink dẫn ra ngoài, liên kết trỏ vào hư không và lỗi hệ tệp khác ENOENT bị từ chối, còn thư mục con chưa tạo trong danh sách thì được ghi. Câu từ chối nêu các đường dẫn được ghi, kể cả Read, trước. Trống là như cũ: chỉ tool `plan` được qua |

### Bảo vệ hạn mức

Từ 0.6.0, khi hạn mức phiên hoặc hạn mức tuần của gói subscription sắp hết, mod dừng công việc ở ranh giới tool call, ghi một điểm dừng bền, và ở lần người dùng ra lệnh tiếp theo thì Claude tiếp tục đúng từ đó.

Engine báo phần đã dùng của mỗi cửa sổ; option nói bằng phần còn lại, nên mod dừng khi phần đã dùng không nhỏ hơn 100 trừ ngưỡng (mặc định 95% với phiên, 98% với tuần). Khi vào vùng dừng, mọi tool của luồng chính và subagent bị từ chối, trừ tool `plan` của mod. Claude được yêu cầu gọi `plan` với action `checkpoint` kèm một `note` về bước kế tiếp, rồi kết thúc turn; cổng chặn kết thúc khi checklist còn mở, các lời nhắc cuối turn, router và `semanticDrift` đều tạm tắt để không vòng lặp và không tốn thêm hạn mức. Nếu trong cùng turn model vẫn gọi tool bị từ chối đến lần thứ ba, mod hủy turn đó (dự phòng, không phải đường chính). Từ 0.7.5, `pauseAllowPaths` cho luồng chính ghi vào các đường dẫn đã khai trong lúc dừng (Write, Edit, Bash mà mọi đích ghi xác định được đều nằm trong đó); câu từ chối nêu các đường dẫn này.

Điểm dừng ghi lý do (cửa sổ, phần trăm, giờ làm mới), mục tiêu, checklist, bước đang làm, việc giao subagent, file đã sửa trong mục tiêu, năm tool call cuối, lệnh bị từ chối đầu tiên (điểm tiếp tục chính xác) và `note` của Claude. Nó nằm trong kho bền của mod (`$.store`), khóa theo thư mục làm việc, nên sống qua đóng phiên. Không ghi output của tool, nội dung file hay biến môi trường: lệnh bị từ chối của Write, Edit, MultiEdit và NotebookEdit chỉ ghi đường dẫn và độ dài nội dung; lệnh Bash và đầu vào khác được che giá trị sau `Authorization`, `Bearer`, header `X-...-Key` hay `X-...-Token`, `token=` và `password=` (kể cả tiền tố như `gh_token=`), `--password`, `mysql -p`, `curl -u`, mật khẩu trong URL và mọi biến môi trường dạng `KEY=...` (việc che theo mẫu, nên một bí mật đặt ở dạng khác vẫn có thể lọt vào). Mở phiên mới trong cùng thư mục mà chưa có mục tiêu thì mod khôi phục mục tiêu và checklist từ điểm dừng; khi người dùng nói "tiếp tục" (router xếp tiếp nối, tinh chỉnh hoặc báo chưa đạt), gõ một câu trong `routerSkip` hay vừa gõ `/conductor resume`, prompt đó nhận một khối ĐIỂM DỪNG (tối đa 2.000 ký tự) đứng trước mọi context khác, kèm danh sách file đã đổi sau lúc dừng và quy tắc tiếp tục. Prompt về việc khác thì điểm dừng giữ nguyên và chỉ nhận một dòng nhắc. Điểm dừng chỉ được đánh dấu đã dùng khi turn tiếp tục kết thúc bằng câu trả lời; người dùng ngắt giữa chừng (Esc), model từ chối hay lỗi thì điểm dừng vẫn mở. Hạn mức chưa làm mới thì prompt vẫn đi qua kèm một dòng báo, tool vẫn bị từ chối; dùng `/conductor resume force` hoặc đợi làm mới. Từ 0.7.5, sau `/clear` (hội thoại mới) prompt đầu không tự nhận khối ĐIỂM DỪNG mà chỉ một dòng gợi ý `/conductor resume`; gõ lệnh đó rồi gõ prompt để tiếp tục. Turn tiếp tục kết thúc không bằng câu trả lời thì điểm dừng được ghi lại theo tiến độ của turn đó và vẫn mở.

Từ 0.6.1, điểm dừng được ghi cả khi hạn mức qua ngưỡng lúc Claude chỉ trả lời bằng chữ: lúc engine báo số đo mới, lúc prompt kế tiếp đến, hoặc lúc phiên kết thúc (đã có điểm dừng của lần dừng này thì chỉ cập nhật). Status line luôn kèm nhãn hạn mức ("tạm dừng: hạn mức", hay phần còn lại khi gần ngưỡng) qua mọi hook, và nhãn mất ngay khi hạn mức làm mới. Pane có mục Hạn mức (từ 0.7.5 đứng sau checklist, tiến độ từng việc và chọn chế độ, và ẩn khi chưa có số đo, không dừng và không có điểm dừng): từng cửa sổ (đã dùng, còn lại, giờ làm mới, ngưỡng), trạng thái (bình thường, tạm dừng vì hạn mức hay theo lệnh, ép tiếp tới mốc nào, hay không có dữ liệu kèm lý do), điểm dừng chưa dùng xong (giờ tạo, lý do, ghi chú của Claude) và lệnh chạy tiếp (`/conductor resume` khi tự dừng, `/conductor resume force` khi dừng vì hạn mức). Đang dừng thì mục Cảnh báo ghi "Đang tạm dừng" kèm lý do. Dưới 56 cột band rút nhãn còn "dừng".

Thử nhanh mà không đốt hạn mức (kịch bản nghiệm thu thủ công):

1. Đặt `pauseSessionRemainingPct` thành `90` qua `/config`: mod dừng khi hạn mức phiên đã dùng khoảng 10%.
2. Giao một việc nhiều bước. Xác nhận band hiện "tạm dừng: hạn mức", tool bị từ chối, Claude gọi `plan` `checkpoint` rồi dừng; `/conductor status` có mục Hạn mức và điểm dừng đang mở.
   Mở pane (nút Chi tiết trên band): mục Hạn mức ghi trạng thái tạm dừng (hạn mức), điểm dừng đang mở kèm ghi chú của Claude và lệnh `/conductor resume force`; mục Cảnh báo ghi "Đang tạm dừng"; status line vẫn còn nhãn dừng sau khi Claude kết thúc turn.
3. Thoát, mở phiên mới trong cùng thư mục, chạy `/conductor resume force` (vì hạn mức chưa làm mới), gõ "tiếp tục".
4. Xác nhận khối ĐIỂM DỪNG xuất hiện (thử thêm một prompt về việc khác trước khi "tiếp tục": khối không được chèn), Claude tiếp tục đúng bước đang làm, không làm lại bước đã xong.
5. Trả `pauseSessionRemainingPct` về `5`.

### Thanh tiến độ

Mỗi việc có một thanh tiến độ riêng (0.6.1). Band phía trên prompt có thanh chung của mục tiêu; pane có mục "Tiến độ từng việc" gồm việc chính, từng việc router phân (làm trực tiếp hay giao subagent, kèm model và effort đã điều phối) và việc Claude tự giao ngoài phân việc. Khi còn dòng trống, band thêm tối đa bốn dòng việc (đang chạy trước, rồi việc lỗi, việc chờ, việc xong; phần dư ghi "+k việc"); hết chỗ thì chỉ một chip "subagent k/n xong". Từ 0.7.5, việc giao thành nhiều lô có một dòng "k/n lô xong, r đang chạy" theo bộ đếm riêng của việc, nên hàng trăm lô vẫn đếm đúng; chip đếm theo tổng số lần gọi Agent. Lời gọi Agent khớp việc đã phân theo số thứ tự ("Việc N: ...") hoặc, khi prompt đánh mã bước, theo đúng mã đó ("BƯỚC 7: lọc tin lô 3" khớp việc "BƯỚC 7").

Thanh chỉ thể hiện phần trăm khi có số bước thật: checklist của tool `plan`; nếu Claude không dùng tool đó thì danh sách việc Claude Code tự ghi (`TodoWrite`, `TaskCreate`, `TaskUpdate`), được mod phản chiếu và ghi nhỏ nguồn "danh sách việc". Danh sách phản chiếu chỉ để theo dõi: nó không chặn kết thúc, không tính cho bảo vệ hạn mức, và tool `plan` luôn thắng khi có. Từ 0.7.1 mod vẫn tự nâng và hạ `verified` cho danh sách này theo đúng luật ở mục "Đã kiểm chứng". Việc làm trực tiếp lấy các bước có tiêu đề mở đầu "Việc N"; subagent lấy danh sách việc nó tự ghi. Không có số bước thì thanh chỉ thể hiện trạng thái, không phần trăm: nét đứt mờ là chờ giao hay chưa bắt đầu, đầu ◐ là đang chạy (kèm số tool call và thời gian chạy của subagent), thanh đầy màu xanh lá là xong, ■ đỏ là lỗi, ■ vàng là bị cắt vì tạm dừng hạn mức.

Band chỉ có trên terminal và desktop (engine không phát band ở vscode và mobile). Ở đó status line có thanh chữ 8 ô và số bước đã đóng, và pane mở bằng `/conductor` (không có nút Chi tiết vì nút nằm trên band). Bấm "Ẩn" trên band chỉ ẩn trong mục tiêu đang làm: mục tiêu mới thì band hiện lại; nút trong pane bật lại bất cứ lúc nào.

### Đã kiểm chứng

Mỗi bước của checklist có ba mức: chưa xong, `done` (đã xong) và `verified` (đã kiểm chứng). Từ 0.7.0 mod quyết `verified` từ dấu vết thực thi, không từ chữ Claude viết: khi mục tiêu đã có sửa file và một lệnh test (kiểm hành vi) chạy đạt sau thay đổi cuối, mọi bước `done` thành `verified`; đóng một bước bằng `done` sau khi test đã đạt thì lưu `verified` ngay. Có thay đổi mới sau đó (của luồng chính hay subagent) thì các bước do mod nâng trở về `done`, và lệnh test đạt lần sau nâng lại. Từ 0.7.5, một lần kiểm đạt chỉ nâng bước đóng sau lần kiểm đạt trước của cùng mục tiêu (bước bị hạ tính là vừa đóng lại); lần kiểm đạt đầu tiên nâng mọi bước `done`. Kiểm tĩnh (type-check, lint, build, validate) không bao giờ tự nâng, vì không chứng minh hành vi chạy đúng; mục tiêu chỉ tra cứu không có gì để kiểm chứng nên không tự nâng. Luật này áp cho cả hai nguồn checklist: tool `plan` và (từ 0.7.1) danh sách việc Claude Code tự ghi bằng `TaskCreate`, `TaskUpdate`, `TodoWrite`; riêng danh sách đó chỉ được nâng khi tool `plan` chưa có bước nào, và vẫn chỉ để theo dõi. Lệnh test được nhận ra theo tên trình chạy phổ biến; script riêng của dự án thì thêm vào option `checkCommands`.

`done` vẫn đủ để kết thúc mục tiêu: cổng chặn kết thúc không đòi `verified`, đây là tín hiệu chất lượng. Band, pane và status line ghi `đã đóng/tổng`, thêm hậu tố số bước `verified` kèm dấu kiểm khi có; thanh tiến độ vẽ phần `verified` đậm, phần `done` thường; `/conductor status` giữ `[v]` và `[x]`. `verified` do Claude ghi chỉ cần đã có lệnh test đạt sau thay đổi cuối, không còn đòi chép đúng từng chữ lệnh (evidence không khớp chặt thì bước được lưu như bước tự nâng và bị hạ khi sửa tiếp; evidence nêu đúng lệnh và kết quả giữ nguyên); chưa có lệnh đạt thì bước bị hạ về `done` kèm lời nhắc chạy lệnh kiểm tra (mod sẽ tự nâng).

### Giám sát giữa phiên

Mod không chỉ làm việc lúc đầu. Mỗi tool call được theo dõi (vòng lặp, ngân sách tool call, chuỗi lỗi, phạm vi, bằng chứng kiểm tra); ở checkpoint (5, 10, 20, 40 rồi mỗi 40 thay đổi chưa kiểm tra trong một turn, từ 0.7.4) `semanticDrift`, bật mặc định, hỏi router một lượt ngắn xem các thay đổi còn phục vụ mục tiêu không. Từ 0.7.5, ghi của subagent vượt mốc checkpoint cũng được nhắc ở lời gọi kế tiếp của luồng chính, và cảnh báo lệnh ghi không xác định được file đích chỉ ra một lần cho mỗi script trong một mục tiêu. Lạc đề thì nhắc ngay ở kết quả tool đó và nâng độ sâu một bậc cho turn sau. Phát hiện của turn trước (vòng lặp, vượt ngân sách, chuỗi lỗi, lệch mục tiêu) được gửi kèm router ở prompt tiếp nối, đúng một lần, để router chấm lại model luồng chính theo những gì đã xảy ra. Mức nâng model và effort theo bằng chứng sống qua prompt tiếp nối, giảm một bậc mỗi turn không có phát hiện, và chỉ bị xóa khi người dùng báo chưa đạt hay sang mục tiêu mới.

Chi phí: mỗi lượt kiểm lạc đề là một lần gọi router, tối đa một lượt mỗi `driftIntervalMinutes` phút (mặc định 10, không quá 6 lượt mỗi giờ), và tự tắt khi hạn mức còn dưới hai lần biên ngưỡng dừng. Đo 6 lượt thật của prompt kiểm lạc đề (router `sonnet`, Claude Code 2.1.296, qua `claude -p`, 2026-10-19) [Đo trực tiếp]: trung bình 6,0 giây và 0,0031 USD mỗi lượt, gồm 0,0009 USD khi cache system prompt còn ấm và 0,0076 USD khi nguội; cả 6 lượt đúng kết luận (3 đúng hướng, 3 lạc đề). Cận trên khoảng 0,046 USD mỗi giờ [Giả định: cache nguội ở mọi lượt, giá API tính theo `total_cost_usd` của CLI, không phải hạn mức subscription]. Chi phí thật qua `$.model.complete` của engine chưa đo. Đặt `semanticDrift` là `false` để tắt.

### Pane chi tiết tự mở

Từ 0.7.2, mỗi mục tiêu mới (router đọc được, mục tiêu tối thiểu khi router lỗi, hay `/conductor goal`) mod mở pane chi tiết bằng `$.ui.open`, không `focus` nên không chiếm phím gõ. Prompt do chính anh gõ được engine tính là "anh yêu cầu", nên pane được đặt ở mọi độ rộng: cạnh transcript (từ 110 cột, chế độ toàn màn hình) hoặc ngay trên prompt. Anh tự đóng pane (dấu đóng hay phím) thì mod nhớ và không mở lại trong mục tiêu đó; sang mục tiêu mới thì mở lại. Pane chưa được đặt (màn hình hẹp, chưa có surface) không báo lỗi; nhật ký quyết định có dòng `pane` kèm lý do. Trên vscode, web và mobile (không có band, nên không có nút Chi tiết) pane tự mở là đường chính tới chi tiết. Đặt `autoPane` là `false` để tắt; `/conductor` mở pane bất cứ lúc nào.

### Turn lỗi và lệnh kiểm riêng

Từ 0.7.3, khi một turn của luồng chính kết thúc vì lỗi (`reason: 'error'`, gồm mọi lỗi API), status line ghi "turn lỗi · gõ tiếp để chạy lại" cho tới khi một turn trả lời xong, mod báo một toast và ghi dòng `net` vào nhật ký; mod không tự chạy lại (trừ khi bật `netResume`) và không chặn tool call nào. Thứ tự nhãn trên status line: hạn mức, lỗi router, turn lỗi. Engine tự thử lại khi gặp lỗi mạng (khoảng 3 phút) trước khi kết thúc turn; trong lúc đó mod không chen vào được.

Nếu Claude chạy kiểm bằng script riêng (ví dụ `/usr/bin/python3 -B tests/check-a.py`), khai `checkCommands` như ở bảng tùy chọn; mod gợi ý chuỗi cần khai khi thấy script kiểm đã chạy mà chưa được nhận (từ 0.7.5 chỉ script có từ kiểm ở đầu tên, không gợi ý script ghi dữ liệu như `ghi_test_data.py` hay `cap_nhat_kiem_ke.py`, và không gợi ý tiền tố thư mục). Lệnh kiểm chạy qua ống che mã thoát: cách chắc nhất là chạy không qua ống hoặc dùng `set -o pipefail`. Từ 0.7.5 lệnh đã khai chạy qua `| tail` hay `| head` vẫn được tính theo luật sau: có `set -o pipefail` thì mã thoát 0 và output không có dấu hiệu lỗi; không có pipefail thì chỉ tính đạt khi dòng không rỗng cuối cùng có dấu hiệu đạt đứng riêng (ví dụ `OK`, `passed`, `ĐẠT`, `KHỚP`, `0 lỗi`; không nằm sau "chưa", "không") và toàn bộ phần output còn thấy không có dấu hiệu lỗi (`FAIL`, `Traceback`, `Error:`, `LỖI`, `SAI`, `KHÔNG KHỚP`, `KHÔNG ĐẠT`, `CHƯA ĐẠT`, `CHƯA KHỚP`, `THIẾU`, `LỆCH`, `CHÊNH LỆCH`, `KHÔNG HỢP LỆ`, `mismatch`, `error`, dấu `✗`, và tỷ lệ N/M với N nhỏ hơn M như `115/120 khớp`), và nếu `head` cắt mất phần cuối thì không tính là đạt. Lệnh khai chạy sau `cd <dir> &&` với đường dẫn tương đối được so như đường dẫn đã nối vào thư mục đó.

Kết quả của tool `plan` với `set` chỉ là một dòng (số bước đã lưu, mục tiêu nếu vừa đổi, bước tiếp theo) khi checklist lưu đúng như Claude gửi; xem đầy đủ bằng `show` hay `/conductor status`. `DISCIPLINE` có mục báo cáo gọn cho luồng chính (không tường thuật giữa các tool call, một dòng "Đang làm việc N/M: ..." khi chuyển việc); hướng dẫn riêng của anh (CLAUDE.md, prompt) được ưu tiên hơn mục đó.

### Phiên dài nhiều giờ

Từ 0.7.4, bốn điều giúp một prompt dài chạy nhiều giờ (0.7.5 thêm mục cuối):

- **Model anh chỉ định.** Prompt quy định model theo loại việc (ví dụ "lọc tin dùng sonnet, đọc và tóm tắt dùng model của phiên") thì router ghi quy định đó đứng đầu ràng buộc, và router chấm subagent nhận lại nó cùng model của phiên. Ràng buộc có phủ định ("không dùng haiku cho việc sửa file") không phải quy định model cho loại việc; ràng buộc có nhiều vế (".", ":", ";", xuống dòng hay ",") được đọc từng vế, mỗi model gắn với loại việc gần nhất đứng trước, loại việc phải khớp trọn từ ở đầu description. Vế có "trừ", "ngoại trừ", "trừ khi", "except", "unless" chỉ bỏ chốt cho việc có từ khóa của ngoại lệ ("lọc tin dùng sonnet trừ khi tin pháp lý": tin pháp lý để router chấm); "không", "tránh", "đừng", "avoid" chỉ phủ định khi đứng trước tên model trong 3 từ. Quy định "mô hình của phiên" cho luồng chính, cho mọi việc không nêu model khác, hay cho loại việc luồng chính tự làm (đọc, giải thích, đúc kết, tổng hợp, tóm tắt, viết, sửa) đặt model của phiên làm sàn của luồng chính; chưa biết model của phiên thì không có sàn. Model Claude ghi ở lời gọi Agent là mức sàn: router và việc đã phân chỉ được chọn cao hơn, không thấp hơn; effort cũng vậy khi Claude ghi effort. `allowFable`, `sessionModel` và họ đang bị chặn vẫn kẹp sau cùng. Claude ghi model ở mức cao nhất được phép và ghi effort thì mod không gọi router cho lời gọi đó.
- **Nhắc kiểm thưa dần.** Lời nhắc checkpoint ở 5, 10, 20, 40 rồi mỗi 40 thay đổi chưa kiểm trong một turn, đặt lại khi một lệnh kiểm được nhận và đạt; câu nhắc dặn kiểm theo cách anh quy định và không tạo bộ kiểm mới khi anh không yêu cầu. Với 1.000 thay đổi chưa kiểm liên tiếp: 28 lời nhắc thay vì 200 [Đo trực tiếp].
- **Báo hạn mức mềm.** Claude không đọc được hạn mức, nên quy tắc "dừng khi hạn mức tuần đã dùng 80%" trong prompt tự nó không chạy được. Đặt `noticeWeekRemainingPct` là `20` (phần còn lại, tức đã dùng 80%) thì khi tới đó mod báo một lần ở kết quả tool kế tiếp: "Hạn mức tuần còn X% (làm mới lúc ...). Nếu prompt có quy tắc dừng theo hạn mức thì áp dụng ngay: làm xong phần đang làm, ghi điểm dừng theo cách prompt quy định, rồi dừng." và status line có nhãn "báo hạn mức". Mod không chặn tool ở mức này; dừng cứng ở `pauseWeekRemainingPct` vẫn như cũ. Mỗi cửa sổ hạn mức chỉ báo một lần; cửa sổ mới (sau khi làm mới) báo lại.
- **Từ 0.7.5.** Giao subagent theo mã bước của prompt (description mở đầu bằng "BƯỚC 7: ...") để mỗi lô khớp đúng việc; ghi model đúng quy định của loại việc ở lời gọi Agent thì mod không gọi router chấm lô đó, và các lô cùng loại chỉ chấm một lần. Đặt cả hai ngưỡng báo mềm lớn hơn ngưỡng dừng cứng cùng cửa sổ (ví dụ `noticeWeekRemainingPct` 20 với `pauseWeekRemainingPct` 2); turn đã nhận câu báo mềm thì cổng Stop không chặn vì checklist còn mở, chỉ khi cửa sổ còn trong vùng báo, để Claude dừng theo quy tắc của prompt; việc giao subagent đã lỗi vẫn bị chặn. Prompt yêu cầu ghi file điểm dừng thì khai thư mục đó ở `pauseAllowPaths`, phòng khi hạn mức chạm ngưỡng dừng cứng trước. Đặt `driftIntervalMinutes` là `30` để bớt lượt kiểm lạc đề.
- **Giữ mục tiêu qua lần nén.** Khi hội thoại được nén, mod dặn bản tóm tắt giữ mục tiêu, các bước còn mở kèm số, ràng buộc (kể cả quy định model) và yêu cầu chưa có việc nào phủ; sau lần nén, kết quả tool kế tiếp của luồng chính nhắc lại mục tiêu, bước đang làm, tối đa 10 bước còn mở, ràng buộc và yêu cầu chưa phủ, đúng một lần. Mỗi khối tối đa khoảng 1.500 ký tự.

### Khi router lỗi

Router lỗi (hết giờ, lỗi API, sai định dạng) hay đang tạm ngừng ở prompt đầu tiên thì mod lập mục tiêu tối thiểu từ prompt (câu mục tiêu là 200 ký tự đầu, band và pane ghi "router chưa đọc") thay vì để trống: band, pane, danh sách phản chiếu, `verified` và giám sát vẫn chạy; riêng cảnh báo ngân sách tool call tắt vì tier chỉ là đoán. Status line ghi lỗi cho tới khi router đọc được lại ("router lỗi: hết giờ 45s · /conductor reroute"), `/conductor status` có dòng "Router lỗi gần nhất" (lý do, thời gian đã chờ, giới hạn, token), và nhật ký `router-fail` có `failure`, `ms`, `timeoutMs`, `maxTokens`, `outputTokens`. `/conductor reroute` hoặc prompt kế được đọc nâng cấp mục tiêu mà giữ nguyên checklist, bằng chứng và chi phí.

Router và prompt dài: đo qua `claude -p` (router `sonnet`, Claude Code 2.1.296) với prompt tiếng Việt 5.990 và 8.833 ký tự, 28 tới 30 yêu cầu [Đo trực tiếp]: lượt đầu trung vị 20 tới 22 giây, p95 22 tới 27 giây, tối đa 3.300 token, nên giới hạn 45 giây và 8.000 token cho prompt tới 12.000 ký tự đủ. Lượt kiểm lại chạy ở effort medium và chỉ khi quá 8 yêu cầu mà còn yêu cầu chưa được phủ; hạn chung cho mọi lượt gọi router của một prompt là 1,5 lần timeout (67,5 giây).

### Đánh giá một phiên

Để đánh giá việc chọn model và giám sát sau một phiên, đặt option `decisionLog` là một đường dẫn ngoài thư mục chia sẻ hay commit (log có trích 300 ký tự đầu của prompt và của evidence). Mỗi dòng của tệp JSONL là một quyết định có `at` (giờ ISO) và `kind`: `route` (router đọc prompt: `relation`, `confidence`, luồng chính `main`, mức đề xuất `expected`, các việc đã phân), `router-fail`, `skip`, `reroute`, `agent` (việc giao subagent có khớp phân việc không), `model-switch`, `drift` (kết luận của lượt kiểm lạc đề), `verify-reject` (bước `verified` bị hạ về `done`, kèm lý do) và `pane` (pane tự mở chưa được đặt, kèm lý do), `verify-auto` (mod tự nâng lên `verified`, kèm lệnh đã chạy và `at` cho biết nâng ở đâu: `test` khi lệnh test vừa đạt với checklist của tool `plan`, `close` khi Claude đóng bước sau khi test đã đạt, `mirror` với danh sách việc phản chiếu). Đọc nhanh bằng `jq -c 'select(.kind=="route")' <tệp>` để xem từng lần router chọn gì cho prompt nào, rồi đối chiếu với `model-switch` và `drift` cùng phiên. Tệp giữ 500 dòng cuối, nối tiếp qua các phiên.

### Đo bậc cache

Mod giả định ghi cache theo bậc 1 giờ (`cacheWrite` 2, `cacheTtlMinutes` 60). Căn cứ là một phép đo `claude -p` ngày 2026-10-13 trong môi trường phát triển: toàn bộ token ghi cache nằm ở bậc 1 giờ và `total_cost_usd` khớp hệ số 2 [Nguồn: phiên phát triển]. Hook `turn.complete` chỉ nhận tổng `cache_creation_input_tokens`, không tách bậc, nên mod không tự nhận ra được; phép đo chưa được kiểm trên mọi tài khoản. Tự đo trên máy của mình:

```
claude -p "ok" --model haiku --output-format json | jq .usage.cache_creation
```

`ephemeral_1h_input_tokens` lớn hơn 0 và `ephemeral_5m_input_tokens` bằng 0 thì giữ mặc định. Ngược lại thì đặt `cacheWrite` 1.25 và `cacheTtlMinutes` 5. Người dùng đã lưu `cacheTtlMinutes` 5 từ bản cũ cần đổi cặp này; `/conductor status` in cặp đang dùng và cảnh báo khi hai option không cùng một bậc.

### Khi nào nên tắt

- Phiên rất ngắn (một đến hai prompt): mỗi prompt thêm một lượt gọi router trước khi Claude bắt đầu (xem "Giới hạn đã biết" về độ trễ và chi phí), lợi ích ít khi bù. Đặt `routing` là `off` để tắt hẳn, hoặc `subagents` để chỉ điều phối subagent và giữ nguyên cache luồng chính.
- Đang chủ ý thử một model hay effort cụ thể (so sánh, benchmark): đặt `sessionModel` là `fixed` (giữ model, chỉ chỉnh effort) hoặc `off`.
- Dùng gateway hay model ID riêng không thuộc họ haiku, sonnet, opus, fable: khai `modelMap` và `contextWindows`, hoặc `off`.
- Đã quen đặt model theo từng việc bằng tay và không cần nhắc việc giao subagent: `suggest` chỉ hiển thị đề xuất, không ép.

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
  hooks/parts/quota.ts         bảo vệ hạn mức: số đo hạn mức, dừng mềm ở tool.call, dừng cứng dự phòng, vòng đời điểm dừng
  hooks/parts/progress.ts      phản chiếu TodoWrite, TaskCreate, TaskUpdate (luồng chính và subagent) để vẽ tiến độ
  hooks/parts/ui.tsx           band và pane
  hooks/lib/router.ts          system prompt và request của router, đọc JSON trả về, kẹp theo chính sách, hỏi lại một lần
  hooks/lib/decisions.ts       dòng log quyết định JSONL
  hooks/lib/scale.ts           nhãn độ sâu, khối lượng, bản chất, quan hệ; tier cũ
  hooks/lib/cost.ts            bảng giá có ngày, ghi đè giá, hệ số ghi cache, cửa sổ mặc định, chi phí turn và ghi lại cache
  hooks/lib/ledger.ts          sổ chi phí theo nhóm, phiên và mục tiêu; hiệu chỉnh; token ra theo dạng việc; cơ sở so với chạy thuần
  hooks/lib/route.ts           chính sách model của phiên, nâng theo bằng chứng, quyết định đổi có tính cache, khớp việc đã phân
  hooks/lib/drift.ts           điểm vào công khai (chỉ re-export) của phần phát hiện lặp, lan man, lạc phạm vi, checkpoint và đối chiếu evidence
  hooks/lib/drift/tool.ts      kiểu và hàm nền: quan sát tool call, đường dẫn file, file kế hoạch
  hooks/lib/drift/verify.ts    nhận diện lệnh kiểm tra: bảng trình chạy, dạng bọc, kiểm tĩnh, checkCommands, lệnh tự sửa
  hooks/lib/drift/readonly.ts  tách đoạn lệnh Bash và nhận ra lệnh chỉ đọc
  hooks/lib/drift/scope.ts     chuẩn hóa đường dẫn, đối chiếu file với phạm vi
  hooks/lib/drift/classify.ts  phân loại lệnh Bash theo từng đoạn: lệnh kiểm tra, tác động ghi, file đích, mức che mã thoát
  hooks/lib/drift/effects.ts   hiệu ứng của một tool call: có chạy kiểm tra không, loại kiểm tra, có ghi file không
  hooks/lib/drift/output.ts    output của lệnh kiểm tra: dấu hiệu lỗi và báo cáo tổng kết đầy đủ theo từng trình chạy
  hooks/lib/drift/tracker.ts   theo dõi một turn của luồng chính và tổng kết cuối turn
  hooks/lib/drift/evidence.ts  dấu vết thực thi của một mục tiêu (lệnh đã chạy kèm kết quả, các lần ghi)
  hooks/lib/drift/identity.ts  danh tính của lệnh kiểm tra, để so khớp nghiêm ngặt
  hooks/lib/drift/claims.ts    đối chiếu evidence của "verified" với dấu vết thật
  hooks/lib/drift/suggest.ts   ví dụ cho option checkCommands, lấy từ lệnh script đã chạy trong mục tiêu (dạng sẽ khớp, từ kiểm ở đầu tên script, không gợi ý tiền tố thư mục)
  hooks/parts/turn-fault.ts    turn lỗi của luồng chính: Core.turnFault, nhãn status, netResume
  hooks/parts/compact.ts       session.compact: nối khối giữ mục tiêu vào instructions, đặt lời nhắc sau nén
  hooks/lib/drift/steps.ts     phân loại bước checklist: đã đóng hẳn, đang chờ hoặc bị chặn, khôi phục được
  hooks/lib/drift/inline.ts    sqlite3 và python nội dòng (-c, heredoc) có chỉ đọc không; inline-sql.ts và inline-py.ts là phần SQL và Python
  hooks/lib/plan.ts            schema và reducer của tool plan
  hooks/lib/quota.ts           ngưỡng, vùng dừng, số đo cũ, trạng thái dừng và đếm từ chối (hàm thuần)
  hooks/lib/checkpoint.ts      điểm dừng: khóa theo thư mục, kẹp kích thước, bỏ bản thừa, file đổi sau lúc dừng (hàm thuần)
  hooks/lib/mirror.ts          danh sách việc phản chiếu và checklist để hiển thị (hàm thuần)
  hooks/lib/progress.ts        tiến độ từng việc: việc chính, việc router phân, việc Claude tự giao (hàm thuần)
  hooks/lib/state.ts           giá trị khởi tạo, chuẩn hóa trạng thái cũ, reducer thuần, cất và khôi phục mục tiêu
  hooks/lib/text.ts            mọi văn bản gửi model và hiển thị
  hooks/ui/band.tsx            band phía trên prompt
  hooks/ui/pane.tsx            pane chi tiết
  hooks/ui/labels.ts           nhãn vi/en của band và pane
  hooks/ui/style.ts            token màu, ký hiệu, giai đoạn và thanh tiến độ của band và pane
  types/index.d.ts             type contract của $.state
  tests/                       theo chức năng: logic thuần (router, chi phí và sổ, giá, ngưỡng, trạng thái, lợi ích ròng), golden-set, giao diện
  tests/shell/                 phân loại lệnh Bash, mã thoát, đích ghi file, phạm vi
  tests/output/                báo cáo của từng trình chạy test (Node, Go, Cargo, Jest, Vitest, Mocha, Bun, Pytest)
  tests/evidence/              danh tính lệnh, đầu cụm claim, độ mạnh của evidence, gợi ý checkCommands
  tests/integration/           qua engine của `claude plugin test` (router giả lập): router đọc prompt, điều phối, subagent, checklist và Stop, lệnh /conductor, giao diện, kịch bản đầu cuối
  tests/support/engine.ts      khung chạy test tích hợp dùng chung (đồng hồ giả, router giả lập, các câu trả lời mặc định)
  tests/support/commands.ts    dựng tool call giả (Bash, Edit) và brief mẫu cho test lệnh và evidence
  tests/support/quota.ts       số đo hạn mức giả và kho $.store trong bộ nhớ cho test bảo vệ hạn mức
  tests/golden/                golden-set của router: 34 prompt mẫu (5 ca đối kháng, 2 ca đọc yêu cầu của 0.7.0, 2 ca prompt dài tiếng Việt của 0.7.2), kỳ vọng, câu trả lời router thật đã ghi cùng băm request và tỷ lệ đạt
  tests/fixtures/prompt-k4.ts  prompt dài tổng hợp (ẩn danh), dùng để kiểm request gửi router và phân việc nhiều mục
  scripts/eval-router.ts       eval router thật trên golden-set, nhiều lần mỗi ca (không chạy trong CI)
  scripts/mutants.ts           1307 định nghĩa đột biến (194 cũ cho hooks/lib/drift/, 150 mới của 0.5.4 cho giá, router, sổ chi phí, giao diện, nhận diện lệnh, 7 mới của 0.5.5 cho giá trị tùy chọn đặt trong nháy, 84 mới của 0.5.6 cho gợi ý checkCommands, waiting, cập nhật hàng loạt, kết quả gọn và lệnh nội dòng chỉ đọc, 147 mới của 0.6.0 cho bảo vệ hạn mức, 99 mới của 0.6.1 cho điểm dừng không cần tool call, giao diện hạn mức, tám test còn thiếu của 0.5.6, thanh tiến độ và kết cục của subagent theo reason của turn.complete, 71 mới của 0.7.0, 15 mới của 0.7.1 cho verified của danh sách phản chiếu, 51 mới của 0.7.2 cho bằng chứng lỗi router, mục tiêu tối thiểu, hạn chung của router và pane tự mở cho khôi phục checklist, phạm vi theo ranh giới thư mục, tier và mức nâng, tự nâng và hạ verified, giám sát giữa phiên và đọc yêu cầu của router, 100 mới của 0.7.3 cho lệnh kiểm riêng, gợi ý checkCommands, plan set một dòng, turn lỗi và netResume, 117 mới của 0.7.4 cho sàn model, nhịp checkpoint, báo hạn mức mềm và giữ mục tiêu qua lần nén, 136 mới của 0.7.5 cho các điểm A1 tới A8, B1 tới B14, C1 tới C6 và D1, 145 mới của vòng sửa 2 của 0.7.5 cho H1, H2, M1 tới M11 và L1 tới L8, trừ 9 mẫu bỏ vì đoạn mã không còn; dữ liệu thuần)
  scripts/mutate.ts            chạy đột biến, khôi phục tệp gốc, in sha256 trước và sau
  tsconfig.json                cấu hình type-check độc lập (cần tệp khai báo do engine sinh, xem "Phát triển")
  LICENSE                      MIT
  CHANGELOG.md                 lịch sử thay đổi theo bản
  docs/DESIGN.md               cách hoạt động chi tiết và hợp đồng đối chiếu evidence của verified
  docs/VERIFICATION.md         số đo kiểm chứng của HEAD hiện tại và của các bản trước
.github/workflows/focus-conductor.yml   (ở gốc repo) validate mod và marketplace, chạy test của mod
```

Kiểm tra trước khi phát hành: `claude plugin validate .` và `claude plugin test .` (số test hiện hành ở [docs/VERIFICATION.md](docs/VERIFICATION.md); gồm replay offline golden-set và test tái hiện từng lỗi của các vòng review, nay xếp theo chức năng ở `tests/shell/`, `tests/output/`, `tests/evidence/`, `tests/integration/`). Đổi prompt router thì chạy lại `bun scripts/eval-router.ts --model sonnet --runs 3 --record` để chấm router thật và ghi câu trả lời mới cho golden-set.

[CHANGELOG.md](CHANGELOG.md) và [docs/VERIFICATION.md](docs/VERIFICATION.md) nêu, ở các bản cũ, tên tệp test theo vòng review (`tests/review05*.test.ts`, `tests/hooks.test.ts`). Các tệp đó đã được tách theo chức năng vào các thư mục trên và bộ hàm dựng chung vào `tests/support/`; tên `describe` và `test` giữ nguyên, nên tìm một test cũ bằng tên của nó (tập tên của 563 test trước và sau khi tách trùng nhau).

## Phát triển

```
cd claude-mods/focus-conductor
claude plugin validate .                  # manifest, module hooks (hook gating thiếu .catch bị nêu ở đây)
claude plugin test .                      # toàn bộ test, offline, router giả lập
bunx tsc -p tsconfig.json                 # type-check strict
bun scripts/eval-router.ts --runs 3       # router thật, cần Claude Code đã đăng nhập; thêm --record để ghi golden-set
bun scripts/mutate.ts --check             # mọi mẫu đột biến còn khớp đúng một lần
bun scripts/mutate.ts                     # chạy đột biến (khoảng 30 giây mỗi mẫu); khôi phục tệp gốc sau từng mẫu
```

- `tsc` cần các tệp khai báo mà engine ghi vào `.claude-plugin/types/` (đã `.gitignore`) mỗi khi nạp mod từ thư mục của người dùng. Trên clone sạch, mở một phiên `claude --plugin-dir .` một lần trước. Gói npm `@anthropic-ai/claude-code` không chứa các tệp này nên CI không chạy `tsc`.
- `tsconfig.json` được commit và độc lập (không `extends` thư mục do engine sinh), dùng đúng các tùy chọn mà đầu tệp khai báo của engine khuyến nghị. Engine tự ghi `tsconfig.json` cho mod chưa có; việc engine có giữ nguyên tệp đã commit khi nạp mod trong phiên tương tác chưa được kiểm.
- CI (`.github/workflows/focus-conductor.yml` ở gốc repo) chạy trên mọi pull request và push lên `main`, không lọc `paths` để check bắt buộc không treo ở PR không đụng mod: cài `@anthropic-ai/claude-code@2.1.296` (ghim), `claude plugin validate` cho mod và marketplace, rồi `claude plugin test`. Bật check đó thành bắt buộc là việc của người quản lý repo.
- Đột biến: thêm mẫu vào `scripts/mutants.ts` (một lần thay đúng một chỗ), `--check` báo mẫu nào không còn khớp đúng một lần sau khi mã đổi. Đột biến sống sót nghĩa là có hành vi chưa được test ghim hoặc có đoạn mã thừa; mẫu tương đương thì ghi lý do vào trường `equivalent`.
- Golden-set: `tests/golden/replies.ts` ghi câu trả lời router thật kèm SHA-256 của request đã gửi (system prompt, catalog giá của bảng kèm mod, ngữ cảnh, nội dung đã qua `fence`). Đổi prompt router hay định dạng request thì băm lệch và `golden.test.ts` đỏ cho tới khi chạy lại `--record`.
- Giấy phép MIT (`LICENSE`).

## Giới hạn đã biết

- Mỗi prompt thêm một lượt gọi model router trước khi Claude bắt đầu làm (trừ câu trong `routerSkip`). Đo bằng `scripts/eval-router.ts` với router `sonnet`, ngày 2026-10-10, trên bộ golden-set 16 ca lúc đó (trước khi thêm 5 ca đối kháng; bộ hiện tại 21 ca) [Nguồn: eval trong phiên phát triển]: prompt ngắn và vừa 5 đến 9 giây, dưới $0,04 mỗi lượt; prompt cỡ K4 (37.000 ký tự, 14 mục) khoảng 14 giây và khoảng $0,10. Router `haiku` trên cùng bộ đạt 14 đến 15/16 ca qua ba lần chạy, và trượt ở chỗ khác nhau mỗi lần: ca K4 đối chiếu (không tách việc nào, hoặc xếp bản chất là mixed) và ca sáu việc (luồng chính sonnet thay vì opus). Vì vậy `sonnet` vẫn là mặc định.
- Đính chính so với README 0.4.0: lượt eval trước đó bị chính mod (bản phát triển đang bật trên máy) điều phối lại request của router, nên model thật sự trả lời khác model yêu cầu. Script eval giờ chạy mỗi lượt với `CLAUDE_CONFIG_DIR` riêng và in model thật sự trả lời; số liệu ở mục trên là của lượt đã tách.
- Chất lượng điều phối phụ thuộc model router. Code chỉ kẹp theo chính sách, không sửa phán đoán của router. Golden-set chấm theo khoảng chấp nhận được (họ model, số việc, quan hệ), không theo một câu trả lời duy nhất; đây là kiểm tra trong phiên phát triển, không phải số đo độc lập.
- Router lỗi thì prompt đó không được điều phối (trừ khi bật `routerFallback: reuse`); mod không có phương án đoán thay. Dùng `/conductor reroute` khi router đã ổn lại.
- Mod không chặn hẳn Claude tự làm việc đã ghi giao subagent: `strictDelegation: block` chỉ từ chối tối đa `blockLimit` lần (tối đa 10) mỗi mục tiêu rồi chuyển sang nhắc. Không có mức chặn vô hạn, có chủ ý: việc không giao được (subagent lỗi lặp, người dùng từ chối) sẽ làm phiên kẹt.
- `verified` dựa trên kết quả thật của lệnh (mã thoát, dấu hiệu lỗi trong output của các trình chạy phổ biến, thứ tự với thay đổi cuối), nhưng mod không đọc số test pass, độ bao phủ hay việc bộ test có phủ đúng thay đổi không; tiêu chí nghiệm thu và tiêu chí chất lượng được nhắc để Claude đối chiếu, không được máy chấm. Trình chạy test chưa nhận diện được báo cáo tổng kết, hoặc kiểm tra nối ống không sang bộ lọc chỉ đọc từ ống, thì không được tính là đạt dù mã thoát 0; chấp nhận một số kiểm tra thật bị coi là chưa xác minh. Parser dựa trên output thật ghi trong `tests/fixtures/runner-output.ts` (Node v22.22.0, go1.24.7, Cargo 1.97.0); reporter đổi định dạng ở phiên bản khác thì kết quả là chưa xác minh, không phải đạt nhầm. Bộ test cố ý in dòng `Error:` hay `Traceback` khi chạy qua ống cũng bị coi là chưa xác minh. Parser loại các ca mơ hồ và false positive đã biết; không chứng minh được tính trung thực của một chương trình từ output của chính nó. Từ 0.7.0 mod tự nâng `done` thành `verified` khi một lệnh test chạy đạt sau thay đổi cuối, và `verified` do Claude ghi chỉ cần đã có lệnh test đạt đó; script riêng của dự án cần nằm trong `checkCommands` để mod nhận ra là lệnh test, nếu không bước vẫn ở `done`. Khi chưa có lần chạy test đạt sau thay đổi cuối, evidence phải nêu đủ danh tính lệnh (kể cả đối số như đường dẫn test hay file cấu hình, tiền tố `npx` cùng cờ của nó, biến môi trường, và mọi tùy chọn ngoài danh sách cờ trình bày) rồi kết thúc lệnh ở ranh giới, nên evidence viết tắt (`tsc sạch` hay `tsc -p tsconfig.json: sạch` cho `npx tsc -p tsconfig.json`), viết kết quả liền sau lệnh không có dấu câu (`npm test 12 pass`), hay nêu bộ lọc khác lần chạy bị lưu là `done`; so khớp nghiêm ngặt chấp nhận từ chối cả evidence tương đương về ngữ nghĩa. Lý do khi từ chối là trung tính: không tìm thấy lần chạy khớp chính xác (có thể do chưa chạy, khác phạm vi, hay thiếu dấu ngăn cách). Mod không phân tích câu phủ định: evidence nhắc một lệnh chưa chạy bị từ chối dù câu nói "chưa chạy"; ngược lại, lệnh đã chạy đạt mà evidence lại nói "chưa chạy" thì vẫn được tính. Dấu chấm cuối câu sau tên file được bỏ; `./....` (dấu chấm liền sau `./...`) giữ nguyên nên không khớp. Dấu vết thực thi nằm trong bộ nhớ: hot-reload mod làm mất nó, khi đó `verified` của mục tiêu đang làm cần chạy lại lệnh kiểm tra.
- Đối chiếu evidence của `verified` (khi chưa có lần chạy test đạt) theo hợp đồng danh tính lệnh kiểm tra và đầu cụm của claim: so khớp nghiêm ngặt, chấp nhận từ chối cả evidence tương đương về ngữ nghĩa; chi tiết trong [docs/DESIGN.md](docs/DESIGN.md).
- Router đọc prompt liệt kê `requirements` và chia việc theo `covers`, nhưng đó vẫn là phán đoán của một model: yêu cầu bị bỏ sót hay liệt kê thừa vẫn xảy ra (golden-set 32 ca, 3 lần mỗi ca, router `sonnet`: 90 trên 90 lượt đạt trước khi thêm hai ca mới, 6 trên 6 ở hai ca mới). Code chỉ nhắc yêu cầu chưa có việc nào phủ; không tự thêm việc. Từ 0.7.4 bộ có 35 ca, gồm một prompt tự viết 29.511 ký tự với 11 bước có mã: 11 việc tách riêng và quy định model đứng đầu ràng buộc ở 5 trên 5 lượt, router liệt kê 19 tới 23 yêu cầu (dưới trần 30) [Đo trực tiếp qua `claude -p`]. Chưa kiểm với prompt rất dài trên tài khoản thật.
- Mục tiêu tối thiểu khi router lỗi (0.7.2) chỉ có câu mục tiêu cắt từ prompt, không phân việc, không chọn model, không cảnh báo ngân sách; mod không đoán thay router. Pane tự mở (`autoPane`) chưa kiểm trên app desktop thật (pane nằm cạnh transcript hay trên prompt tùy chế độ toàn màn hình và độ rộng), và hook `ui.close` ghi nhận lần người dùng tự đóng chỉ có test hàm thuần vì kit kiểm thử không phát được sự kiện này.
- Lượt kiểm lạc đề (`semanticDrift`, bật mặc định từ 0.7.0) thêm một lần gọi router cho mỗi checkpoint, tối đa một lượt mỗi 10 phút; chi phí thật qua engine chưa đo, số ở mục "Giám sát giữa phiên" là đo qua `claude -p`.
- Giám sát phạm vi là giám sát, không phải phân quyền hệ thống tệp: file đích của lệnh Bash được đọc từ cú pháp lệnh (chuyển hướng, `tee`, `sed -i`, `cp`, `mv`, `rm` và các lệnh tương tự); script, trình cài gói, `awk` ghi file hay đường dẫn chứa biến chỉ được cảnh báo là không xác định được đích. Symlink không được phân giải (mod không đọc hệ thống tệp). Phân tích shell không đầy đủ: cấu trúc mod chưa hiểu được xử lý theo hướng chưa kiểm tra và có thể đã ghi.
- Thư mục gốc của phạm vi là `$.session.root()` lúc mục tiêu bắt đầu; engine không trả được thì mọi lần ghi khi có giới hạn phạm vi chỉ được báo là không xác định được phạm vi.
- Mod không đọc được nội dung suy luận hay câu trả lời của model. Theo dõi lạc đề dựa trên hành vi gọi tool; `semanticDrift` (bật mặc định từ 0.7.0) để router đọc các lệnh và file gần đây, không đọc suy luận.
- Engine chỉ báo nguồn đổi model qua `classic.PostModelSwitch`. Không có hook này thì mod không phân biệt được engine tự đổi với người dùng đổi, và tạm ngừng điều phối luồng chính tới mục tiêu mới.
- Agent của workflow có thể chạy bước đầu trước khi mod kịp ghi điều phối (engine không có hook trước khi agent khởi động). Agent đó không bị ép ở các bước sau, để không phá cache của nó, và nhật ký ghi rõ.
- Agent ngoài điều phối (không qua `agent.spawn` của mod) chỉ được đếm và liệt kê; mod không chấm, không ép, không đo được chi phí của nó.
- Bảng giá kèm mod ghi ngày 2026-10-13 [Nguồn: trang giá Anthropic]; quá 30 ngày thì `/conductor status` cảnh báo (giá đọc cache của Sonnet 5.5 đã đổi từ $0,20 sang $0,10 ngày 2026-10-07, nhanh hơn chu kỳ 180 ngày của bản trước). Giá Haiku 5.5 cho prompt trên 100K token được tính riêng, kể cả đọc cache ($0,05). Hệ số ghi cache và thời gian sống của cache đi cặp theo bậc (xem "Đo bậc cache"). Kích thước turn ước lượng là giả định, được hiệu chỉnh dần từ số đo trong phiên.
- Lợi ích ròng so với chạy thuần là ước tính, không phải số đo: nó tính lại các lượt đã đo như thể chạy toàn bộ bằng model của phiên với đúng số token đã có (token ra của model hay effort khác nhau không được tính chênh lệch), trừ chi phí router. Phần ghi lại cache do mod đổi model hay effort giữa hai turn được tính theo giá đọc ở phía chạy thuần, chặn trên bằng số token ghi thực của lượt, nên con số thiên về thấp; không bù khi cache đã nguội hay vừa nén, hay khi chính người dùng đổi model hay effort. Chất lượng đầu ra không được tính.
- Một số trạng thái cục bộ nằm trong bộ nhớ của mod và mất khi nạp lại module (hot reload): dấu vết thực thi dùng để đối chiếu `verified`, bộ đếm turn, danh sách model tạm ngừng, thống kê độ trễ router, việc giao subagent đang chờ. Mục tiêu, checklist, sổ chi phí và cơ sở so với chạy thuần nằm trong `$.state` nên được giữ.
- Nhận diện lệnh tự sửa dựa trên cờ và tên script đã biết (`--fix`, `--write`, `--apply`, `-w` của prettier, `ruff format` không kèm `--check` hay `--diff`, script `*:fix` và `format`). Token trong nháy được bỏ nháy trước khi xét cờ (`eslint "--fix"`, `--fix="true"`, `npm run "lint:fix"` đều là tự sửa, như shell chạy); riêng token nháy trọn vẹn đứng ngay sau một tùy chọn không có dấu `=` được coi là giá trị của tùy chọn đó (để `pytest -k '--fix'` không bị coi là tự sửa), trừ dấu `--` (hết tùy chọn: `npm run lint -- "--fix"` vẫn truyền `--fix`), nên `eslint --quiet "--fix" .` vẫn bị bỏ sót vì mod không biết `--quiet` có nhận giá trị không. Công cụ tự sửa bằng cờ khác, hay tự sửa trong một script đóng gói không nêu cờ (`npm run lint` mà script nội bộ có `--fix`), không nhận ra được; khi đó mod coi là lệnh kiểm tra nếu thuộc danh sách trình chạy. `gofmt -l` không được nhận là lệnh kiểm tra vì thoát mã 0 dù có tệp chưa format. Lệnh khai trong `checkCommands` được tin mã thoát như mọi lệnh kiểm tra.
- Nhận diện lệnh nội dòng chỉ đọc (0.5.6) chỉ áp cho `sqlite3` và `python`, `python3`, `python3.N` có mã nằm ngay trong lệnh (`-c`, đối số SQL, heredoc); script nằm trong tệp (`python3 check.py`) không thấy được nên vẫn là ghi có thể. Mặc định là ghi, chỉ chỉ đọc khi chứng minh được bằng danh sách cho phép nhỏ (SQL: `SELECT`, `EXPLAIN`, `WITH ... SELECT`, vài `PRAGMA` đọc, vài lệnh chấm; Python: vài module chuẩn, `open` chế độ đọc, `.execute` với SQL literal chỉ đọc); mọi dạng không phân tích được là ghi, kể cả đối số có `$` hay `\`, `re.compile` (vì `compile` bị cấm theo chữ), `psql`, `duckdb`, `curl`, và hai heredoc trên cùng một dòng. Đây là giám sát sai sót thông thường của model, không phải chặn người cố né.
- Sổ chi phí chỉ gồm số đo của các lượt đã kết thúc. Subagent đã giao mà chưa kết thúc có dòng ước tính riêng, dựa trên token ra giả định theo khối lượng việc và hệ số hiệu chỉnh; dòng đó được thay bằng số đo khi agent kết thúc.
- Một họ model lỗi (không phản hồi) ở một turn thì turn đó quay về model của phiên; lỗi ở hai turn liên tiếp thì bị tạm ngừng dùng 5 turn rồi thử lại.
- Nhãn tiếng Anh (`uiLanguage: en`) chỉ áp cho nhãn cố định của band và pane; thông báo, cảnh báo và khối gửi Claude vẫn bằng tiếng Việt.
- Bảo vệ hạn mức (0.6.0) không bảo đảm tuyệt đối biên 5% hay 2%: số đo của engine là của phản hồi API gần nhất nên có độ trễ, và một turn có thể ăn nhiều hơn biên trước khi tool call kế tiếp đến. Muốn chắc hơn thì nâng hai option ngưỡng.
- Mod chỉ dừng ở ranh giới tool call: một lệnh Bash đang chạy rất lâu không bị cắt giữa chừng (dừng cứng chỉ xảy ra ở tool call kế tiếp).
- Báo hạn mức mềm (0.7.4) chỉ là lời nhắc: Claude có áp quy tắc dừng của prompt hay không là việc của Claude, và câu báo chỉ đến ở tool call kế tiếp của luồng chính (turn chỉ trả lời bằng chữ không nhận). Muốn chắc chắn dừng thì dùng ngưỡng dừng cứng.
- Giữ mục tiêu qua lần nén (0.7.4) dựa trên khai báo `session.compact` của engine; chưa kiểm trên engine thật, và đường dự phòng theo context giảm mạnh chỉ đo ở step đầu mỗi turn nên lời nhắc có thể đến muộn một turn khi chỉ đường dự phòng thấy lần nén.
- Không có dữ liệu hạn mức khi không dùng gói subscription (engine trả mảng rỗng) hay trước lần đọc đầu tiên; khi đó mod không dừng gì và `/conductor status` ghi lý do.
- Kho `$.store` của mod dùng chung mọi dự án, tối đa 4 MiB [Nguồn: khai báo kiểu của engine 2.1.300]; điểm dừng khóa theo thư mục gốc của phiên, tối đa năm bản, mỗi bản tối đa 64 KiB. Kho từ chối ghi thì điểm dừng chỉ còn trong phiên hiện tại và có toast báo.
