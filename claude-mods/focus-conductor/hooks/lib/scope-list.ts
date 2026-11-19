/**
 * Danh sách file của phạm vi mục tiêu (0.9.0 vòng 2 M13): chụp trước và sau mỗi lượt có vai chỉ đọc hay vai kiểm, để file mới ngoài thư
 * mục tạm làm kết luận của lượt đó không được tính. Dùng `$.fs.list` (engine 2.1.296); engine không có hay lỗi thì null (không đo được,
 * giữ như trước). Duyệt rộng, bỏ thư mục phụ thuộc và .git, trần PRINT_FILES file.
 */

import { PRINT_FILES } from './prints'
import { isRoleTemp } from './drift/scope'

export type ListFs = { list?: (path?: string) => Promise<ReadonlyArray<{ name: string; kind: 'file' | 'dir' | 'other'; size?: number; mtimeMs?: number }>> }

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.focus-conductor'])

/** Các thư mục gốc của phạm vi: mục phạm vi tuyệt đối, mục tương đối nối với thư mục gốc của phiên; không có thì thư mục gốc. */
export function scopeRoots(scopePaths: readonly string[] | undefined, root: string | null): string[] {
  const roots = (scopePaths ?? []).map(p => (p.startsWith('/') ? p : root !== null ? `${root.replace(/\/$/, '')}/${p}` : '')).filter(p => p !== '' && !isRoleTemp(p))
  if (roots.length > 0) return [...new Set(roots.map(p => p.replace(/\/+$/, '') || '/'))].slice(0, 10)
  return root !== null ? [root] : []
}

export async function listScope(fs: ListFs, roots: readonly string[]): Promise<string[] | null> {
  if (typeof fs.list !== 'function' || roots.length === 0) return null
  const files: string[] = []
  const queue = [...roots]
  try {
    while (queue.length > 0 && files.length < PRINT_FILES) {
      const dir = queue.shift() as string
      const entries = await fs.list(dir)
      for (const entry of entries) {
        const path = `${dir === '/' ? '' : dir}/${entry.name}`
        if (entry.kind === 'dir') {
          if (!SKIP_DIRS.has(entry.name) && queue.length < PRINT_FILES) queue.push(path)
        } else if (files.length < PRINT_FILES) files.push(`${path}\u0000${entry.size ?? 0}:${entry.mtimeMs ?? 0}`)
      }
    }
  } catch {
    return null
  }
  return files
}

/**
 * File mới hay file đổi kích thước hoặc mtime ngoài thư mục tạm giữa hai lần chụp (mỗi mục là đường dẫn kèm dấu kích thước và mtime). Sửa
 * một file đã có trong phạm vi mà file đó chưa vào tập dấu cũng được bắt (dạng lân cận của M13).
 */
export function newFiles(before: readonly string[], after: readonly string[]): string[] {
  const had = new Set(before)
  return after.filter(item => !had.has(item)).map(item => item.split('\u0000')[0] ?? item).filter(path => !isRoleTemp(path))
}
