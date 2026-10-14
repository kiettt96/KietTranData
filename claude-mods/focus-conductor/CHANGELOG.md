# Lịch sử thay đổi

Các bản của focus-conductor, mới nhất trước. Số đo kiểm chứng của HEAD hiện tại nằm ở [docs/VERIFICATION.md](docs/VERIFICATION.md); cách dùng và tùy chọn ở [README](README.md).

## Thay đổi 0.5.4 theo đánh giá toàn mod

Một lượt rà soát toàn mod trên `8820125` (0.5.3) nêu 19 hạng mục. Mỗi điểm được kiểm lại trên mã và công cụ thật trước khi sửa; các điểm không đúng hay chỉ đúng một phần được ghi rõ bên dưới. Phần tái cấu trúc (mục 15) nằm ở PR riêng, README được tách ở PR sau đó.

- **Giá và ghi cache (mục 1).** Đúng. Trang giá Anthropic ngày 2026-10-13 ghi đọc cache của Sonnet 5.5 là $0,10 (giảm từ $0,20 ngày 2026-10-07); Opus $0,20, Fable $0,25, Haiku $0,01 (prompt trên 100K: $0,05); ghi cache 1,25 lần giá vào ở bậc 5 phút và 2 lần ở bậc 1 giờ [Nguồn: trang giá Anthropic, 2026-10-13]. `cost.ts` cập nhật giá và ngày, cảnh báo giá cũ sau 30 ngày (trước đó 180). Catalog giá trong system prompt của router dựng từ bảng giá đang dùng thay vì chép tay. `prices` thiếu giá trị thứ ba thì đọc cache theo tỷ lệ của đúng họ. Thêm `cacheWrite` (kẹp 1,25 đến 2, mặc định 2) đi cặp với `cacheTtlMinutes` (mặc định 60); `usdOf` và `switchCost` dùng chung hệ số; `/conductor status` in cặp và cảnh báo khi lệch. Đo ở một phiên `claude -p --model haiku`: `cache_creation` 44.607 token nằm hết ở `ephemeral_1h`, `total_cost_usd` 0,008954 khớp hệ số 2 (hệ số 1,25 cho 0,005609). `ModelUsage` của hook chỉ có tổng `cache_creation_input_tokens`, không tách bậc, nên mod không tự nhận ra; mặc định bậc 1 giờ chưa kiểm trên máy người dùng (xem "Đo bậc cache").
- **Golden-set (mục 2).** Đúng. Ba ca `list`, `race`, `three` trùng hay gần nguyên văn ví dụ trong system prompt của router, và ca `six` còn chứa hai đoạn của ví dụ (phát hiện khi viết test so trùng). Đã viết lại bốn ca, thêm chín ca ngoài prompt, thêm test báo ca trùng ví dụ. `replies.ts` ghi kèm SHA-256 của request đã gửi (system prompt, catalog giá của bảng kèm mod, ngữ cảnh) và tỷ lệ đạt: đổi prompt router hay định dạng request mà chưa ghi lại thì `golden.test.ts` đỏ. Ghi lại bằng router thật `sonnet`, ba lần mỗi ca. Sau khi bỏ chỗ trùng, ca `six` chỉ đạt 2/3: một lượt chọn sonnet/medium cho luồng chính thay vì opus, tức là bộ cũ đã che mất một chỗ yếu.
- **CI và type-check (mục 3).** Đúng. Thêm `.github/workflows/focus-conductor.yml` (mọi pull request và push lên `main`, không lọc `paths`; validate mod và marketplace, chạy `claude plugin test`) và `tsconfig.json` độc lập. CI không chạy `tsc` vì gói npm không có tệp khai báo của mod (engine sinh khi nạp mod). Chưa kiểm được trong phiên tương tác việc engine có giữ nguyên `tsconfig.json` đã commit hay không.
- **Giao diện trên engine thật (mục 4).** Đúng; chưa có ảnh chụp band và pane trên engine thật (việc của người dùng).
- **Lệnh kiểm tra và lệnh tự sửa (mục 5 và 6).** Đúng, và rộng hơn báo cáo: `prettier --check`, `black --check`, `cargo fmt --check`, `npm run format:check`, `terraform fmt -check` bị tính là thay đổi (lệnh lạ, mức possible), còn `eslint --fix`, `npm run lint:fix`, `ruff check --fix`, `ruff format`, `biome check --write` và `--apply` lại được tính là lệnh kiểm tra. Nay trình chạy đã biết được bọc bởi `npx`, `pnpm exec`, `pnpm X`, `yarn X`, `bunx`, `uv run`, `poetry run`, `bundle exec`, `./node_modules/.bin` vẫn là lệnh kiểm tra, danh tính giữ nguyên tiền tố; phần bọc không biến lệnh lạ thành kiểm tra (`pnpm add`, `yarn install`, `bunx create-x` vẫn là ghi). Thêm `deno test`, `rspec`, `phpunit`, `swift test`, `tox`, `./gradlew test|check`, `./mvnw test|verify` và các kiểm tĩnh `prettier|black --check`, `ruff format --check`, `cargo fmt --check`, `terraform fmt -check|validate`, `shellcheck`, `format:check`. Lệnh tự sửa (`--fix`, `--write`, `--apply`, `-w` của prettier, `ruff format` không `--check` hay `--diff`, script `*:fix` và `format`) là tác động ghi mức possible, không phải lệnh kiểm tra. `gofmt -l` không được nhận (liệt kê file chưa format nhưng thoát 0). Thêm option `checkCommands` và dòng `verify-reject` trong log quyết định khi `verified` bị hạ xuống `done`.
- **Test cho các ngưỡng (mục 7).** Đúng: 18 chỗ test đặt token cache bằng 0, tám lần gọi Stop đều `stop_hook_active: false`, và repo không giữ script đột biến. Thêm `usdOf` với đủ bốn loại token ở cả hai bậc, `Stop` với `stop_hook_active: true`, ngưỡng tin cậy 0,4 hai phía, cất tối đa ba mục tiêu, cache nguội đúng ranh giới TTL, ngữ cảnh co 60%. `scripts/mutants.ts` và `scripts/mutate.ts` giữ 194 mẫu đột biến của các vòng trước cộng 150 mẫu mới; `mutate.ts` chạy trên bản sao nên không bao giờ để lại tệp bị đột biến.
- **Nút Đặt lại (mục 8).** Đúng: trước đây bấm là xóa ngay, không `$.ui.status`, không test. Nay hai bước: bấm lần đầu ghi mốc `resetArmedUntil` (10 giây), nhãn đổi, toast, `$.clock.after` vẽ lại và báo hủy khi hết hạn; bấm lần hai mới xóa và cập nhật dòng trạng thái. Dòng chú thích dưới nút và `/conductor reset` ghi đủ phạm vi (có mục tiêu đã cất) và phần được giữ.
- **Lợi ích ròng (mục 9).** Đúng: sổ đã lưu token theo nhóm nhưng chưa có cơ sở so sánh. Thêm `Ledger.baseline` và dòng "So với chạy thuần" (cùng số token, giá model phiên, trừ chi phí router, phần ghi lại cache do mod đổi model hay effort tính theo giá đọc, chặn trên bằng số ghi thực; không bù khi cache nguội, vừa nén hay người dùng tự đổi). Là ước tính, không phải số đo (xem "Giới hạn đã biết").
- **Tái cấu trúc (mục 15).** Đúng; làm ở PR riêng không đổi hành vi, sau khi bộ đột biến và CI đã có.
- **Hook gating thiếu `.catch` (mục 11).** Đúng: `prompt.submit`, `tool.call{Agent}`, `tool.check{plan}`; đã thêm, `claude plugin validate` hết nhắc.
- **Request router (mục 12).** Đúng: `prev.goal`, tên việc, mô tả và prompt agent, dòng lệnh, câu trả lời trước được nối vào request không trung hòa thẻ. Một hàm `fence` đổi `<` của thẻ `request`, `context`, `task`, `previous_answer` (mở hay đóng, mọi kiểu viết hoa, có khoảng trắng) thành `&lt;` cho mọi giá trị nội suy; mỗi chỗ nội suy có test riêng.
- **Log quyết định (mục 13).** Đúng: log trích 300 ký tự đầu của prompt mà mô tả option không nói; đã ghi vào `plugin.json` và README.
- **Fixture cá nhân (mục 14).** Đúng, repo công khai. `tests/fixtures/prompt-k4.ts` thay bằng prompt tổng hợp cùng cấu trúc (mã `K4.0` đến `K4.11`, hơn 12.000 ký tự); `replies.ts` ghi lại từ prompt mới. Lịch sử git không bị viết lại, nên các commit cũ vẫn chứa nội dung cũ.
- **Option (mục 16).** `contextWindows` ví dụ `haiku=1000000`; mô tả `prices` nêu giá trị thứ ba và tỷ lệ mặc định; `cacheTtlMinutes` giữ kiểu chuỗi (đổi sang số làm mod không nạp với người dùng còn giá trị chuỗi), mặc định `"60"`; `cacheWrite` kiểu số, kẹp trong mã vì giá trị ngoài khoảng trong manifest cũng làm module không nạp.
- **Giấy phép (mục 17).** Thêm `LICENSE` MIT; chưa tách repo.
- **Tài liệu (mục 18 và 19).** README thêm "Phát triển", "Khi nào nên tắt", "Đo bậc cache", và nêu trạng thái cục bộ mất khi nạp lại module. Mục 10 (tách README) làm ở PR sau cùng.

## Thay đổi 0.5.3: giao diện band và pane

Bản vá giao diện (PR #15), chỉ đổi `hooks/ui`, `hooks/parts/ui.tsx` và test; không đổi logic điều phối hay xác minh.

- Band hai dòng (ba khi có cảnh báo), co giãn theo `bodyColumns` của engine; thanh tiến độ đổi màu theo bốn giai đoạn thay cho dải ký hiệu từng bước; chi phí hiện trên band. Pane gọn hơn theo mục, có chú giải ký hiệu và bảng chi phí có thanh tỷ trọng. Chỉ dùng theme key, không dùng mã màu hex, nên theo giao diện sáng hoặc tối của người dùng.
- Ngưỡng giai đoạn đổi ở hai hằng `START_BELOW` (25%) và `ALMOST_FROM` (75%) trong `hooks/ui/style.ts`; màu của từng giai đoạn đổi ở `PHASE_HUE`.
- Tăng version lên 0.5.3 để `claude plugin update` nhận được giao diện mới (cùng số version 0.5.2 thì máy đã cập nhật không nhận bản mới).
- Đánh đổi: band cao thêm một dòng khi có cảnh báo, pane dài hơn; màu vàng "sắp xong" dùng chung theme key `warning` với cảnh báo và bước bị chặn (khác nhau về hình dạng và vị trí); đầu thanh ◐ theo màu giai đoạn còn ◐ trong checklist luôn màu cam; giai đoạn chỉ tính bước đã đóng, không tính nửa bước cho bước đang làm.
- Giới hạn: độ rộng ký tự tính một ô cho mọi ký tự (`cellsOf`), nên mục tiêu có chữ CJK hoặc emoji (rộng hai ô) có thể làm dòng lệch vài ô; assertion tiếng Anh của band chỉ còn kiểm nút `Details`; chưa có bố cục hai cột cho pane inline rộng; chưa có ASCII thay cho ký hiệu khi font terminal thiếu ◐ ▎ ■ ━ ╌.

## Thay đổi 0.5.2 theo đánh giá

Review toàn bộ mod sau khi merge PR #13 nêu hai lỗi P1 và hai lỗi P2. Mỗi điểm được tái hiện trên `f6a6804` trước khi sửa.

| Điểm | Kiểm trên `f6a6804` | Xử lý |
|---|---|---|
| PR #14 vòng 5, P1: tùy chọn của wrapper nhận giá trị (`sudo -u alice`, `npx --package typescript`) làm `phraseStart` không lùi về đầu cụm | Đúng, tái hiện trên `87ad4a0`: chạy `npm test`, evidence `sudo -u alice npm test` là strong; chạy `tsc -p x`, evidence `npx --package typescript tsc -p x` là strong. Cùng loại: `nice`, `xargs`, `bunx`, `yarn tsc`, `pnpm dlx`, `poetry run`, `uv run`, `node run npm test`, `./run.sh npm test`, `foo -- npm test`, và biến môi trường có nháy `CI="1" npm test` (nháy bị tách thành ranh giới) | Viết lại `phraseStart`: token đầu tiên thuộc tiền tố trong mệnh đề là đầu cụm; `CLAIM_PREFIXES` mở rộng và chỉ dò đầu cụm; `--` neo claim; đường dẫn script liền trước; `evidenceWords` nuốt nháy và thay thế lệnh sau `NAME=` |
| Góp ý kế hoạch vòng 5: danh sách wrapper dùng chung với chuẩn hóa danh tính; `CI=1 npm test` mâu thuẫn | Không đúng với `87ad4a0`: `stripWrappers` đã bị xóa ở vòng 4 (chuyên gia đọc `0d693c4`); biến môi trường đã nằm trong `argv` của lệnh đã chạy từ vòng 4. Trang PR chuyên gia mở còn dừng ở `0d693c4`, trong khi API `get_commits` trả đủ bốn commit đến `87ad4a0` | Giữ biến môi trường là danh tính; tách hợp đồng và khóa bằng đột biến (đưa `CLAIM_PREFIXES` vào chuẩn hóa danh tính thì có test bắt) |
| PR #14 vòng 4, P1: `tsc -p x` đạt có thể được cứu bởi token con của `npx --no-install tsc -p x`; `npx tsc` và `tsc` là hai cách viết của một lệnh | Đúng: evidence `npx --no-install tsc -p x: sạch` là strong khi chỉ chạy `tsc -p x` | Danh tính lấy từ argv; tiền tố `npx` cùng cờ là một phần danh tính, claim gắn đầu cụm lệnh, không còn bỏ wrapper ở evidence |
| PR #14 vòng 4: đoạn `npm test -- npm run lint` làm claim lồng | Không tái hiện được lỗ hổng: lệnh đã chạy đúng là chuỗi đó nên evidence trích đúng nó là hợp lệ. Vẫn thu hẹp để fail closed | Chỉ `python -m <module>` là claim con hợp lệ; còn lại bị từ chối |
| PR #14 vòng 4: chuyển hướng đầu vào bị bỏ khỏi danh tính; `> out.log` cần stale | Đúng với đầu vào (`node --test < input-a` khớp evidence không nêu input). Một phần sai với đầu ra: lệnh không qua ống dựa vào mã thoát, nên không cần đọc báo cáo | Chuyển hướng đầu vào là danh tính; đầu ra không thuộc danh tính, test khóa cả hai hành vi |
| PR #14 vòng 4, tự kiểm thêm: lệnh chạy nền `npm test & echo ok` được xác minh; tiền tố biến môi trường (`CI=1 npm test`) không thuộc danh tính | Đúng, cả hai là lỗi thật | Lệnh nền không trust, `|&` là hidden; biến môi trường là tiền tố danh tính, `timeout N` giữ bỏ có chủ ý |
| P1: bằng chứng của một lệnh xác minh nhầm lệnh khác | Đúng, nặng hơn mô tả: `npm run test` đạt, `npm run lint` lỗi, evidence `npm run lint: đạt` vẫn được nhận, vì khóa so khớp là hai từ đầu (`npm run`, `node --test`) | Danh tính lệnh (`commandIdentity`): tên lệnh, lệnh con, tên script, đối số vị trí, khớp trọn từ và liền nhau; `npm test` và `npm run test` là một. Mỗi lệnh được nhắc tính theo lần chạy cuối; mọi lệnh được nhắc phải đạt sau thay đổi cuối |
| P1: parser nhận bộ đếm chưa thuộc một báo cáo hoàn chỉnh, chọn parser theo hình dạng output | Đúng: sáu dòng bộ đếm trơn, bộ đếm ghép từ hai khối, và `npm test \| cat` in một dòng dạng Go đều được xác minh | Parser theo trình chạy lấy từ lệnh (`runnerOf`); script đóng gói qua ống không bao giờ đạt (quyết định của người dùng). Node đòi một khối tổng kết liền mạch tám dòng ở cuối, `1..N`, `TAP version` và đúng N dòng kết quả; Cargo đòi số dòng `test result:` bằng số binary và doctest |
| P2: ghi file kế hoạch qua Bash bị tính là thay đổi mã | Đúng: `printf … > .claude/plans/x.md` làm mất trạng thái đã kiểm tra; lệnh ghi cả file kế hoạch và mã bị đếm hai lần | Mỗi tác động ghi mang đích của chính đoạn lệnh; tác động chỉ ghi file kế hoạch (đích đọc được hết) bị bỏ, như với Edit và Write. Ghi kèm file mã hay đích không xác định vẫn được đếm |
| P2: README lệch số test và phiên bản | Đúng: 299 và 347 test, Claude Code 2.1.295 và 2.1.296, 16 và 21 ca | Một mục "Kiểm chứng HEAD hiện tại"; số của các vòng trước ghi rõ là số lúc đó |
| PR #14 vòng 2, P1: evidence nhắc một lệnh kiểm tra chưa chạy vẫn được nhận nhờ lệnh khác đạt | Đúng: `npm test` đạt, evidence `npm test đạt, npm run lint đạt` (lint chưa chạy) là strong | Mọi chỗ evidence nhắc lệnh kiểm tra (dò bằng cùng bộ nhận diện) phải ứng với một lần chạy kiểm tra thật; một bộ khớp duy nhất cho mọi mức, không còn đường cũ |
| PR #14 vòng 2, P1: tùy chọn thu hẹp phạm vi bị bỏ khỏi danh tính | Đúng với `--test-name-pattern=smoke` và `-k=smoke`; dạng tách và `go -run` chỉ tình cờ không khớp. Kiểm thêm thấy evidence cắt `./...:` thành `./`, nên `go test ./...` không bao giờ khớp | So khớp nghiêm ngặt: mọi tùy chọn là một phần danh tính trừ cờ trình bày theo từng trình chạy; `=` và dạng tách là một; evidence không được nêu phạm vi khác lần chạy; dấu câu thành ranh giới mệnh đề, `./...` giữ nguyên |
| PR #14 vòng 3, P1: hạ chữ thường toàn bộ làm mất khác biệt của đường dẫn và giá trị bộ lọc | Đúng: `node --test SRC/A.test.ts` và `-run=Testpayment` được nhận thay cho lần chạy chữ khác | Chữ hoa thường chuẩn hóa theo ngữ pháp, dùng chung cho lệnh và evidence: chỉ tên executable đã biết và từ khóa lệnh con ở đúng vị trí; dò claim trên bản chữ thường nhưng so khớp trên bản giữ chữ |
| PR #14 vòng 3, P1: đối số vị trí thêm (`fmt`, `.`) không bị phát hiện | Đúng: `go test ./... fmt: ok` và `pytest tests/ .: đạt` được nhận | Bỏ đoán theo hình dạng token: mọi từ đến ranh giới kế tiếp phải được danh tính tiêu thụ hết; `.` là đối số như mọi đối số |
| PR #14 vòng 3, P2: `-count=1` bị coi là cờ trình bày | Đúng: `-count=1` tắt cache kết quả test, `go test ./...` và `go test -count=1 ./...` bị coi là một | Bỏ `-count` khỏi cờ trình bày |
| Góp ý cho kế hoạch vòng 3 | Đúng cả: tách `=` vô điều kiện (kể cả sau `--`), bỏ cờ npx khỏi danh tính, nháy và backtick không tạo ranh giới, lý do "chưa chạy" sai khi lệnh đã chạy | `=` chỉ tách cho cờ đã biết nhận giá trị, không tách sau `--`/`-args`; cờ npx là tiền tố danh tính; ranh giới cho nháy, backtick, nháy chữ Việt, ống; lý do trung tính "khớp chính xác" |

## Thay đổi 0.5.1 theo đánh giá

Lượt đánh giá thứ ba (đọc tĩnh bản 0.5.0) nêu sáu lỗ hổng, ba giới hạn kiến trúc và lộ trình bốn vòng. Mỗi điểm được kiểm trên code 0.5.0 và có test tái hiện chạy đỏ trước khi sửa (`tests/review051.test.ts` và mục 0.5.1 trong `tests/hooks.test.ts`).

| # | Điểm đánh giá | Kiểm trên 0.5.0 | Xử lý |
|---|---|---|---|
| 01 | Sửa file sau lần test đạt vẫn được coi là đã kiểm tra | Đúng: `observe()` không đặt lại cờ kiểm tra khi có thay đổi mới | Mỗi thay đổi đặt lại trạng thái; cuối turn báo "N thay đổi sau lần kiểm tra cuối chưa được kiểm tra lại" |
| 02 | Lệnh Bash ghi file không bị đối chiếu với phạm vi | Đúng; thêm: đường dẫn tương đối `src/a.ts` không khớp phạm vi `src` | Đọc file đích của lệnh ghi (chuyển hướng, `tee`, `sed -i`, `cp`, `mv`, `rm`, `touch`, `mkdir`, `chmod`, `git checkout --`, `git restore`, kể cả sau `cd`), đối chiếu từng file; lệnh ghi không đọc được đích thì cảnh báo riêng |
| 03 | Stop không chạy với turn chỉ giao subagent hay chỉ điều tra | Đúng | Tách turn hỏi đáp với turn thực thi: giao subagent, hoặc làm tiếp mục tiêu (router đọc là tiếp nối, không phải việc chỉ trả lời) cũng là thực thi |
| 04 | `verified` không chứng minh kết quả | Đúng | Ghi kết quả thật của từng lệnh (mã thoát) và thứ tự với thay đổi cuối; `verified` chỉ được nhận khi evidence nhắc một lệnh kiểm tra chạy thành công sau thay đổi cuối (việc chỉ đọc thì đủ khi nêu lệnh hay file đã đọc), còn lại lưu `done` kèm lý do; tiêu chí nghiệm thu theo bước (`check`); nhắc tiêu chí chất lượng khi đóng bước cuối; phân biệt kiểm tĩnh với test |
| 05 | `plan set` với `steps: []` giữ checklist cũ | Đúng | `steps: []` xóa checklist, không truyền `steps` thì giữ; `steps` không có bước hợp lệ thì báo lỗi |
| 06 | Tránh họ model bị chặn có thể vượt chính sách phiên | Đúng, rộng hơn nêu: ngoài fable, việc sửa file còn có thể nhảy lên họ cao hơn trần | Họ thay thế phải nằm trong chính sách phiên; `fixed` giữ họ cố định và ghi rõ; kiểm lại chính sách sau mọi bước kẹp |

Lộ trình vòng 2 đến 4 và các giới hạn kiến trúc:
- Trạng thái việc giao subagent: chờ giao, đang chạy, xong, lỗi. Lời gọi Agent bị từ chối thì việc trở lại chờ giao. Việc lỗi chưa giao lại được cảnh báo cuối turn, hiện trên pane và `/conductor status`, và (khi `enforceChecklist` bật) có trong lý do chặn kết thúc.
- `strictDelegation: block`: thêm `blockLimit` (1 đến 10, mặc định 2). Không có mức chặn vô hạn, có chủ ý.
- Độ trễ router: đo mỗi lượt, `/conductor status` hiện trung bình và lượt chậm nhất. `routerSkip` vẫn mặc định tắt để không đổi hành vi.
- Chi phí: sổ trong pane và status ghi rõ là số đo; phần còn là ước tính (subagent chưa kết thúc) có dòng riêng.
- Golden-set thêm 5 ca đối kháng: phạm vi kèm Bash, hai mục tiêu trong một prompt, đòi model trái chính sách, tiếp nối mơ hồ, câu hỏi ngoài lề khi checklist còn mở.

- Eval ghi kèm phiên bản Claude Code và model thật sự trả lời.

Kiểm thêm phát hiện vài điểm bản đánh giá không nêu, đã sửa cùng đợt:
- Mục tiêu được khôi phục mang số mục tiêu mới nên mất dấu vết thực thi cũ: giờ dấu vết đi theo mục tiêu khi khôi phục (phát hiện khi kiểm đột biến).
- Lệnh test đi qua `| tail` có mã thoát 0 dù test lỗi, và evidence `node --test` không khớp lệnh `node --test src/...` (phát hiện khi chạy phiên thật): đọc dấu hiệu lỗi trong output, khớp thêm hai token đầu kể cả tùy chọn.
- Đường lên khi các họ thấp hơn đều bị chặn có thể ra fable dù chưa bật `allowFable`.

### Vòng review cuối (Request Changes) và góp ý về kế hoạch sửa

Review hai commit 0.5.1 nêu năm điểm; kiểm trên code đều đúng. Góp ý cho kế hoạch sửa thêm yêu cầu về ngữ nghĩa shell, phân loại thống nhất và trường hợp thiếu thư mục gốc. Kiểm code còn thấy thêm `echo "x && npm test"` bị tính là lệnh kiểm tra, vì chuỗi trong nháy không được che trước khi tách lệnh.

| Điểm | Kiểm trên 0.5.1 | Xử lý |
|---|---|---|
| Lệnh kiểm tra che khuất ghi file (`npm test && echo x > ../outside.txt`, `npm test \| tee ../out.log`) | Đúng: cả lệnh bị coi là kiểm tra, không là thay đổi | Phân loại lệnh Bash theo từng đoạn, giữ toán tử (`&&`, `\|\|`, `;`, `\|`) và che chuỗi trong nháy: mỗi lệnh có danh sách hiệu ứng theo thứ tự, kiểm tra hay ghi |
| Thay đổi của subagent sau lần test của luồng chính | Đúng: trạng thái kiểm tra của luồng chính không bị đặt lại | Theo dõi theo tác giả: ghi của subagent cùng mục tiêu đặt lại trạng thái của luồng chính; test của subagent chỉ phủ phần nó sửa |
| Lệnh Bash lỗi vẫn có thể đã ghi | Đúng | Ghi trong lệnh Bash lỗi vẫn được tính, cả trong trạng thái turn lẫn dấu vết của `verified` |
| `isInScope` nhận `/src/` ở bất kỳ đâu | Đúng | Phạm vi neo theo thư mục gốc của phiên (`$.session.root()`, chốt cho mỗi mục tiêu); đường dẫn ngoài gốc luôn là ngoài phạm vi; không lấy được gốc thì báo không xác định được phạm vi, không khớp theo chuỗi |
| `awk` ghi file bị coi là chỉ đọc | Đúng | `print`/`printf` chuyển hướng hay nối ống, và `system(`, là có ghi, đích không xác định |
| Góp ý: dấu ngăn lệnh và nhánh điều kiện | Đúng | Kiểm tra chỉ được tin khi chắc chắn đã chạy (đoạn đầu, sau `&&` hay `;`); có ghi sau kiểm tra thì chưa kiểm tra; cấu trúc chưa hỗ trợ (`$( )`, `eval`, `bash -c`) thì không tin kiểm tra nào |
| Góp ý: `isReadOnly` của engine không phủ định ghi đã thấy | Đúng | Một kết quả phân loại cho mọi hook (strictDelegation block, theo dõi, phạm vi, dấu vết); ghi xác định không bao giờ bị phủ định; engine chỉ hạ ghi "có thể" của lệnh lạ sau khi chạy |
| Góp ý: kiểm tra thất bại bị che qua ống | Đúng | Lệnh kiểm tra nối ống chỉ tính là đạt khi output có dấu hiệu đạt rõ và không có dấu hiệu lỗi; không đủ thông tin thì chưa kiểm tra |
| Review PR #13: kiểm tra trước `;` hay `\|\|` bị tính là đạt dù thất bại (`npm test; echo done`, `npm test \|\| echo fallback`) | Đúng: chỉ xét lệnh ngay sau có phải ống hay không | Ba mức `visible`, `filtered`, `hidden` theo ngữ nghĩa shell. `;`, `\|\|`, xuống dòng và ống sang lệnh khác là `hidden`, không bao giờ đạt. Lần rà soát thứ hai: lệnh tự in báo đạt phía sau (`npm test; printf '1 passed'`) và `head` không được tin; dấu hiệu đạt phải là báo cáo tổng kết đầy đủ theo trình chạy đã nhận diện; evidence gắn với đúng đoạn lệnh kiểm tra |
| Review PR #13 lần 3: báo cáo "đạt" qua ống chưa được chứng minh (TAP chỉ cần `# tests`/`# pass`/`# fail 0` và không so số; `tail`/`cat` đọc file hay `<`; Go và Cargo qua `tail`; fixture 3 dòng tự viết), cùng góp ý về chuyển hướng trên lệnh kiểm tra, test `TODO` ném lỗi, dòng Go thật, dòng `error:` của Cargo | Đúng cả; fixture thật còn cho thấy `\bFAILED\b` không phân biệt hoa thường khớp `0 failed` của Cargo, nên output Cargo đạt thật chưa bao giờ được nhận. Kiểm thêm thấy `npm test \| cat <<EOF` (cat đọc heredoc, không đọc ống) cũng thành `filtered`, vì thân heredoc bị bỏ khi che lệnh | Nguyên tắc: parser chứng minh, không giả định. Node đủ sáu bộ đếm và khớp nhau, không `not ok`/`✖`, qua `tail` không có `todo`; bộ lọc chỉ đọc từ ống (`cat` không đối số, `tail` chỉ số dòng; heredoc để lại dấu khi che lệnh); lệnh kiểm tra nối ống không có chuyển hướng ngoài `2>&1`; Go và Cargo chỉ qua `cat`, mọi dòng gói hay `test result:` phải đạt; thêm dấu hiệu `error:`, `error[E…]`, `panic:`, `[build failed]`, `Bail out!`; `FAILED` phân biệt hoa thường. Fixture là output thật của Node v22.22.0 (`--test-reporter=tap` và `spec`), go1.24.7, Cargo 1.97.0 |
| Review PR #13 lần 4: dòng `12 passing` rồi `Error: setup failed` qua `mocha \| cat` được xác minh | Đúng, và rộng hơn Mocha: Jest kèm `Error: boom`, Pytest kèm `Traceback`, Mocha kèm stack `TypeError` cũng được xác minh, vì năm parser chung chỉ tìm một dòng đạt ở bất kỳ đâu và dấu hiệu lỗi chỉ có `error:` viết thường | Khối tổng kết đạt của Jest, Vitest, Mocha, Bun, Pytest phải nằm cuối output, sau nó chỉ có dòng phụ của chính trình chạy; số đạt lớn hơn 0; thêm dấu hiệu lỗi chung (`Error:`, `<Tên>Error:`, `Uncaught`, `Traceback`, `npm ERR!`, `ELIFECYCLE`, `Command failed`, `exited with code N`) cho mọi parser. Fixture là output thật của mocha 12.0.3, jest 30.5.2, vitest 5.0.3, bun 1.4.2, pytest 9.1.1 |
| Góp ý: nhiều lệnh ghi không xác định đích | Đúng | Mỗi lệnh khác nhau được cảnh báo một lần |
| Commit `4bdc34e` có tên model | Đúng | Dựng lại nhánh bằng cherry-pick, bỏ dòng đó, code không đổi |

Kiểm chứng lúc merge PR #13 (`f6a6804`, Claude Code 2.1.296, router sonnet, ngày 2026-10-10) [Nguồn: phiên phát triển]; số hiện hành ở [docs/VERIFICATION.md](docs/VERIFICATION.md):
- 347 test qua lúc đó (sau bốn vòng sửa review PR #13), `claude plugin validate .` qua cho mod và marketplace, type-check sạch. 13 test tái hiện trong `tests/review051.test.ts` chạy đỏ trên 0.5.0; 17 test tái hiện của vòng review cuối (`tests/review051b.test.ts` và mục "vòng cuối" trong `tests/hooks.test.ts`) chạy đỏ trên `5ac2a6b`, đều vì hành vi sai. 17 test của vòng 3 PR #13 (`tests/review051c.test.ts` và mục "vòng 3" trong `tests/hooks.test.ts`) chạy đỏ trên `aa73308`. 5 test của vòng 4 (`tests/review051d.test.ts`) chạy đỏ trên `664aa5d`.
- Kiểm đột biến 64 nhánh qua ba vòng (mỗi đột biến bỏ hoặc đảo một sửa đổi): 63 bị test bắt; một đột biến tương đương (bỏ nhánh `fixed` trong `avoidBlocked`, bộ lọc chính sách cho cùng kết quả). Ở vòng cuối, ba đột biến ban đầu còn sống (thư mục gốc chốt theo mục tiêu, phạm vi là tên file nằm ngoài gốc, cấu trúc shell chưa hỗ trợ khi engine báo chỉ đọc) đã có test bổ sung. Sửa review PR #13 có 8 đột biến (`;`, `||`, `head`, lệnh không đứng đầu, một token đạt, hidden đạt, evidence cả câu lệnh, bỏ điều kiện tin cậy) và một đột biến báo lỗi trong `completePass`: cả chín bị test bắt. Vòng 3 có 26 đột biến (từng điều kiện của báo cáo Node, Go, Cargo, bộ lọc chỉ đọc từ ống, heredoc, token trong nháy, chuyển hướng, dấu hiệu lỗi, `FAILED` phân biệt hoa thường): 23 bị test bắt, trong đó năm đột biến lúc đầu còn sống (`cancelled = 0`, `pass > 0`, mọi dòng `test result:` đúng dạng, Cargo có test đạt, `not ok` không kèm `error:`) đã có test bổ sung; ba đột biến tương đương: bỏ kiểm thiếu `cancelled` (giá trị thiếu đã làm `cancelled = 0` sai), bỏ `fail = 0` của Node (`fail` lớn hơn 0 luôn khớp dấu hiệu lỗi `# fail N`), bỏ `[build failed]` (go test luôn in dòng đó sau `FAIL`). Vòng 4 có 17 đột biến (điều kiện tổng kết cuối, dòng phụ của từng trình chạy, `0 fail` của Bun, số đạt lớn hơn 0, từng dấu hiệu lỗi chung): cả 17 bị test bắt, trong đó ba đột biến lúc đầu còn sống (lấy dòng đạt đầu tiên, bỏ số đạt lớn hơn 0, bỏ `npm ERR!`) đã có test bổ sung.
- Router thật trên toàn bộ 21 ca: 21/21 đạt, 5 đến 16 giây mỗi ca.
- Phiên thật vòng cuối (thư mục tạm, fixture riêng, đã xóa sau khi kiểm): `node --test ... && echo v2 > config/app.txt` với phạm vi `src/` có toast ngoài phạm vi và cuối turn báo "1 thay đổi sau lần kiểm tra cuối chưa được kiểm tra lại"; chỉ subagent sửa rồi tự chạy test thì không báo; chỉ subagent sửa mà không test thì báo "Turn có 1 thay đổi nhưng không chạy bước kiểm tra nào".
- Phiên `claude -p` thật có nạp mod (`--plugin-dir`): test đạt rồi sửa tiếp thì cuối turn báo "1 thay đổi sau lần kiểm tra cuối chưa được kiểm tra lại"; `echo v2 > config/app.txt` với phạm vi `src/` thì có toast ngoài phạm vi; `verified` ghi sau thay đổi cuối thì lưu `done` kèm lý do "chạy trước thay đổi cuối cùng"; turn giao subagent rồi định dừng khi checklist còn mở thì bị chặn.

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
