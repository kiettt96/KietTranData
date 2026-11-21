// 0.9.0 vòng 2 M21a: eval-router.ts dọn mọi thư mục tạm fc-eval-* nó tạo, cả khi chạy xong, khi lỗi và khi bị ngắt.
// Môi trường test không spawn được tiến trình nên kiểm bộ theo dõi thư mục tạm với fs và process giả; phép chạy thật ghi ở VERIFICATION.

import { describe, expect, test } from 'claude-code/testing'

import { cleanOnExit, tmpDirs } from '../scripts/tmp-dirs'

function fakeFs() {
  const live = new Set<string>()
  let n = 0
  return {
    live,
    make: (prefix: string) => {
      const path = `${prefix}${++n}`
      live.add(path)
      return path
    },
    remove: (path: string) => {
      live.delete(path)
    },
  }
}

function fakeProc() {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>()
  const exits: number[] = []
  return {
    exits,
    on(event: string, fn: (...args: unknown[]) => void) {
      handlers.set(event, [...(handlers.get(event) ?? []), fn])
      return this
    },
    exit(code?: number) {
      exits.push(code ?? 0)
    },
    emit(event: string, ...args: unknown[]) {
      for (const fn of handlers.get(event) ?? []) fn(...args)
    },
  }
}

describe('0.9.0 M21a: thư mục tạm của eval-router', () => {
  test('drop xoá đúng thư mục của một lượt, clean xoá phần còn lại', () => {
    const fs = fakeFs()
    const dirs = tmpDirs(fs)
    const work = dirs.make('/t/fc-eval-')
    const config = dirs.make('/t/fc-eval-config-')
    dirs.drop(config)
    expect([...fs.live]).toEqual([work])
    dirs.clean()
    expect(fs.live.size).toBe(0)
  })

  test('lỗi khi xoá một thư mục không chặn việc xoá các thư mục khác', () => {
    const fs = fakeFs()
    const dirs = tmpDirs({ make: fs.make, remove: path => {
      if (path.endsWith('1')) throw new Error('bận')
      fs.remove(path)
    } })
    dirs.make('/t/fc-eval-')
    dirs.make('/t/fc-eval-config-')
    dirs.clean()
    expect([...fs.live]).toEqual(['/t/fc-eval-1'])
  })

  test('thoát thường: dọn hết', () => {
    const fs = fakeFs()
    const proc = fakeProc()
    const dirs = tmpDirs(fs)
    cleanOnExit(dirs, proc)
    dirs.make('/t/fc-eval-')
    proc.emit('exit', 0)
    expect(fs.live.size).toBe(0)
  })

  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]] as const) {
    test(`bị ngắt bằng ${signal}: dọn hết rồi thoát mã ${code}`, () => {
      const fs = fakeFs()
      const proc = fakeProc()
      const dirs = tmpDirs(fs)
      cleanOnExit(dirs, proc)
      dirs.make('/t/fc-eval-')
      dirs.make('/t/fc-eval-config-')
      proc.emit(signal)
      expect(fs.live.size).toBe(0)
      expect(proc.exits).toEqual([code])
    })
  }

  test('lỗi không bắt được: dọn hết rồi thoát mã 1', () => {
    const fs = fakeFs()
    const proc = fakeProc()
    const dirs = tmpDirs(fs)
    cleanOnExit(dirs, proc, () => {})
    dirs.make('/t/fc-eval-')
    proc.emit('uncaughtException', new Error('hỏng'))
    expect(fs.live.size).toBe(0)
    expect(proc.exits).toEqual([1])
  })

  test('lời hứa bị từ chối không ai bắt: dọn hết rồi thoát mã 1', () => {
    const fs = fakeFs()
    const proc = fakeProc()
    const dirs = tmpDirs(fs)
    cleanOnExit(dirs, proc, () => {})
    dirs.make('/t/fc-eval-')
    proc.emit('unhandledRejection', new Error('hỏng'))
    expect(fs.live.size).toBe(0)
    expect(proc.exits).toEqual([1])
  })
})
