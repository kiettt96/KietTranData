// Đường dẫn và phạm vi: chuẩn hóa đường dẫn và đối chiếu một file với phạm vi router đọc được.
// Chuyển nguyên văn từ hooks/lib/drift.ts (tách theo tầng, không đổi hành vi); hooks/lib/drift.ts là barrel.

/** Chuẩn hóa đường dẫn: dấu \\ thành /, bỏ ./, gộp .. (không đụng hệ thống tệp). */
export function normalizePath(path: string): string {
  const unified = path.replace(/\\/g, '/')
  const isAbsolute = unified.startsWith('/')
  const out: string[] = []
  for (const part of unified.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..' && out.length > 0 && out[out.length - 1] !== '..') out.pop()
    else if (part === '..' && isAbsolute) continue
    else out.push(part)
  }
  return `${isAbsolute ? '/' : ''}${out.join('/')}`
}

export type ScopeStatus = 'in' | 'out' | 'unknown'

/**
 * Vị trí của một đường dẫn so với phạm vi, neo theo thư mục gốc của phiên. Đường dẫn và phạm vi tương đối được nối
 * vào gốc (đường dẫn tương đối của lệnh Bash nối vào `cwd` nếu có); trong phạm vi chỉ khi bằng hoặc nằm dưới
 * `gốc/phạm vi`; phạm vi chỉ là tên file (có phần mở rộng, không có /) thì khớp theo tên file bên trong gốc, và vẫn khớp như thư mục
 * `gốc/phạm vi` (thư mục có số phiên bản như tool-v1.0.0, 0.7.7); ngoài
 * gốc (worktree hay checkout khác) là ngoài phạm vi, trừ khi nằm dưới một mục phạm vi tuyệt đối. Mọi so khớp theo ranh giới
 * thư mục sau chuẩn hóa. Không có gốc thì không khẳng định gì (unknown), không quay về khớp theo chuỗi.
 */
export function scopeStatus(path: string, scopePaths: readonly string[], root?: string | null, cwd?: string | null): ScopeStatus {
  if (scopePaths.length === 0 || path === '') return 'in'
  // Đường dẫn dưới thư mục nhà chưa giải (0.9.0 A2, dạng `~/...`): không neo được theo gốc phiên.
  if (!root || path.startsWith('~')) return 'unknown'
  const base = normalizePath(root)
  const resolve = (p: string, from: string) => normalizePath(p.replace(/\\/g, '/').startsWith('/') ? p : `${from}/${p}`)
  const file = resolve(path, cwd ? resolve(cwd, base) : base)
  const isUnder = (dir: string) => file === dir || file.startsWith(`${dir}/`)
  const entry = (scope: string) => scope.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  // Ngoài gốc phiên (worktree hay checkout khác): chỉ mục phạm vi tuyệt đối mới đưa được vào phạm vi; mục tương đối neo theo gốc.
  if (!isUnder(base)) return scopePaths.some(scope => entry(scope).startsWith('/') && isUnder(normalizePath(entry(scope)))) ? 'in' : 'out'
  const name = file.split('/').pop() ?? ''
  return scopePaths.some(scope => {
    const s = entry(scope)
    if (s === '' || s === '.') return true
    // Mục không có "/" và trông như tên file: khớp theo tên file bên trong gốc, hoặc như một thư mục dưới gốc (0.7.7: thư mục có số
    // phiên bản như tool-v1.0.0 cũng có dạng ".chữ-số" ở cuối).
    if (!s.includes('/') && /\.[A-Za-z0-9]+$/.test(s) && name === s) return true
    return isUnder(resolve(s, base))
  })
    ? 'in'
    : 'out'
}

/** Đường dẫn chắc chắn nằm trong phạm vi (cần thư mục gốc; không có gốc thì không khẳng định). */
export function isInScope(path: string, scopePaths: readonly string[], root?: string | null, cwd?: string | null): boolean {
  return scopeStatus(path, scopePaths, root, cwd) === 'in'
}

/** Thư mục nhà của phiên (0.9.0 A2), từ biến HOME khi engine cho biết; null là chưa biết. */
let homeDir: string | null = null

/** Áp thư mục nhà cho lần nạp mod này (0.9.0 A2); null hay chuỗi không phải đường dẫn tuyệt đối là chưa biết. */
export function applyHome(home: string | null | undefined): void {
  homeDir = typeof home === 'string' && home.startsWith('/') ? normalizePath(home) : null
}

/**
 * Đích mở đầu `~/`, `$HOME/` hay `${HOME}/` (0.9.0 A2), phần sau không có `$`, backtick hay ký tự glob: đường dẫn dưới thư mục nhà. Biết
 * thư mục nhà thì giải thành đường dẫn tuyệt đối, chưa biết thì giữ dạng `~/...`. Dạng khác (`~user/x`, `$OTHER/x`) trả null.
 */
export function homeTarget(token: string): string | null {
  const match = /^(?:~|\$HOME|\$\{HOME\})\/(.+)$/.exec(token)
  const rest = match?.[1]
  if (rest === undefined || /[$`*?]/.test(rest)) return null
  const tail = normalizePath(rest)
  if (tail === '' || tail.startsWith('..')) return null
  return homeDir !== null ? normalizePath(`${homeDir}/${tail}`) : `~/${tail}`
}

/** Hai danh sách của mục tiêu (0.9.0 B1): tệp trạng thái và nơi ghi phụ prompt cho phép. */
export type SideLists = { stateFiles?: readonly string[]; sideWrites?: readonly string[] }

/** Một mục hay một đường dẫn thành dạng so được: `~/` giải theo thư mục nhà, tương đối nối vào `from` (khi có). */
function sideKey(item: string, from: string | null): string {
  const unified = item.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  const home = homeTarget(unified)
  const path = home ?? unified
  if (path.startsWith('/') || path.startsWith('~') || from === null) return normalizePath(path)
  return normalizePath(`${from}/${path}`)
}

/**
 * Đường dẫn thuộc tệp trạng thái hay nơi ghi phụ của mục tiêu (0.9.0 B1 tới B6): bằng một mục, hay nằm dưới một mục (thư mục); mục chỉ là
 * tên tệp thì khớp theo tên tệp. `which` 'state' chỉ xét tệp trạng thái. Đường dẫn tương đối neo theo `cwd`, không có thì theo `root`.
 * Danh sách rỗng là không khớp.
 */
export function isSidePath(path: string, lists: SideLists | null | undefined, root?: string | null, cwd?: string | null, which: 'state' | 'all' = 'all'): boolean {
  if (lists === null || lists === undefined || path.trim() === '') return false
  const entries = which === 'state' ? [...(lists.stateFiles ?? [])] : [...(lists.stateFiles ?? []), ...(lists.sideWrites ?? [])]
  if (entries.length === 0) return false
  const base = root ? normalizePath(root) : null
  const from = cwd ? sideKey(cwd, base) : base
  const file = sideKey(path, from)
  const name = file.split('/').pop() ?? ''
  return entries.some(entry => {
    const clean = entry.trim().replace(/\\/g, '/').replace(/\/+$/, '')
    if (clean === '') return false
    if (!clean.includes('/')) return name === clean
    const key = sideKey(clean, base)
    return file === key || file.startsWith(`${key}/`)
  })
}

/** Thư mục tạm: ghi dưới đây không tính là sửa file của việc (0.9.0 C2, D1). */
const ROLE_TEMP_DIRS = ['/tmp/', '/private/tmp/', '/var/folders/']
export const isRoleTemp = (path: string) => ROLE_TEMP_DIRS.some(dir => normalizePath(path).startsWith(dir))
