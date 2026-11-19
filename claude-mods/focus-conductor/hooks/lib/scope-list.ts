/**
 * Danh sách file của phạm vi mục tiêu (0.9.0 vòng 2 M13): chụp trước và sau mỗi lượt có vai chỉ đọc hay vai kiểm, để file mới ngoài thư
 * mục tạm làm kết luận của lượt đó không được tính. Dùng `$.fs.list` (engine 2.1.296); engine không có hay lỗi thì null (không đo được,
 * giữ như trước). Duyệt rộng, bỏ thư mục phụ thuộc và .git, trần PRINT_FILES file.
 */

import { PRINT_FILES } from './prints'
import { isRoleTemp } from './drift/scope'

export type ListFs = {
  list?: (path?: string) => Promise<ReadonlyArray<{ name: string; kind: 'file' | 'dir' | 'other'; size?: number; mtimeMs?: number }>>
  /** Cho mục phạm vi không phải thư mục (kiểm độc lập vòng 1 lỗi 4). */
  stat?: (path: string) => Promise<{ size?: number; mtimeMs?: number }>
}

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.focus-conductor'])

/** Các thư mục gốc của phạm vi: mục phạm vi tuyệt đối, mục tương đối nối với thư mục gốc của phiên; không có thì thư mục gốc. */
export function scopeRoots(scopePaths: readonly string[] | undefined, root: string | null): string[] {
  const roots = (scopePaths ?? []).map(p => (p.startsWith('/') ? p : root !== null ? `${root.replace(/\/$/, '')}/${p}` : '')).filter(p => p !== '' && !isRoleTemp(p))
  if (roots.length > 0) return [...new Set(roots.map(p => p.replace(/\/+$/, '') || '/'))].slice(0, 10)
  return root !== null ? [root] : []
}

/**
 * Mỗi gốc đo riêng (kiểm độc lập vòng 1 lỗi 4): gốc engine báo không phải thư mục mà stat được (mục phạm vi là file) thì là một mục file;
 * lỗi khác thì ghi dấu vắng, để lần chụp sau thấy file mới tạo ở đó. Thư mục con không liệt kê được thì ghi dấu không đọc được rồi đi tiếp. Chỉ
 * khi engine không có `fs.list` mới trả null.
 */
export async function listScope(fs: ListFs, roots: readonly string[]): Promise<string[] | null> {
  if (typeof fs.list !== 'function' || roots.length === 0) return null
  const files: string[] = []
  const queue = [...roots]
  const isRoot = new Set(roots)
  while (queue.length > 0 && files.length < PRINT_FILES) {
    const dir = queue.shift() as string
    let entries: Awaited<ReturnType<NonNullable<ListFs['list']>>>
    try {
      entries = await fs.list(dir)
    } catch (error) {
      if (!isRoot.has(dir)) {
        files.push(`${dir}\u0000unreadable`)
        continue
      }
      // Chỉ gọi stat khi engine báo gốc không phải thư mục; lỗi khác (chưa có, không đọc được) ghi dấu vắng.
      const isNotDir = /ENOTDIR|not a directory/i.test(String((error as { message?: unknown } | null)?.message ?? error))
      const st = isNotDir && typeof fs.stat === 'function' ? await fs.stat(dir).catch(() => null) : null
      files.push(st === null ? `${dir}\u0000absent` : `${dir}\u0000${st.size ?? 0}:${st.mtimeMs ?? 0}`)
      continue
    }
    for (const entry of entries) {
      const path = `${dir === '/' ? '' : dir}/${entry.name}`
      if (entry.kind === 'dir') {
        if (!SKIP_DIRS.has(entry.name) && queue.length < PRINT_FILES) queue.push(path)
      } else if (files.length < PRINT_FILES) files.push(`${path}\u0000${entry.size ?? 0}:${entry.mtimeMs ?? 0}`)
    }
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
