// 0.9.0 vòng 2 M21a: theo dõi thư mục tạm một script tạo ra và xoá chúng khi thoát thường, khi lỗi không bắt được và khi bị
// ngắt bằng tín hiệu. Tách khỏi eval-router.ts để test được với fs và process giả.

export type TmpOps = { make: (prefix: string) => string; remove: (path: string) => void }
export type TmpDirs = { make: (prefix: string) => string; drop: (path: string) => void; clean: () => void }
export type ProcLike = { on: (event: string, fn: (...args: unknown[]) => void) => unknown; exit: (code?: number) => unknown }

export function tmpDirs(ops: TmpOps): TmpDirs {
  const made = new Set<string>()
  const drop = (path: string) => {
    if (!made.delete(path)) return
    try {
      ops.remove(path)
    } catch {
      // Xoá hỏng một thư mục không chặn các thư mục còn lại.
    }
  }
  return {
    make: prefix => {
      const path = ops.make(prefix)
      made.add(path)
      return path
    },
    drop,
    clean: () => {
      for (const path of [...made]) drop(path)
    },
  }
}

// Mã thoát theo quy ước 128 cộng số hiệu tín hiệu.
const SIGNALS = [
  ['SIGINT', 130],
  ['SIGTERM', 143],
  ['SIGHUP', 129],
] as const

export function cleanOnExit(dirs: TmpDirs, proc: ProcLike, report: (error: unknown) => void = error => console.error(error), beforeExit: () => void = () => {}) {
  proc.on('exit', () => dirs.clean())
  for (const [signal, code] of SIGNALS)
    proc.on(signal, () => {
      beforeExit()
      dirs.clean()
      proc.exit(code)
    })
  for (const event of ['uncaughtException', 'unhandledRejection'])
    proc.on(event, error => {
      report(error)
      beforeExit()
      dirs.clean()
      proc.exit(1)
    })
}
