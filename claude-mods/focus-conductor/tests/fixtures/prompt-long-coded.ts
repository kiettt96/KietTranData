// Prompt rất dài tiếng Việt tự viết (khoảng 30.000 ký tự, 11 bước có mã BƯỚC 0 tới BƯỚC 10, hơn 40 yêu cầu, có câu quy định
// model theo loại việc và quy tắc tự dừng theo hạn mức), dùng để đo router với prompt rất dài (0.7.4). Dự án, tên người, tên
// thư mục và số liệu trong đó đều là hư cấu.

const INTRO = `Bối cảnh chung. Dự án so-gia-nong-san là một bộ công cụ nội bộ giúp nhóm biên tập theo dõi giá nông sản ở các chợ đầu mối và tổng hợp tin thị trường hằng tuần. Bộ công cụ gồm một kho dữ liệu dạng tệp JSON trong thư mục /srv/so-gia/data, các script Python 3.12 trong /srv/so-gia/scripts, và một thư mục báo cáo /srv/so-gia/bao-cao nơi mỗi tuần sinh ra một bản tổng hợp dạng Markdown. Phiên làm việc này kéo dài nhiều giờ, có nhiều lô việc, nên em viết rất kỹ để anh đọc một lần là đủ, không phải hỏi lại giữa chừng. Em biết prompt dài, nhưng mọi đoạn đều có lý do, kể cả những đoạn chỉ là bối cảnh.

Về lịch sử: phiên bản đầu của bộ công cụ do một bạn cộng tác viên viết năm ngoái, chủ yếu bằng tay, nên cấu trúc thư mục có chỗ chưa nhất quán. Bảng giá cũ nằm trong /srv/so-gia/data/gia-cu, mỗi tệp một chợ, mỗi dòng một mặt hàng với giá thấp nhất, giá cao nhất và đơn vị tính. Từ tháng trước nhóm đã chuyển sang lưu theo tuần trong /srv/so-gia/data/tuan, mỗi tệp tên dạng 2026-W43.json, nhưng chưa chuyển hết dữ liệu cũ. Tin thị trường được thu từ ba nguồn tổng hợp tin công khai, lưu thô trong /srv/so-gia/data/tin-tho, mỗi tin một tệp, có tiêu đề, ngày, nguồn và nội dung. Phần lớn tin không liên quan tới giá nông sản nên cần lọc. Đây là bối cảnh, không phải việc cần làm.

Về con người: chị Mai Hoa phụ trách biên tập, anh Đức Toàn phụ trách dữ liệu, còn em là người viết prompt này và sẽ đọc kết quả cuối. Chị Hoa đọc báo cáo trên điện thoại nên báo cáo cần ngắn và rõ. Anh Toàn cần các tệp dữ liệu đúng định dạng để chạy tiếp các script khác của anh ấy, nên đừng đổi tên trường. Phần này cũng chỉ là bối cảnh để anh hiểu ai đọc gì.`

const RULES = `QUY TẮC CHUNG cho toàn bộ phiên, áp dụng cho mọi bước bên dưới.

Quy định model theo loại việc: việc lọc tin thị trường (đọc tin thô, quyết định giữ hay bỏ) phải chạy bằng sonnet, giao subagent theo lô; việc đọc hiểu, giải thích và tóm tắt (đọc tài liệu, giải thích cấu trúc, viết tóm tắt) dùng đúng model của phiên, không hạ xuống model rẻ hơn. Nếu giao subagent cho việc đọc hiểu hay tóm tắt thì ghi rõ model của phiên ở lời gọi giao việc. Việc ghi dữ liệu bằng script thì làm ở luồng chính.

Quy tắc hạn mức: khi hạn mức tuần đã dùng tới 80 phần trăm thì làm xong phần đang làm dở, ghi điểm dừng vào tệp /srv/so-gia/diem-dung.md theo mẫu ở cuối prompt, rồi dừng hẳn, không bắt đầu bước mới. Không cố làm thêm cho xong.

Quy tắc kiểm: không tạo bộ test mới, không thêm thư mục tests, không cài thư viện test. Kiểm bằng cách đọc lại tệp vừa ghi và chạy đúng các lệnh kiểm có sẵn: python3 /srv/so-gia/scripts/kiem-dinh-dang.py và python3 /srv/so-gia/scripts/kiem-trung-lap.py. Hai script này in dòng KẾT QUẢ ở cuối; dòng đó phải là ĐẠT.

Quy tắc ghi dữ liệu: mọi script ghi dữ liệu dùng đường dẫn tuyệt đối, không dùng đường dẫn tương đối. Không xóa tệp nào trong /srv/so-gia/data/gia-cu; tệp cũ chỉ được đọc. Không ghi ra ngoài /srv/so-gia. Mọi tệp JSON ghi bằng UTF-8, thụt lề hai khoảng trắng, khóa giữ đúng tên hiện có. Số tiền ghi bằng số nguyên đồng, không có dấu phân cách.

Quy tắc báo cáo trong phiên: sau mỗi bước chỉ báo một dòng dạng "Xong BƯỚC N: ..." kèm số tệp đã ghi; không chép lại nội dung tệp, không tường thuật giữa các lệnh. Gặp chỗ mơ hồ thì ghi giả định vào tệp /srv/so-gia/gia-dinh.md rồi làm tiếp, không dừng để hỏi, trừ khi việc đó có thể làm mất dữ liệu.

Quy tắc thứ tự: các bước làm đúng thứ tự từ BƯỚC 0 tới BƯỚC 10 vì bước sau dùng kết quả của bước trước. Không gộp hai bước làm một, không bỏ bước nào, kể cả khi bước đó có vẻ đơn giản.`

const STEPS = [
  `BƯỚC 0. Chuẩn bị và đọc hiện trạng.
Đọc toàn bộ /srv/so-gia/scripts và /srv/so-gia/data để nắm cấu trúc hiện có, rồi viết tệp /srv/so-gia/hien-trang.md mô tả ngắn từng script làm gì, đọc tệp nào và ghi tệp nào. Tệp hiện trạng không quá 60 dòng. Ghi kèm danh sách các trường của tệp tuần (ví dụ cho, mat_hang, gia_thap, gia_cao, don_vi, ngay) và kiểu dữ liệu của từng trường. Bối cảnh thêm: script cũ nhất là nhap-gia.py, viết trước khi có thư mục tuần, nên có đoạn mã xử lý hai định dạng; đây chỉ là thông tin để anh đỡ bất ngờ khi đọc. Bước này chỉ đọc và ghi đúng một tệp mô tả, không sửa script nào. Nếu thấy script nào hỏng thì ghi vào phần cuối tệp hiện trạng, chưa sửa vội.`,
  `BƯỚC 1. Chuẩn hóa đơn vị tính.
Trong dữ liệu tuần có mặt hàng ghi đơn vị kg, có mặt hàng ghi tạ, có chỗ ghi yến, có chỗ ghi "chục quả". Viết script /srv/so-gia/scripts/chuan-don-vi.py quy đổi giá về một đơn vị chuẩn cho từng nhóm: rau củ quả tính theo kg, trứng tính theo quả, gia cầm sống tính theo kg. Tỷ lệ quy đổi lấy từ tệp /srv/so-gia/data/don-vi.json; không tự đặt tỷ lệ trong mã. Mặt hàng có đơn vị không có trong tệp tỷ lệ thì giữ nguyên và ghi tên mặt hàng vào /srv/so-gia/gia-dinh.md. Script ghi đè tệp tuần tại chỗ nhưng phải sao lưu bản trước vào /srv/so-gia/data/sao-luu với hậu tố ngày giờ. Chạy script cho mọi tệp tuần hiện có, rồi chạy hai script kiểm. Bối cảnh: năm ngoái có lần quy đổi nhầm tạ thành 10 kg, nên chị Hoa rất để ý chỗ này.`,
  `BƯỚC 2. Chuyển dữ liệu cũ sang dạng tuần.
Dữ liệu trong /srv/so-gia/data/gia-cu là theo chợ, chưa theo tuần. Viết script /srv/so-gia/scripts/chuyen-tuan.py đọc mọi tệp cũ, gom theo tuần ISO của trường ngay, và ghi vào tệp tuần tương ứng trong /srv/so-gia/data/tuan. Nếu tệp tuần đã có thì gộp, không ghi đè, và khi cùng chợ, cùng mặt hàng, cùng ngày đã có giá thì giữ giá trong tệp tuần và ghi dòng trùng vào /srv/so-gia/data/xung-dot.json. Dữ liệu cũ không có trường don_vi thì lấy theo bảng mặc định trong don-vi.json. Script phải in số dòng đã chuyển, số dòng gộp và số dòng xung đột. Không xóa tệp cũ sau khi chuyển. Sau khi chạy xong, chạy lại chuan-don-vi.py cho các tệp tuần vừa được thêm dữ liệu, rồi chạy hai script kiểm.`,
  `BƯỚC 3. Lọc tin thị trường, lô 1.
Thư mục /srv/so-gia/data/tin-tho có khoảng 1.200 tin. Chia thành các lô 100 tin theo thứ tự tên tệp; bước này làm lô 1 tới lô 4. Mỗi lô giao một subagent chạy sonnet (theo quy định model ở trên), các lô chạy song song được. Mỗi subagent đọc từng tin và quyết định giữ nếu tin nói về giá, nguồn cung, thời tiết ảnh hưởng mùa vụ, hoặc chính sách xuất nhập khẩu nông sản; bỏ nếu là quảng cáo, tin tổng hợp không có số liệu, hoặc tin trùng. Kết quả mỗi lô ghi vào /srv/so-gia/data/tin-loc/lo-N.json, mỗi tin giữ lại có các trường tep, tieu_de, ngay, nguon, ly_do_giu. Tin bỏ không ghi nội dung, chỉ đếm. Subagent không được sửa tệp tin thô. Sau khi bốn lô xong, luồng chính chạy kiem-trung-lap.py trên thư mục tin-loc.`,
  `BƯỚC 4. Lọc tin thị trường, lô 2.
Làm tiếp lô 5 tới lô 8 theo đúng cách của BƯỚC 3, cùng tiêu chí giữ và bỏ, cùng định dạng tệp kết quả, cùng quy định model sonnet cho subagent lọc tin. Nếu một subagent lỗi giữa chừng thì giao lại đúng lô đó, không chạy lại các lô đã xong. Bối cảnh: các tin từ lô 6 trở đi phần lớn đến từ nguồn thứ ba, nguồn này hay đăng lại tin của hai nguồn kia, nên tỷ lệ trùng có thể cao hơn; đây là thông tin, không phải yêu cầu thêm. Sau khi xong, chạy kiem-trung-lap.py trên thư mục tin-loc và ghi số tin giữ lại của từng lô vào cuối /srv/so-gia/hien-trang.md.`,
  `BƯỚC 5. Lọc tin thị trường, lô 3.
Làm nốt lô 9 tới lô 12 theo đúng cách của BƯỚC 3 và BƯỚC 4. Lô cuối có thể ít hơn 100 tin. Sau lô cuối, viết script /srv/so-gia/scripts/gop-tin.py gộp mọi tệp lô thành /srv/so-gia/data/tin-loc/tat-ca.json, bỏ tin trùng theo cặp tiêu đề và ngày, sắp theo ngày giảm dần. Tệp gộp không quá 400 tin; nếu nhiều hơn thì giữ 400 tin mới nhất và ghi số tin bị cắt vào gia-dinh.md. Chạy hai script kiểm trên tệp gộp. Không xóa các tệp lô sau khi gộp, vì anh Toàn còn dùng chúng.`,
  `BƯỚC 6. Đọc và giải thích biến động giá.
Đọc dữ liệu giá bốn tuần gần nhất trong /srv/so-gia/data/tuan và tìm mười mặt hàng có biến động giá trung bình lớn nhất giữa tuần đầu và tuần cuối, tính theo phần trăm trên giá trung bình của giá thấp và giá cao. Việc đọc và giải thích này dùng model của phiên (theo quy định model ở trên); nếu giao subagent thì ghi rõ model của phiên. Với mỗi mặt hàng, viết hai đến ba câu giải thích nguyên nhân có thể, dựa trên tin trong tat-ca.json; mỗi câu giải thích phải dẫn tên tệp tin làm căn cứ. Mặt hàng không có tin nào giải thích được thì ghi "chưa rõ nguyên nhân", không đoán. Kết quả ghi vào /srv/so-gia/bao-cao/bien-dong.md.`,
  `BƯỚC 7. Tóm tắt tin theo nhóm hàng.
Từ tat-ca.json, viết tóm tắt theo bốn nhóm hàng: rau củ, trái cây, gia cầm và trứng, lúa gạo. Mỗi nhóm không quá 120 từ, nêu ba ý chính có số liệu, và mỗi ý dẫn tên tệp tin. Việc tóm tắt dùng model của phiên. Không chép nguyên văn quá một câu từ bất kỳ tin nào. Tóm tắt ghi vào /srv/so-gia/bao-cao/tom-tat-nhom.md. Nhóm nào trong tuần không có tin thì ghi một dòng "Tuần này không có tin đáng chú ý". Bối cảnh: tuần trước chị Hoa phàn nàn tóm tắt nhóm lúa gạo quá dài, nên giới hạn 120 từ là giới hạn cứng.`,
  `BƯỚC 8. Bảng giá tuần cho biên tập.
Viết script /srv/so-gia/scripts/bang-gia.py sinh bảng giá tuần mới nhất dạng Markdown: mỗi chợ một bảng, cột mặt hàng, giá thấp, giá cao, đơn vị, thay đổi so với tuần trước (phần trăm, làm tròn một chữ số thập phân). Bảng sắp theo tên mặt hàng. Mặt hàng mới xuất hiện tuần này ghi "mới" ở cột thay đổi. Script ghi vào /srv/so-gia/bao-cao/bang-gia-TUAN.md, với TUAN là mã tuần ISO. Số tiền hiển thị có dấu chấm phân cách hàng nghìn trong bảng Markdown, nhưng dữ liệu JSON vẫn là số nguyên không phân cách như quy tắc chung. Chạy script, đọc lại bảng vừa sinh để chắc không có ô trống, rồi chạy kiem-dinh-dang.py.`,
  `BƯỚC 9. Bản tổng hợp tuần.
Ghép bien-dong.md, tom-tat-nhom.md và bảng giá tuần thành /srv/so-gia/bao-cao/tong-hop-TUAN.md. Thứ tự: một đoạn mở đầu không quá 80 từ nêu ba điểm chính của tuần, rồi biến động giá, rồi tóm tắt nhóm, rồi bảng giá. Bản tổng hợp không quá 1.500 từ tính cả bảng. Không thêm biểu đồ, không thêm hình. Đoạn mở đầu viết cho chị Hoa đọc trên điện thoại: câu ngắn, không thuật ngữ kỹ thuật. Đọc lại toàn bộ bản tổng hợp một lần để sửa lỗi chính tả, rồi chạy kiem-dinh-dang.py trên thư mục bao-cao.`,
  `BƯỚC 10. Kết thúc phiên.
Cập nhật /srv/so-gia/hien-trang.md với phần "Sau phiên" liệt kê các script mới, các tệp đã sinh và số liệu chính (số dòng chuyển, số tin giữ lại, số mặt hàng có biến động lớn). Ghi /srv/so-gia/diem-dung.md theo mẫu ở cuối prompt với trạng thái "hoàn tất". Báo cáo cuối trong phiên không quá mười dòng: kết quả từng bước một dòng, lệnh kiểm đã chạy, và chỗ còn hở nếu có. Không mở phiên mới, không đề xuất việc ngoài các bước đã nêu.`,
]

const BACKGROUND = `Ghi chú bối cảnh thêm, không phải yêu cầu. Nhóm đã thử dùng một bảng tính chung trước khi viết script, nhưng bảng tính hay bị sửa nhầm và khó biết ai sửa gì, nên mới chuyển sang tệp JSON và script. Những tuần cao điểm như trước Tết, số tin thô có thể gấp ba bình thường; tuần này là tuần thường. Chợ đầu mối phía nam cập nhật giá hai lần mỗi ngày, các chợ khác một lần, nên trong tệp tuần có chợ có hai giá cùng ngày; chuyện này đã được xử lý ở script nhập giá cũ và không cần làm gì thêm. Một số tin thô có tiêu đề tiếng Anh vì lấy từ bản tin quốc tế; tiêu chí giữ và bỏ vẫn như nhau. Anh Toàn có một script vẽ biểu đồ riêng chạy sau khi phiên này xong, script đó đọc tệp tuần và tệp tổng hợp, nên định dạng phải giữ đúng như quy tắc chung. Các mốc thời gian trong tệp đều theo giờ Việt Nam.`

const TEMPLATE = `MẪU ĐIỂM DỪNG (dùng cho quy tắc hạn mức và cho BƯỚC 10):
# Điểm dừng
- Thời điểm: ngày giờ theo giờ Việt Nam
- Bước đang làm: mã bước và tên bước
- Đã xong: danh sách mã bước đã xong
- Còn lại: danh sách mã bước chưa làm
- Tệp đã ghi trong phiên: danh sách đường dẫn tuyệt đối
- Việc cần kiểm khi quay lại: một đến ba dòng
- Trạng thái: "tạm dừng do hạn mức" hoặc "hoàn tất"`

const CLOSING = `Tiêu chí xong: mọi bước từ BƯỚC 0 tới BƯỚC 10 có dòng "Xong" trong phiên; hai script kiểm in KẾT QUẢ: ĐẠT ở lần chạy cuối; bản tổng hợp tuần tồn tại và không quá 1.500 từ; tệp điểm dừng có trạng thái "hoàn tất". Nếu phải dừng vì hạn mức thì tiêu chí xong của phiên này là tệp điểm dừng đầy đủ và đúng mẫu.

Nhắc lại vì đây là chỗ hay sai: lọc tin chạy sonnet; đọc, giải thích và tóm tắt dùng model của phiên; không tạo bộ test mới; dừng ở 80 phần trăm hạn mức tuần; đường dẫn tuyệt đối; không xóa dữ liệu cũ.`

/** Thêm bối cảnh (không phải yêu cầu) sau mỗi bước để prompt đạt độ dài của một phiên nhiều giờ. */
const STEP_NOTES = [
  'Ghi chú cho bước này: thư mục scripts có vài tệp nháp tên bắt đầu bằng "thu-" do cộng tác viên để lại; chúng không được gọi ở đâu cả và anh cứ để nguyên.',
  'Ghi chú cho bước này: tệp don-vi.json do anh Toàn soạn tay, có chú thích tiếng Việt trong trường ghi_chu; trường đó không ảnh hưởng tới quy đổi.',
  'Ghi chú cho bước này: một vài tệp cũ có dòng tiêu đề lặp lại ở giữa tệp do từng được nối tay; script cũ bỏ qua dòng đó và cách làm ấy vẫn ổn.',
  'Ghi chú cho bước này: tin thô có tệp rất ngắn, chỉ có tiêu đề; tiêu chí giữ và bỏ vẫn áp như các tin khác.',
  'Ghi chú cho bước này: thời gian chạy mỗi lô thường vài phút; không cần báo tiến độ từng tin.',
  'Ghi chú cho bước này: tệp gộp năm ngoái từng có 380 tin trong tuần cao điểm, nên giới hạn 400 hiếm khi bị chạm.',
  'Ghi chú cho bước này: giá trung bình là trung bình cộng của giá thấp và giá cao trong cùng ngày, như cách nhóm vẫn tính.',
  'Ghi chú cho bước này: bốn nhóm hàng là cách chia của tòa soạn, không cần thêm nhóm.',
  'Ghi chú cho bước này: tuần trước có chợ đóng cửa hai ngày nên tệp tuần đó ít dòng hơn; không phải lỗi dữ liệu.',
  'Ghi chú cho bước này: chị Hoa thường đọc bản tổng hợp vào sáng thứ Hai.',
  'Ghi chú cho bước này: tệp hiện trạng được anh Toàn đọc lại vào đầu phiên sau.',
]

/** Đoạn bối cảnh dài thêm (không phải yêu cầu): mô tả dữ liệu mẫu để prompt đạt khoảng 30.000 ký tự như phiên thật. */
const SAMPLE = Array.from({ length: 36 }, (_, i) => {
  const cho = ['chợ đầu mối phía bắc', 'chợ đầu mối phía nam', 'chợ đầu mối miền trung', 'chợ nông sản ven đô'][i % 4]
  const hang = ['cải bắp', 'cà chua', 'dưa hấu', 'thanh long', 'gà ta', 'trứng gà', 'gạo tẻ', 'khoai lang'][i % 8]
  return `Ví dụ dữ liệu ${i + 1} (chỉ để minh họa định dạng, không phải yêu cầu): ở ${cho}, mặt hàng ${hang} trong tệp tuần có một dòng với các trường cho, mat_hang, gia_thap, gia_cao, don_vi và ngay; giá thấp và giá cao là số nguyên đồng, đơn vị theo bảng quy đổi, ngày theo định dạng năm-tháng-ngày. Dòng tương ứng trong tệp cũ thiếu trường don_vi và ghi ngày theo định dạng ngày/tháng/năm, nên script chuyển tuần phải đọc được cả hai định dạng ngày.`
}).join('\n')

export const LONG_CODED_PROMPT = [
  INTRO,
  RULES,
  ...STEPS.map((step, i) => `${step}\n${STEP_NOTES[i] ?? ''}`),
  BACKGROUND,
  SAMPLE,
  TEMPLATE,
  CLOSING,
].join('\n\n')
