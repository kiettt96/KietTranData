// 0.6.0 hạng mục A: đọc số đo hạn mức và quyết định vùng dừng (hooks/lib/quota.ts, hàm thuần).

import { describe, expect, test } from 'claude-code/testing'

import { REMAINING_MAX, REMAINING_MIN, clampRemaining, deniedInput, evaluateQuota, isPastLimit, isPauseActive, isStale, newPause, noteDenial, quotaBadge, quotaSettings } from '../hooks/lib/quota'
import { maskSecrets, recentLine } from '../hooks/lib/checkpoint'
import { quotaDenyText, quotaPausedContext, quotaReasonText } from '../hooks/lib/text'

const NOW = Date.parse('2026-10-15T08:00:00Z')
const LATER = '2026-10-15T10:00:00Z'
const PAST = '2026-10-15T07:00:00Z'
const DEFAULT = { session: 5, week: 2 }

describe('0.6.0 A: ngưỡng phần còn lại', () => {
  test('phiên: 94,9 chưa dừng, 95 dừng; tuần: 97,9 chưa dừng, 98 dừng', () => {
    expect(evaluateQuota([{ kind: 'five_hour', percentUsed: 94.9, resetsAt: LATER }], NOW, DEFAULT).zone).toBe('ok')
    expect(evaluateQuota([{ kind: 'five_hour', percentUsed: 95, resetsAt: LATER }], NOW, DEFAULT).zone).toBe('pause')
    expect(evaluateQuota([{ kind: 'seven_day', percentUsed: 97.9, resetsAt: LATER }], NOW, DEFAULT).zone).toBe('ok')
    expect(evaluateQuota([{ kind: 'seven_day', percentUsed: 98, resetsAt: LATER }], NOW, DEFAULT).zone).toBe('pause')
  })

  test('isPastLimit: đúng bằng ngưỡng thì dừng', () => {
    expect(isPastLimit(95, 5)).toBe(true)
    expect(isPastLimit(94.9, 5)).toBe(false)
    expect(isPastLimit(10, 90)).toBe(true)
    expect(isPastLimit(9.9, 90)).toBe(false)
  })

  test('hit ghi cửa sổ, phần trăm đã dùng, phần còn lại, giờ làm mới và ngưỡng', () => {
    const out = evaluateQuota([{ kind: 'five_hour', percentUsed: 96.5, resetsAt: LATER }], NOW, DEFAULT)
    expect(out.hits).toEqual([{ kind: 'five_hour', percentUsed: 96.5, remaining: 3.5, resetsAt: LATER, threshold: 5 }])
  })

  test('ngưỡng tùy chỉnh và kẹp biên 0,5 đến 99', () => {
    expect([REMAINING_MIN, REMAINING_MAX]).toEqual([0.5, 99])
    expect(clampRemaining(90, 5)).toBe(90)
    expect(clampRemaining(0, 5)).toBe(0.5)
    expect(clampRemaining(150, 5)).toBe(99)
    expect(clampRemaining('abc', 5)).toBe(5)
    expect(clampRemaining(Number.NaN, 2)).toBe(2)
    expect(clampRemaining('12', 5)).toBe(12)
    expect(evaluateQuota([{ kind: 'five_hour', percentUsed: 10, resetsAt: LATER }], NOW, { session: 90, week: 2 }).zone).toBe('pause')
  })

  test('quotaSettings đọc option: mặc định bật, 5 và 2; quotaGuard false thì tắt', () => {
    expect(quotaSettings({})).toEqual({ enabled: true, session: 5, week: 2 })
    expect(quotaSettings({ quotaGuard: false, pauseSessionRemainingPct: 90, pauseWeekRemainingPct: 0 })).toEqual({ enabled: false, session: 90, week: 0.5 })
  })

  test('kind lạ, spend_limit, NaN, Infinity và mảng rỗng không gây dừng và không ném lỗi', () => {
    expect(evaluateQuota([], NOW, DEFAULT)).toEqual({ zone: 'unknown', hits: [], nearest: null })
    expect(evaluateQuota([{ kind: 'spend_limit', percentUsed: 120 }], NOW, DEFAULT).zone).toBe('unknown')
    expect(evaluateQuota([{ kind: 'mystery', percentUsed: 99 }], NOW, DEFAULT).zone).toBe('unknown')
    expect(evaluateQuota([{ kind: 'five_hour', percentUsed: Number.NaN }], NOW, DEFAULT).zone).toBe('unknown')
    expect(evaluateQuota([{ kind: 'five_hour', percentUsed: Number.POSITIVE_INFINITY }], NOW, DEFAULT).zone).toBe('unknown')
    expect(evaluateQuota(null as never, NOW, DEFAULT).zone).toBe('unknown')
    expect(evaluateQuota([null, { kind: 5 }] as never, NOW, DEFAULT).zone).toBe('unknown')
  })

  test('một cửa sổ hợp lệ dưới ngưỡng thì vùng ok, dù cửa sổ kia không đọc được', () => {
    expect(evaluateQuota([{ kind: 'five_hour', percentUsed: 40, resetsAt: LATER }, { kind: 'seven_day', percentUsed: Number.NaN }], NOW, DEFAULT).zone).toBe('ok')
  })

  test('cả hai cửa sổ đều qua ngưỡng: hai hit', () => {
    const out = evaluateQuota([{ kind: 'five_hour', percentUsed: 99, resetsAt: LATER }, { kind: 'seven_day', percentUsed: 99, resetsAt: LATER }], NOW, DEFAULT)
    expect(out.hits.map(h => h.kind)).toEqual(['five_hour', 'seven_day'])
  })
})

describe('0.6.0 A: resetsAt đã qua là số đo cũ', () => {
  test('isStale: mốc đã qua là cũ, chưa tới hoặc vắng hoặc hỏng thì không', () => {
    expect(isStale(PAST, NOW)).toBe(true)
    expect(isStale(new Date(NOW).toISOString(), NOW)).toBe(true)
    expect(isStale(LATER, NOW)).toBe(false)
    expect(isStale(undefined, NOW)).toBe(false)
    expect(isStale('không phải ngày', NOW)).toBe(false)
  })

  test('số đo cũ không gây dừng; cửa sổ đã làm mới thì vùng tự mở', () => {
    expect(evaluateQuota([{ kind: 'five_hour', percentUsed: 99, resetsAt: PAST }], NOW, DEFAULT).zone).toBe('unknown')
    expect(evaluateQuota([{ kind: 'five_hour', percentUsed: 99, resetsAt: LATER }], Date.parse(LATER) + 1, DEFAULT).zone).toBe('unknown')
  })
})

describe('0.6.0 A: nearest cho band (trong vùng gấp đôi biên)', () => {
  test('còn 8% ở phiên (biên 5, gấp đôi là 10): nearest là phiên; còn 30% thì không có', () => {
    expect(evaluateQuota([{ kind: 'five_hour', percentUsed: 92, resetsAt: LATER }], NOW, DEFAULT).nearest).toEqual({ kind: 'five_hour', remaining: 8 })
    expect(evaluateQuota([{ kind: 'five_hour', percentUsed: 70, resetsAt: LATER }], NOW, DEFAULT).nearest).toBeNull()
  })

  test('hai cửa sổ cùng gần ngưỡng: chọn cửa sổ có phần còn lại gần ngưỡng nhất (tỷ lệ còn lại trên ngưỡng nhỏ nhất)', () => {
    const out = evaluateQuota([{ kind: 'five_hour', percentUsed: 92, resetsAt: LATER }, { kind: 'seven_day', percentUsed: 97, resetsAt: LATER }], NOW, DEFAULT)
    expect(out.nearest).toEqual({ kind: 'seven_day', remaining: 3 })
  })
})

describe('0.6.0 F: biên của các hàm quyết định (mẫu đột biến 060- sống sót ở lượt đầu)', () => {
  test('clampRemaining: chuỗi rỗng hay chỉ khoảng trắng dùng mặc định, không đọc thành 0', () => {
    expect(clampRemaining('', 5)).toBe(5)
    expect(clampRemaining('  ', 2)).toBe(2)
  })

  test('nearest: còn đúng gấp đôi biên vẫn tính; còn hơn gấp đôi thì không', () => {
    expect(evaluateQuota([{ kind: 'five_hour', percentUsed: 90, resetsAt: LATER }], NOW, DEFAULT).nearest).toEqual({ kind: 'five_hour', remaining: 10 })
    expect(evaluateQuota([{ kind: 'five_hour', percentUsed: 89.9, resetsAt: LATER }], NOW, DEFAULT).nearest).toBeNull()
  })

  test('quotaBadge: không dừng và không cửa sổ nào gần ngưỡng thì không có nhãn', () => {
    expect(quotaBadge(false, { zone: 'ok', hits: [], nearest: null })).toBeNull()
    expect(quotaBadge(false, { zone: 'ok', hits: [], nearest: { kind: 'five_hour', remaining: 8 } })).toEqual({ paused: false, left: 8 })
    expect(quotaBadge(true, { zone: 'pause', hits: [], nearest: null })).toEqual({ paused: true, left: null })
  })

  test('isPauseActive: tắt thì không bao giờ dừng, kể cả dừng của người dùng', () => {
    const NONE = { until: 0, kinds: [] }
    expect(isPauseActive(false, [{ kind: 'five_hour' }], newPause(0, 'user', []), NONE, 1)).toBe(false)
    expect(isPauseActive(false, [{ kind: 'five_hour' }], null, NONE, 1)).toBe(false)
  })

  test('isPauseActive: đúng mốc hết ép tiếp là dừng lại', () => {
    const forced = { until: 1_000, kinds: ['five_hour' as const] }
    expect(isPauseActive(true, [{ kind: 'five_hour' }], null, forced, 999)).toBe(false)
    expect(isPauseActive(true, [{ kind: 'five_hour' }], null, forced, 1_000)).toBe(true)
  })

  test('isPauseActive: ép tiếp chỉ miễn cửa sổ đã ép; cửa sổ khác qua ngưỡng vẫn dừng (góp ý PR 21)', () => {
    const forced = { until: 5_000, kinds: ['five_hour' as const] }
    expect(isPauseActive(true, [{ kind: 'seven_day' }], null, forced, 1_000)).toBe(true)
    expect(isPauseActive(true, [{ kind: 'five_hour' }, { kind: 'seven_day' }], null, forced, 1_000)).toBe(true)
    expect(isPauseActive(true, [], null, { until: 0, kinds: [] }, 1_000)).toBe(false)
  })

  test('noteDenial: chưa biết turnId (chưa có turn.start) thì không bao giờ dừng cứng', () => {
    let pause = newPause(0, 'quota', [])
    const results: boolean[] = []
    for (let i = 0; i < 4; i++) {
      const out = noteDenial(pause, '', { tool: 'Edit', input: '{}' })
      pause = out.pause
      results.push(out.abort)
    }
    expect(results).toEqual([false, false, false, false])
  })

  test('noteDenial: sang turn khác thì đếm lại từ một', () => {
    let pause = newPause(0, 'quota', [])
    pause = noteDenial(pause, 't1', { tool: 'Edit', input: '{}' }).pause
    pause = noteDenial(pause, 't1', { tool: 'Edit', input: '{}' }).pause
    const out = noteDenial(pause, 't2', { tool: 'Edit', input: '{}' })
    expect(out.pause.denials).toBe(1)
    expect(out.abort).toBe(false)
  })

  test('noteDenial: đã dừng cứng ở turn trước thì turn sau vẫn dừng cứng được ở lần thứ ba', () => {
    let pause = newPause(0, 'quota', [])
    const aborts: boolean[] = []
    for (const turn of ['a', 'a', 'a', 'b', 'b', 'b']) {
      const out = noteDenial(pause, turn, { tool: 'Edit', input: '{}' })
      pause = out.pause
      aborts.push(out.abort)
    }
    expect(aborts).toEqual([false, false, true, false, false, true])
  })

  test('quotaReasonText: dùng quá 100% thì phần còn lại là 0, không âm', () => {
    const text = quotaReasonText({ kind: 'five_hour', percentUsed: 101.5, thresholdRemainingPct: 5 })
    expect(text).toContain('chỉ còn 0%')
    expect(text).not.toContain('-')
  })
})

describe('0.6.0: điểm dừng không chứa nội dung file hay bí mật (góp ý PR 21)', () => {
  const BAIT = 'MOI_BI_MAT_9917'

  test('deniedInput: Write, Edit, MultiEdit, NotebookEdit chỉ ghi đường dẫn và độ dài nội dung', () => {
    expect(deniedInput({ tool: 'Write', file_path: 'src/a.ts', content: `${BAIT}xxxxx` })).toBe(`src/a.ts, nội dung ${BAIT.length + 5} ký tự`)
    expect(deniedInput({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'abc', new_string: `${BAIT}` })).toBe(`src/a.ts, nội dung ${3 + BAIT.length} ký tự`)
    expect(deniedInput({ tool: 'NotebookEdit', notebook_path: 'n.ipynb', new_source: BAIT })).toBe(`n.ipynb, nội dung ${BAIT.length} ký tự`)
    const edits = [{ old_string: 'a', new_string: BAIT }]
    const multi = deniedInput({ tool: 'MultiEdit', file_path: 'src/b.ts', edits })
    expect(multi).toBe(`src/b.ts, nội dung ${JSON.stringify(edits).length} ký tự`)
    expect(multi).not.toContain(BAIT)
  })

  test('deniedInput của Bash che Authorization, Bearer, token=, password=, --password và biến môi trường KEY=...', () => {
    const command = [
      `curl -H "Authorization: Bearer ${BAIT}1" https://x`,
      `curl -H 'Authorization: Basic ${BAIT}2'`,
      `curl "https://x?token=${BAIT}3&a=1"`,
      `mysql --password ${BAIT}4`,
      `./run --password=${BAIT}5 password=${BAIT}6`,
      `API_KEY=${BAIT}7 DB_PASS="${BAIT}8" ./deploy.sh`,
    ].join(' && ')
    const out = deniedInput({ tool: 'Bash', command })
    expect(out).not.toContain(BAIT)
    expect(out).toContain('curl')
  })

  test('recentLine che bí mật trong lệnh Bash', () => {
    const line = recentLine('Bash', `export TOKEN=${BAIT} && curl -H "Authorization: Bearer ${BAIT}"`, false)
    expect(line).not.toContain(BAIT)
    expect(line.startsWith('Bash export TOKEN=')).toBe(true)
  })

  test('maskSecrets: Bearer đứng riêng (không có Authorization) cũng bị che', () => {
    expect(maskSecrets(`curl -H "X-Auth: Bearer ${BAIT}" https://x`)).not.toContain(BAIT)
  })

  test('maskSecrets: các dạng bí mật còn lọt ở lượt đầu (góp ý PR 21)', () => {
    const cases = [
      `mysql -u root -p${BAIT}a mydb`,
      `mysqldump -h db -pS${BAIT}b > out.sql`,
      `curl -H "X-Api-Key: ${BAIT}c" https://x`,
      `curl -H 'X-Auth-Token: ${BAIT}d' https://x`,
      `export gh_token=${BAIT}e && gh api /user`,
      `MY_apikey=${BAIT}f ./run`,
      `curl -u admin:${BAIT}g https://x`,
      `wget --user=admin:${BAIT}h https://x`,
      `psql postgres://app:${BAIT}i@db.example.test:5432/app`,
      `git clone https://bot:${BAIT}j@github.example.test/o/r.git`,
    ]
    for (const c of cases) expect(maskSecrets(c)).not.toContain(BAIT)
  })

  test('maskSecrets: không che nhầm lệnh thường (git push -u, ls -p, URL không mật khẩu)', () => {
    for (const c of ['git push -u origin main', 'ls -p src', 'curl https://example.test/a:b/c', 'git clone https://github.example.test/o/r.git', 'npm test -- -p']) {
      expect(maskSecrets(c)).toBe(c)
    }
  })

  test('maskSecrets giữ nguyên lệnh không có bí mật', () => {
    expect(maskSecrets('npm test -- --runInBand src/a.test.ts')).toBe('npm test -- --runInBand src/a.test.ts')
  })
})

describe('0.6.1 2.2: cắt đầu vào trước khi che bí mật', () => {
  // Heredoc 300 KB, 20.000 lần chữ "mysql", không có dấu chấm phẩy hay xuống dòng thật (như sau khi JSON hóa đầu vào):
  // luật mysql -p của maskSecrets quét tới cuối chuỗi cho từng chữ "mysql".
  const heredoc = `cat <<'EOF' ${Array.from({ length: 20_000 }, (_, i) => `mysql dong ${i} xxxx`).join(' ')} EOF`

  test('deniedInput xử lý heredoc 300 KB dưới 200 ms và vẫn cắt về giới hạn', () => {
    expect(heredoc.length).toBeGreaterThan(300_000)
    const started = performance.now()
    const out = deniedInput({ tool: 'Bash', command: heredoc })
    expect(performance.now() - started).toBeLessThan(200)
    expect(out.length).toBeLessThanOrEqual(300)
  })

  test('recentLine xử lý heredoc 300 KB dưới 200 ms', () => {
    const started = performance.now()
    const line = recentLine('Bash', heredoc, false)
    expect(performance.now() - started).toBeLessThan(200)
    expect(line.length).toBeLessThanOrEqual(120)
  })
})

describe('0.6.1 2.3: câu nhắc theo nguồn dừng (hàm thuần)', () => {
  test('quotaPausedContext: người dùng tự dừng nhắc /conductor resume; dừng vì hạn mức nhắc resume force', () => {
    const user = quotaPausedContext([], true)
    expect(user).toContain('/conductor resume')
    expect(user).not.toContain('resume force')
    expect(quotaPausedContext([{ kind: 'five_hour', percentUsed: 97, thresholdRemainingPct: 5 }], false)).toContain('/conductor resume force')
  })

  test('quotaDenyText luồng chính: người dùng tự dừng nhắc /conductor resume; dừng vì hạn mức nhắc resume force', () => {
    const user = quotaDenyText([], true, false)
    expect(user).toContain('/conductor resume')
    expect(user).not.toContain('resume force')
    expect(quotaDenyText([{ kind: 'five_hour', percentUsed: 97, thresholdRemainingPct: 5 }], false, false)).toContain('/conductor resume force')
  })
})
