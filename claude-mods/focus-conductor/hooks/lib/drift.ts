// Theo dõi tính nhất quán trong một turn của luồng chính: lặp lại lệnh lỗi,
// vượt ngân sách bước so với độ phức tạp, sửa file ngoài phạm vi được phép,
// và chuỗi thay đổi dài mà chưa tự kiểm tra. Hàm ở đây thuần, không gọi $,
// để test được và để register quyết định cách hiển thị.
//
// File này chỉ re-export API công khai; mã nằm ở hooks/lib/drift/ theo tầng: tool, verify, readonly, scope, classify, effects,
// output, tracker, evidence, identity, claims. Tập khóa export không đổi so với bản một tệp.

export { filePathOf, isPlanFile } from './drift/tool'
export type { ToolObservation } from './drift/tool'
export { parseCheckCommands, applyCheckCommands } from './drift/verify'
export type { CheckKind } from './drift/verify'
export { isReadOnlyCommand } from './drift/readonly'
export { normalizePath, scopeStatus, isInScope } from './drift/scope'
export type { ScopeStatus } from './drift/scope'
export { classifyBash, bashWriteTargets } from './drift/classify'
export type { WriteTargets, CheckEffect, WriteEffect, BashEffect, BashClass } from './drift/classify'
export { isVerification, checkKindOf, isMutation } from './drift/effects'
export { outputFailed, runnerOf, completePass } from './drift/output'
export type { Runner } from './drift/output'
export { CHECKPOINT_EVERY, LOOP_AFTER, newTracker, trackVerification, isExecuting, turnRole, openSteps, isGoalDone, observe, summarize } from './drift/tracker'
export type { TurnTracker, Focus, Finding, PromptIntent, TurnRole } from './drift/tracker'
export { newEvidenceLog, noteEvidence } from './drift/evidence'
export type { EvidenceEntry, EvidenceLog } from './drift/evidence'
export { commandIdentity } from './drift/identity'
export { evidenceStrength, evidenceMatches, acceptsVerified } from './drift/claims'
export type { EvidenceLevel, EvidenceStrength } from './drift/claims'
