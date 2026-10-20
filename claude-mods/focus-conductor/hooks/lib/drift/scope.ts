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
 * `gốc/phạm vi`; phạm vi chỉ là tên file (có phần mở rộng, không có /) thì khớp theo tên file bên trong gốc; ngoài
 * gốc (worktree hay checkout khác) là ngoài phạm vi, trừ khi nằm dưới một mục phạm vi tuyệt đối. Mọi so khớp theo ranh giới
 * thư mục sau chuẩn hóa. Không có gốc thì không khẳng định gì (unknown), không quay về khớp theo chuỗi.
 */
export function scopeStatus(path: string, scopePaths: readonly string[], root?: string | null, cwd?: string | null): ScopeStatus {
  if (scopePaths.length === 0 || path === '') return 'in'
  if (!root) return 'unknown'
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
    if (!s.includes('/') && /\.[A-Za-z0-9]+$/.test(s)) return name === s
    return isUnder(resolve(s, base))
  })
    ? 'in'
    : 'out'
}

/** Đường dẫn chắc chắn nằm trong phạm vi (cần thư mục gốc; không có gốc thì không khẳng định). */
export function isInScope(path: string, scopePaths: readonly string[], root?: string | null, cwd?: string | null): boolean {
  return scopeStatus(path, scopePaths, root, cwd) === 'in'
}
