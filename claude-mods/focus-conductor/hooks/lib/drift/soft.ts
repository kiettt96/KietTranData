// Thay đổi nhẹ (0.8.0 A5): file dữ liệu và báo cáo không phải mã. Đuôi mặc định (luật X6) cộng glob người dùng khai ở option softPaths.
// `.json` và `.yaml` không tự tính là nhẹ vì thường là cấu hình. Thay đổi vào file nhẹ vẫn được đếm, nhưng không đủ để cảnh báo chưa kiểm.

import type { WriteEffect } from './classify'

/** Đuôi tài liệu, dữ liệu và báo cáo (0.8.0 A5), không phân biệt hoa thường. */
const SOFT_EXT = /\.(?:md|markdown|txt|csv|tsv|jsonl|log)$/i

/** Glob người dùng khai (option softPaths) đã đổi thành biểu thức chính quy. */
let softGlobs: RegExp[] = []

/** Một glob thành biểu thức: `**` khớp mọi đoạn đường dẫn, `*` khớp trong một đoạn, `?` một ký tự. Glob không bắt đầu bằng "/" khớp từ đầu một thư mục bất kỳ. */
function globToRegExp(glob: string): RegExp {
  let out = ''
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i] ?? ''
    if (ch === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        out += '(?:.*/)?'
        i += 2
      } else {
        out += '.*'
        i += 1
      }
    } else if (ch === '*') out += '[^/]*'
    else if (ch === '?') out += '[^/]'
    else out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`${glob.startsWith('/') ? '^' : '(?:^|/)'}${out}$`)
}

/** Đọc option softPaths: glob phân tách bằng dấu phẩy; mục rỗng bị bỏ. */
export function parseSoftPaths(raw: unknown): string[] {
  if (typeof raw !== 'string') return []
  return raw
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

/** Áp danh sách glob cho lần nạp mod này; danh sách rỗng là bỏ hết. */
export function applySoftPaths(globs: readonly string[]): void {
  softGlobs = globs.map(globToRegExp)
}

/** File này là thay đổi nhẹ: đuôi dữ liệu, báo cáo hay tài liệu, hoặc khớp một glob softPaths. */
export function isSoftPath(path: string): boolean {
  return SOFT_EXT.test(path) || softGlobs.some(re => re.test(path))
}

/**
 * Tác động ghi của Bash là thay đổi chắc chắn vào file không nhẹ: mức definite, không phải mkdir, và có đích không đọc được hoặc có
 * một đích không nhẹ. Mức possible (lệnh lạ, script) không bao giờ là thay đổi chắc chắn.
 */
export function isHardEffect(effect: WriteEffect): boolean {
  if (effect.level !== 'definite' || effect.name === 'mkdir') return false
  return effect.isUnknown || effect.paths.length === 0 || effect.paths.some(path => !isSoftPath(path))
}
