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
//   tool.call      Agent: việc đã phân dùng đúng lựa chọn của router; việc khác do router
//                  chấm khi giao.                                                      (parts/agents.ts)
//                  plan: checklist của Claude. Mọi tool: theo dõi lặp lỗi, vượt ngân sách,
//                  ngoài phạm vi, nhắc checkpoint.                                     (parts/consistency.ts)
//   classic.Stop   checklist còn mở thì yêu cầu hoàn thành hoặc giải thích.
//   turn.complete  cộng chi phí đo được vào sổ, hiệu chỉnh ước lượng, tổng kết cảnh báo cuối turn.
// Giao diện: band trên prompt, pane chi tiết, status line (parts/ui.tsx), lệnh /conductor (parts/command.ts).

import type { Register } from 'claude-code'

import { createContext } from './context'
import { registerAgents } from './parts/agents'
import { registerCommand } from './parts/command'
import { registerConsistency } from './parts/consistency'
import { registerSession } from './parts/session'
import { registerTurn } from './parts/turn'
import { registerUi } from './parts/ui'

export const register: Register = (on, options) => {
  const ctx = createContext(options)
  // Thứ tự đăng ký giữ như trước khi tách: hook tool.call của Agent và của plan chạy trước hook theo dõi mọi tool.
  registerSession(on, ctx)
  registerTurn(on, ctx)
  registerAgents(on, ctx)
  registerConsistency(on, ctx)
  registerCommand(on, ctx)
  registerUi(on, ctx)
}
