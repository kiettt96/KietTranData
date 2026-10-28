// focus-conductor: điểm vào của mod. Theo quy tắc của engine, $ chỉ được dùng tại chỗ trong thân hook,
// nên mỗi nhóm hook nằm trong hooks/parts/ và gọi $ ngay trong thân hook của nó; hooks/context.ts giữ
// hằng số, tùy chọn đã đọc, trạng thái tạm và các hàm thuần dùng chung; mỗi file trong parts/ tự khai báo atom state nó dùng (quy tắc của engine);
// lib/ và ui/ chỉ tính toán và dựng cây giao diện.
//
// Luồng một turn:
//   prompt.submit  router (một model Claude cố định) đọc prompt và quyết định điều phối:
//                  mục tiêu, việc, model + effort luồng chính, việc nào giao subagent với
//                  model + effort nào. Mod kiểm, kẹp theo chính sách, gắn bản đọc vào context.
//                  Router lỗi thì không đoán: turn chạy theo model của phiên.        (parts/session.ts)
//   turn.step      step đầu tiên của turn chốt model + effort router đã chọn cho luồng
//                  chính (giữ model cũ khi hạ cấp không bù được chi phí ghi lại cache).
//                  Subagent: ép model + effort đã điều phối ở mỗi request.            (parts/turn.ts)
//   tool.call      Bảo vệ hạn mức: hạn mức phiên hay tuần sắp hết thì từ chối tool (trừ plan).   (parts/quota.ts)
//                  Agent: việc đã phân dùng đúng lựa chọn của router; việc khác do router
//                  chấm khi giao.                                                      (parts/agents.ts)
//                  plan: checklist của Claude. Mọi tool: theo dõi lặp lỗi, vượt ngân sách,
//                  ngoài phạm vi, nhắc checkpoint.                                     (parts/consistency.ts)
//                  TodoWrite, TaskCreate, TaskUpdate: phản chiếu danh sách việc để vẽ tiến độ. (parts/progress.ts)
//   classic.Stop   checklist còn mở thì yêu cầu hoàn thành hoặc giải thích.
//   turn.complete  cộng chi phí đo được vào sổ, hiệu chỉnh ước lượng, tổng kết cảnh báo cuối turn.
//   session.compact  nén hội thoại: nối khối giữ mục tiêu vào instructions, nhắc lại sau nén.   (parts/compact.ts)
// Giao diện: band trên prompt, pane chi tiết, status line (parts/ui.tsx), lệnh /conductor (parts/command.ts).

import type { Register } from 'claude-code'

import { createContext } from './context'
import { registerAgents } from './parts/agents'
import { registerCommand } from './parts/command'
import { registerCompact } from './parts/compact'
import { registerConsistency } from './parts/consistency'
import { registerProgress } from './parts/progress'
import { registerQuota } from './parts/quota'
import { registerSession } from './parts/session'
import { registerTurn } from './parts/turn'
import { registerTurnFault } from './parts/turn-fault'
import { registerUi } from './parts/ui'

export const register: Register = (on, options) => {
  const ctx = createContext(options)
  // Đăng ký trước là lớp ngoài cùng. Bảo vệ hạn mức đứng đầu: tool bị từ chối trước khi hook Agent hỏi router.
  // Thứ tự còn lại giữ như trước khi tách: hook tool.call của Agent và của plan chạy trước hook theo dõi mọi tool.
  registerQuota(on, ctx)
  registerSession(on, ctx)
  registerTurn(on, ctx)
  registerAgents(on, ctx)
  registerProgress(on, ctx)
  registerConsistency(on, ctx)
  registerTurnFault(on, ctx)
  registerCompact(on, ctx)
  registerCommand(on, ctx)
  registerUi(on, ctx)
}
