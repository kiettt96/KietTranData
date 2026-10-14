// Lệnh Bash chỉ đọc: tách đoạn lệnh và nhận ra lệnh không ghi file.
// Chuyển nguyên văn từ hooks/lib/drift.ts (tách theo tầng, không đổi hành vi); hooks/lib/drift.ts là barrel.

/** Tách lệnh nối bằng &&, ||, ;, | hoặc xuống dòng, bỏ ngoặc, biến môi trường và timeout ở đầu mỗi đoạn. */
export function segments(command: string): string[] {
  return command
    .split(/\s*(?:&&|\|\||[;|\n])\s*/)
    .map(part =>
      part
        .trim()
        .replace(/^[({]+\s*/, '')
        // Tiền tố gán biến (FOO=1 npm test), hoặc cả đoạn chỉ là phép gán (D=/đường/dẫn): bỏ đi, không phải lệnh.
        .replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*(?:\s+|$))+/, '')
        .replace(/^timeout\s+\d+\s+/, ''),
    )
}

// Lệnh chỉ đọc, theo tên lệnh đầu mỗi đoạn. `find`, `sed`, `sort` và `git` có đối số ghi riêng (xem dưới).
const READ_ONLY_COMMANDS = new Set([
  'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'egrep', 'fgrep', 'rg', 'find', 'tree', 'pwd', 'which', 'stat',
  'diff', 'sort', 'uniq', 'cut', 'jq', 'echo', 'printf', 'cd', 'awk', 'sed', 'tr', 'basename', 'dirname',
  'realpath', 'readlink', 'file', 'du', 'df', 'date', 'true', 'false', 'test', '[', 'column', 'nl', 'less',
  'more', 'type', 'uname', 'id', 'whoami', 'sleep',
])
const READ_ONLY_GIT = new Set([
  'status', 'log', 'diff', 'show', 'ls-files', 'ls-remote', 'rev-parse', 'blame', 'fetch', 'describe',
  'shortlog', 'cat-file',
])
const FIND_WRITE = /^-(?:delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)$/
// Lệnh w/W/e của sed (đứng đầu hoặc sau dấu ngăn, chữ số địa chỉ, dấu / hay $) và flag w của s///.
const SED_WRITE = /(?:^|[;{}\s\d$/'"])(?:w|W|e)\s+\S|\/[gpIi0-9]*[wW]\s+\S/
export const AWK_COMMAND = /(?:^|[\s;&|(])[gmn]?awk\b/
// print/printf của awk kèm chuyển hướng hoặc ống, và system(): ghi file hoặc chạy lệnh khác.
export const AWK_WRITE = /\bprintf?\b[^;}\n]*?(?:>|\|)|\bsystem\s*\(/

export function segmentIsReadOnly(part: string): boolean {
  const tokens = part.trim().split(/\s+/).filter(Boolean)
  const cmd = tokens[0]
  if (cmd === undefined) return true
  const args = tokens.slice(1)
  if (cmd === 'git') {
    // Bỏ các tùy chọn đứng trước lệnh con (git -C dir status, git -c k=v log).
    let i = 0
    while (i < args.length && args[i]?.startsWith('-')) i += ['-C', '-c', '--git-dir', '--work-tree'].includes(args[i] ?? '') ? 2 : 1
    const sub = args[i]
    return sub === undefined || READ_ONLY_GIT.has(sub)
  }
  // printenv chỉ in biến môi trường; env cũng vậy khi không kèm lệnh (env FOO=1 make thì chạy make).
  if (cmd === 'printenv') return true
  if (cmd === 'env') return args.every(a => a.startsWith('-'))
  if (!READ_ONLY_COMMANDS.has(cmd)) return false
  if (cmd === 'find') return !args.some(a => FIND_WRITE.test(a))
  // sed -i ghi file; lệnh w, flag s///w và lệnh e của sed ghi file hoặc chạy lệnh khác. sort -o ghi file.
  if (cmd === 'sed') return !args.some(a => /^-[A-Za-z]*i/.test(a) || a.startsWith('--in-place') || SED_WRITE.test(a))
  if (cmd === 'sort') return !args.some(a => /^-o/.test(a) || a.startsWith('--output'))
  return true
}

/**
 * Lệnh Bash chỉ đọc: mọi đoạn là lệnh chỉ đọc, không có chuyển hướng ghi (trừ /dev/null và
 * 2>&1), không có thay thế lệnh $( ) hay backtick. Chuỗi trong nháy được bỏ trước khi kiểm.
 */
export function isReadOnlyCommand(command: string): boolean {
  // Thay thế lệnh và system() của awk có thể chạy lệnh khác; kiểm trên lệnh gốc, trước khi bỏ chuỗi trong nháy.
  if (/\$\(|`|\bsystem\s*\(/.test(command)) return false
  // Script sed nằm trong nháy: kiểm trên lệnh gốc. Có thể báo nhầm một pattern chứa "w e"; chấp nhận, vì an toàn hơn.
  if (/\bsed\b/.test(command) && SED_WRITE.test(command)) return false
  // Script awk nằm trong nháy: print/printf chuyển hướng (>, >>) hay nối ống (|) là ghi file hoặc chạy lệnh khác.
  if (AWK_COMMAND.test(command) && AWK_WRITE.test(command)) return false
  const unquoted = command.replace(/"[^"]*"|'[^']*'/g, '""')
  const writes = unquoted.replace(/\d*>&\d+|&?\d*>>?\s*\/dev\/null/g, '')
  if (writes.includes('>')) return false
  return segments(unquoted).every(segmentIsReadOnly)
}
