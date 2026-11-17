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
  // Lệnh đo (0.9.0 B7): băm và so tệp, không ghi file khi không có chuyển hướng ghi; shasum -c chỉ đọc tệp tổng.
  'shasum', 'sha256sum', 'sha1sum', 'md5', 'md5sum', 'cksum', 'cmp', 'comm',
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
export const AWK_WRITE = /\bprintf?\b[^;}\n]*?(?:>|\|)|\bsystem\s*\(|\|\s*getline\b/

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
    const rest = args.slice(i + 1)
    // git grep (mọi chuỗi tìm), git stash list và show, git branch chỉ in (0.9.0, đổi đặc tả C2 mục 5).
    if (sub === 'grep') return true
    if (sub === 'stash') return rest[0] === 'list' || rest[0] === 'show'
    if (sub === 'branch') return rest.every(a => ['--show-current', '--list', '-l', '-a', '-r', '-v', '-vv', '--all', '--remotes'].includes(a))
    // diff, log, show với --output ghi kết quả ra tệp (0.9.0, kiểm độc lập vòng 3 của C2).
    if (rest.some(a => a === '--output' || a.startsWith('--output='))) return false
    return sub === undefined || READ_ONLY_GIT.has(sub)
  }
  // printenv chỉ in biến môi trường; env cũng vậy khi không kèm lệnh (env FOO=1 make thì chạy make).
  if (cmd === 'printenv') return true
  if (cmd === 'env') return args.every(a => a.startsWith('-'))
  // command -v, command -V (0.9.0 B7): chỉ tra tên lệnh; command kèm lệnh khác thì xét lệnh đó ở nơi gọi.
  if (cmd === 'command') return (args[0] === '-v' || args[0] === '-V') && args.length >= 2
  // bash -n, sh -n, zsh -n (0.9.0 B7): chỉ đọc cú pháp script, không chạy; mọi cờ phải là -n.
  if (cmd === 'bash' || cmd === 'sh' || cmd === 'zsh') return args[0] === '-n' && args.slice(1).every(a => !a.startsWith('-'))
  if (!READ_ONLY_COMMANDS.has(cmd)) return false
  if (cmd === 'find') {
    // find -exec lệnh chỉ đọc (0.9.0, đổi đặc tả C2 mục 5): mỗi mệnh đề -exec, -execdir (tới ; hay +) phải là lệnh chỉ đọc; cờ ghi khác thì không.
    let ok = true
    for (let i = 0; i < args.length; i++) {
      const arg = args[i] ?? ''
      if (arg === '-exec' || arg === '-execdir') {
        const end = args.findIndex((a, k) => k > i && (a === ';' || a === '\\;' || a === '+'))
        const inner = args.slice(i + 1, end < 0 ? args.length : end).filter(a => a !== '{}').join(' ')
        if (inner === '' || !segmentIsReadOnly(inner)) ok = false
        i = end < 0 ? args.length : end
      } else if (FIND_WRITE.test(arg)) ok = false
    }
    return ok
  }
  // awk -i inplace ghi file tại chỗ (0.9.0, đổi đặc tả C2).
  if (cmd === 'awk' && args.some((a, i) => a === '--inplace' || a === '-iinplace' || (a === '-i' && args[i + 1] === 'inplace'))) return false
  // sed -i ghi file; lệnh w, flag s///w và lệnh e của sed ghi file hoặc chạy lệnh khác. sort -o ghi file.
  // Script sed đã bỏ nháy tách thành nhiều từ (`'w out.txt'`): xét cả chuỗi đối số nối lại (0.9.0, kiểm độc lập vòng 3 của C2).
  if (cmd === 'sed') return !args.some(a => /^-[A-Za-z]*i/.test(a) || a.startsWith('--in-place') || SED_WRITE.test(a)) && !SED_WRITE.test(` ${args.join(' ')}`)
  // tree -o ghi tệp; uniq có hai đối số vị trí thì đối số thứ hai là tệp ra (0.9.0, kiểm độc lập vòng 3 của C2).
  if (cmd === 'tree') return !args.some(a => a === '-o' || a.startsWith('-o'))
  if (cmd === 'uniq') return args.filter(a => !a.startsWith('-')).length < 2
  if (cmd === 'sort') return !args.some(a => /^-o/.test(a) || a.startsWith('--output'))
  return true
}

/**
 * Lệnh Bash chỉ đọc: mọi đoạn là lệnh chỉ đọc, không có chuyển hướng ghi (trừ /dev/null và
 * 2>&1), không có thay thế lệnh $( ) hay backtick. Chuỗi trong nháy được bỏ trước khi kiểm.
 */
export function isReadOnlyCommand(command: string): boolean {
  // Thay thế tiến trình (0.9.0 B9): `<(lệnh)` một tầng chỉ đọc khi lệnh bên trong chỉ đọc; `>(` hay lồng nhau thì không.
  if (command.includes('<(') || command.includes('>(')) {
    const inner: string[] = []
    const outer = command.replace(/<\(([^()`$]*)\)/g, (_m, body: string) => {
      inner.push(body)
      return '/dev/fd/63'
    })
    if (outer.includes('<(') || outer.includes('>(') || inner.length === 0) return false
    return inner.every(isReadOnlyCommand) && isReadOnlyCommand(outer)
  }
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
