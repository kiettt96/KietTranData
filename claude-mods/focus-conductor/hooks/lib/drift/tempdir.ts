// Viết lại lệnh có thư mục tạm do mktemp tạo, pushd, popd và git chạy trong thư mục tạm (vòng sửa cuối 18/11, A5), dùng chung cho rào
// definite của vai chỉ đọc (lib/team.ts) và sổ thay đổi (drift/evidence.ts).

import { isRoleTemp } from './scope'

/** Đường dẫn đại diện cho thư mục mktemp tạo (vòng sửa cuối 18/11, A5): nằm trong thư mục tạm. */
const MKTEMP_DIR = '/tmp/mktemp'

/**
 * Viết lại lệnh cho rào definite của vai chỉ đọc (vòng sửa cuối 18/11, A5): `$(mktemp ...)` và biến gán từ nó thành một đường dẫn trong thư
 * mục tạm; `pushd X` thành `cd X`, `popd` thành `cd` về thư mục trước đó; đoạn `git ...` chạy khi thư mục làm việc (theo cd, pushd trong
 * cùng lệnh) nằm trong thư mục tạm thì bỏ. Chỉ xét chuỗi nối bằng `&&`, `;`, xuống dòng.
 */
export function tempRewrite(command: string, cwd: string | null): string {
  if (!/\bmktemp\b|\bpushd\b|\bpopd\b|\bgit\b/.test(command)) return command
  let text = command
  const names = [...text.matchAll(/(?:^|[\s;&(])([A-Za-z_][A-Za-z0-9_]*)=\$\(\s*mktemp\b[^()]*\)/g)].map(m => m[1] ?? '')
  text = text.replace(/\$\(\s*mktemp\b[^()]*\)/g, MKTEMP_DIR)
  for (const name of names) text = text.replace(new RegExp(`\\$\\{${name}\\}|\\$${name}\\b`, 'g'), MKTEMP_DIR)
  const parts = text.split(/(\s*(?:&&|;|\n)\s*)/)
  const stack: string[] = []
  let dir = cwd
  const resolve = (arg: string | undefined) => {
    const target = (arg ?? '').replace(/^["']|["']$/g, '')
    if (target === '' || /[$`~]/.test(target)) return null
    if (target.startsWith('/')) return target.replace(/\/+$/, '') || '/'
    return dir === null ? null : `${dir.replace(/\/+$/, '')}/${target}`
  }
  for (let k = 0; k < parts.length; k += 2) {
    const piece = (parts[k] ?? '').trim()
    const words = piece.split(/\s+/)
    if (words[0] === 'cd') dir = resolve(words[1])
    else if (words[0] === 'pushd') {
      stack.push(dir ?? '')
      dir = resolve(words[1])
      parts[k] = `cd ${words[1] ?? ''}`
    } else if (words[0] === 'popd') {
      const back = stack.pop()
      dir = back === undefined || back === '' ? null : back
      // popd ở cuối lệnh không đổi chỗ chạy của đoạn nào: bỏ, để lệnh trước đó vẫn được xét ở thư mục tạm.
      const isLast = parts.slice(k + 1).every(part => part.trim() === '')
      parts[k] = isLast ? 'true' : dir === null ? 'cd -' : `cd ${dir}`
    } else if (words[0] === 'git' && dir !== null && isRoleTemp(`${dir}/`)) parts[k] = 'true'
  }
  return parts.join('')
}
