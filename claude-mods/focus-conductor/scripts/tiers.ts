// 0.9.0 vòng 2 M21b: các hàm thuần của chế độ chạy theo tầng của scripts/mutate.ts (cờ --tiered). Không có tác dụng phụ lúc
// import, để test nạp trực tiếp được.
//
// Tầng: t1 là tệp test cùng bản với mẫu (tên tệp có tiền tố phiên bản của mã mẫu); mid là tệp test nhắc module bị đột biến
// (thư mục cha và tên, hay tên tệp; lan qua tệp hỗ trợ trong tests/ mà tệp test nhập) cộng tệp đã diệt một mẫu khác của cùng
// module trong lượt; full là cả bộ. Luật nhận: KILLED khi mod không nạp hoặc có ít nhất một ca lỗi không do hết giờ; mọi ca
// lỗi đều do hết giờ là NOVERDICT; NOVERDICT, TIMEOUT, ERROR chạy lại tầng một lần; lần lại NOVERDICT thì đi tầng sau, TIMEOUT
// hay ERROR thì giữ làm phán quyết; qua cả bộ không ca lỗi là SURVIVED (EQUIVALENT nếu mẫu đã ghi tương đương).

export type TierName = 't1' | 'mid' | 'full'
export type TierVerdict = 'KILLED' | 'ZERO' | 'NOVERDICT' | 'TIMEOUT' | 'ERROR'
export type TierRun = { verdict: TierVerdict; failed: number; failNames: string[]; timeoutNames: string[]; failFiles: string[] }

/** Tiền tố phiên bản ba chữ số của mã mẫu (`090-M3b` cho `090`); mã không có tiền tố thì undefined. */
export function versionOf(id: string): string | undefined {
  return id.match(/^(\d{3})-/)?.[1]
}

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1)
const dirName = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

/** Ghép đường dẫn tương đối `rel` vào thư mục `from`, xử lý `.` và `..`. */
function joinPath(from: string, rel: string): string {
  const parts = from === '' ? [] : from.split('/')
  for (const part of rel.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}

/** Tệp trong `texts` mà tệp `path` nhập bằng đường dẫn tương đối. */
function importsOf(path: string, texts: Map<string, string>): string[] {
  const out: string[] = []
  for (const match of (texts.get(path) ?? '').matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const base = joinPath(dirName(path), match[1] as string)
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) if (texts.has(candidate)) out.push(candidate)
  }
  return out
}

/** Tệp test (theo thứ tự của `tests`) nhắc module `file`, trực tiếp hay qua tệp hỗ trợ trong `texts` mà nó nhập. */
export function mentionTests(file: string, texts: Map<string, string>, tests: string[]): string[] {
  const name = baseName(file).replace(/\.tsx?$/, '')
  const parent = baseName(dirName(file))
  const hit = new Set([...texts.keys()].filter(path => {
    const text = texts.get(path) as string
    return text.includes(`${parent}/${name}`) || text.includes(baseName(file))
  }))
  for (let grew = true; grew; ) {
    grew = false
    for (const path of texts.keys())
      if (!hit.has(path) && importsOf(path, texts).some(target => hit.has(target))) {
        hit.add(path)
        grew = true
      }
  }
  return tests.filter(path => hit.has(path))
}

/** Các tầng của một mẫu: t1 cùng bản, mid theo module và lịch sử diệt, full cả bộ. */
export function tierPlan(mutant: { id: string; file: string }, tests: string[], texts: Map<string, string>, history: Record<string, string[]>): [TierName, string[]][] {
  const version = versionOf(mutant.id)
  const t1 = version === undefined ? [] : tests.filter(path => baseName(path).includes(version))
  const mid = new Set([...mentionTests(mutant.file, texts, tests), ...(history[mutant.file] ?? [])])
  return [
    ['t1', t1],
    ['mid', tests.filter(path => mid.has(path))],
    ['full', tests],
  ]
}

/** Đọc đầu ra của một lượt `plugin test`. `timedOut` là true khi lượt bị kill vì quá hạn. */
export function parseRun(out: string, timedOut: boolean): TierRun {
  const match = out.match(/\n\s*(\d+) fail/)
  const failed = match ? Number(match[1]) : -1
  const failNames: string[] = []
  const timeoutNames: string[] = []
  const fileOf = new Map<string, string>()
  let current: string | undefined
  let file = ''
  for (const line of out.split('\n')) {
    const header = line.match(/^(tests\/\S+\.test\.tsx?):\s*$/)
    if (header) {
      file = header[1] as string
      continue
    }
    if (line.startsWith('(fail) ')) {
      current = line.slice(7)
      failNames.push(current)
      fileOf.set(current, file)
    } else if (line.startsWith('(pass) ') || line.startsWith('(skip) ')) current = undefined
    else if (current !== undefined && /timed out after \d+ ms/.test(line)) {
      timeoutNames.push(current)
      current = undefined
    }
  }
  const loads = !out.includes('did not load')
  const real = failNames.filter(name => !timeoutNames.includes(name))
  const verdict: TierVerdict = timedOut
    ? 'TIMEOUT'
    : !loads
      ? 'KILLED'
      : failed === -1
        ? 'ERROR'
        : failed > 0
          ? failNames.length > 0 && real.length === 0
            ? 'NOVERDICT'
            : 'KILLED'
          : 'ZERO'
  const failFiles = [...new Set(real.map(name => fileOf.get(name) ?? '').filter(path => path !== ''))]
  return { verdict, failed, failNames, timeoutNames, failFiles }
}

/** Bước tiếp sau một lượt của tầng: `retried` là true khi lượt này đã là lần chạy lại của tầng đó. */
export function stepOf(verdict: TierVerdict, retried: boolean): 'killed' | 'next' | 'retry' | 'stop' {
  if (verdict === 'KILLED') return 'killed'
  if (verdict === 'ZERO') return 'next'
  if (!retried) return 'retry'
  return verdict === 'NOVERDICT' ? 'next' : 'stop'
}

/** Phán quyết khi mẫu qua hết các tầng mà không bị diệt. */
export function finalOf(equivalent: boolean): 'SURVIVED' | 'EQUIVALENT' {
  return equivalent ? 'EQUIVALENT' : 'SURVIVED'
}
