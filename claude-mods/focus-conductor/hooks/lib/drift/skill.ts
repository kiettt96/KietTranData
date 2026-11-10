// File skill (0.8.2 N3): sửa skill phải thử skill trên ví dụ trước khi báo xong. File skill là file tên đúng SKILL.md, file .md nằm dưới
// một đoạn thư mục tên skills/, hoặc file khớp tiền tố khai ở option skillPaths. Ghi vào file skill không là tài liệu nhẹ (isSoftDocs) và
// không tính vào cảnh báo chưa kiểm hay cổng Y6; bằng chứng là một lần thử skill sau lần ghi cuối.

import { normalizePath } from './scope'

/** Tiền tố mở đầu description của lời gọi Agent thử skill (0.8.2 N3). */
export const SKILL_TRIAL_PREFIXES = ['Thử skill: ', 'Skill trial: '] as const

/** Tiền tố skillPaths đã chuẩn hóa cho lần nạp mod này: tuyệt đối, hay tương đối (khớp từ đầu một thư mục bất kỳ). */
let skillPrefixes: string[] = []

/** Mục cho cả cây thư mục ("", ".", "./", "..", "/"): không phải tiền tố của skill, bị bỏ (như pauseAllowPaths). */
function isWholeTree(item: string): boolean {
  return ['', '.', '..'].includes(item.replace(/\/+$/, ''))
}

/**
 * Đọc option skillPaths (0.8.2 N3): tiền tố phân tách bằng dấu phẩy, chuẩn hóa như pauseAllowPaths (bỏ khoảng trắng, mục rỗng và mục cho
 * cả cây thư mục), rồi chuẩn hóa đường dẫn (bỏ "./" đầu, "/" cuối, gộp "..").
 */
export function parseSkillPaths(raw: unknown): string[] {
  if (typeof raw !== 'string') return []
  return raw
    .split(',')
    .map(item => item.trim())
    .filter(item => item !== '' && !isWholeTree(item))
    .map(item => normalizePath(item))
    .filter(item => item !== '' && item !== '/')
}

/** Áp danh sách tiền tố cho lần nạp mod này; danh sách rỗng là bỏ hết. */
export function applySkillPaths(prefixes: readonly string[]): void {
  skillPrefixes = [...prefixes]
}

/** Đường dẫn khớp một tiền tố theo đoạn thư mục: tiền tố tuyệt đối khớp từ gốc, tiền tố tương đối khớp từ đầu một thư mục bất kỳ. */
function matchesPrefix(path: string, prefix: string): boolean {
  if (prefix.startsWith('/')) return path === prefix || path.startsWith(`${prefix}/`)
  const rel = path.startsWith('/') ? path.slice(1) : path
  return rel === prefix || rel.startsWith(`${prefix}/`) || rel.endsWith(`/${prefix}`) || rel.includes(`/${prefix}/`)
}

/** File này là file skill (0.8.2 N3): tên SKILL.md, file .md dưới một thư mục skills/, hoặc khớp tiền tố skillPaths. */
export function isSkillPath(path: string): boolean {
  if (path === '') return false
  const norm = normalizePath(path)
  const parts = norm.split('/').filter(Boolean)
  const name = parts.at(-1) ?? ''
  if (name === 'SKILL.md') return true
  if (/\.md$/i.test(name) && parts.slice(0, -1).includes('skills')) return true
  return skillPrefixes.some(prefix => matchesPrefix(norm, prefix))
}

/** Tên skill để nêu trong lý do chặn: thư mục chứa SKILL.md, không thì tên file bỏ đuôi. */
export function skillNameOf(path: string): string {
  const parts = normalizePath(path).split('/').filter(Boolean)
  const name = parts.at(-1) ?? ''
  if (name === 'SKILL.md' && parts.length >= 2) return parts.at(-2) ?? name
  return name.replace(/\.[^.]+$/, '') || name
}

/** Lời gọi Agent là một lần thử skill (0.8.2 N3): description mở đầu "Thử skill: " hay "Skill trial: ". */
export function isSkillTrial(description: string | undefined): boolean {
  const text = description ?? ''
  return SKILL_TRIAL_PREFIXES.some(prefix => text.startsWith(prefix))
}
