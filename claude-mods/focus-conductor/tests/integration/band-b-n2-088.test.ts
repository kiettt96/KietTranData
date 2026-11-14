// 0.8.8 N2: band hướng B "Ba ô phát sáng". Dòng 1 là ba ô (bước, model, hướng), mỗi lúc chỉ một ô tô đặc; ô hướng lấy nhãn theo mục cần
// chú ý đầu tiên (thứ tự của attention.ts không đổi), tạm dừng đứng trước mọi mục, không có mục nào thì theo checklist. Dòng 2 là câu cần
// chú ý kèm +N, hay lý do tạm dừng và lệnh chạy tiếp, hay thanh tiến độ. Không còn gờ bên trái. Band không vượt bề rộng; ô hướng không bị bỏ.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import type { Core, Warning, WarningKind } from '../../types'
import * as S from '../../hooks/lib/state'
import { directionOf, directionText } from '../../hooks/ui/direction'
import { DARK_SOLIDS } from '../../hooks/ui/neon'
import { makeBrief } from '../support/commands'
import { COMPLEX_PROMPT, base, plan, step, submit, task } from '../support/engine'
import { RESUME, memoryStore, quotaMeter, session } from '../support/quota'

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const PLAN = 'mcp__focus-conductor__plan'
const CHECK = '\u2713'
const DOT = '\u25CF'
const HALF = '\u25D0'
const TODO = '\u25CB'
const UP = '\u25B2'
const UP_HOLLOW = '\u25B3'
const PAUSE = '\u23F8'
const GUTTER = '\u258E'
const BUTTON_CELLS = 10

const kids = (n: Node) => (n.children ?? []).filter(c => c !== null && typeof c === 'object') as Node[]
const textOf = (n: unknown): string => (typeof n === 'string' ? n : n !== null && typeof n === 'object' ? (((n as Node).type === 'Button' ? [String((n as Node).props?.label ?? '')] : []).concat(((n as Node).children ?? []).map(textOf))).join('') : '')
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const WIDE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[ᄀ-ᅟ\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7A3\uFF00-\uFF60]/u
const cellsOf = (s: string) => [...segmenter.segment(s.normalize('NFC'))].reduce((sum, g) => sum + (WIDE.test(g.segment) ? 2 : 1), 0)
/** Ô tô đặc: có Text mang nền khác nền ô thường (ô thường của neon có nền DARK_SOLIDS.cell). */
const hasBg = (n: unknown): boolean => n !== null && typeof n === 'object' && ((((n as Node).type === 'Text' && typeof (n as Node).props?.backgroundColor === 'string' && (n as Node).props?.backgroundColor !== DARK_SOLIDS.cell)) || ((n as Node).children ?? []).some(hasBg))
const isDim = (n: unknown): boolean => n !== null && typeof n === 'object' && (((n as Node).type === 'Text' && (n as Node).props?.dimColor === true) || ((n as Node).children ?? []).some(isDim))

/**
 * Phần cố định của một dòng, như test 0.6.1 mục 3.3: Text theo số ô chữ, Button theo nhãn (ít nhất BUTTON_CELLS), hộp hàng cộng con và khoảng
 * cách; hộp co được (flexShrink 1) không tính, vì engine cắt chữ trong đó khi vẽ (kit test không vẽ ra chữ).
 */
function widthOf(n: unknown): number {
  if (typeof n === 'string') return cellsOf(n)
  if (n === null || typeof n !== 'object') return 0
  const node = n as Node
  if (node.type === 'Text') return cellsOf(textOf(node))
  if (node.type === 'Button') return Math.max(BUTTON_CELLS, cellsOf(String(node.props?.label ?? '')) + 2)
  if (node.props?.flexShrink === 1) return 0
  const children = kids(node)
  const gap = Number(node.props?.gap ?? node.props?.columnGap ?? 0)
  return children.reduce((sum, c) => sum + widthOf(c), 0) + gap * Math.max(0, children.length - 1)
}

/** Các dòng của band: hộp ngoài có hai cột, cột đầu rỗng (không còn gờ), cột hai là các dòng. */
async function bandLines($: Engine, columns: number, maxRows = 2): Promise<{ lines: Node[]; tree: Node }> {
  const ui = await $.ui.mount({ plugin: 'focus-conductor', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isCollapsed: false, isWorking: true, maxRows, bodyColumns: columns, scroll: { offset: 0, bodyRows: maxRows }, view: {} } } as never)
  const tree = (await ui.drawn()) as unknown as Node
  await ui.unmount()
  const columnsOfTree = kids(tree)
  return { lines: kids(columnsOfTree[1] as Node), tree }
}

/** Ba ô của dòng 1, theo thứ tự (khi có ô model); không tính nút (band hẹp đang tạm dừng đưa nút Chi tiết lên dòng 1). */
const cellsOfLine = (line: Node) => kids(line).filter(c => c.type !== 'Button')

async function running($: Engine, on: On, steps = ['BƯỚC 1: sửa module', 'BƯỚC 2: kiểm', 'BƯỚC 3: ghi tài liệu']) {
  const seen = base(on, { router: () => plan({ goal: 'Sửa module thanh toán', depth: 'substantial', volume: 'small', scope: ['src/'], main: { model: 'opus', effort: 'high', why: '' } }) })
  on('tool.call', { tool: 'Write' }, () => ({ result: 'đã ghi' }))
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: '12 pass' }))
  await submit($, 'Sửa module thanh toán trong src/')
  await $.tool.call({ tool: PLAN, action: 'set', steps: steps.map(title => ({ title })) } as never)
  await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' } as never)
  await $.tool.call({ tool: PLAN, action: 'update', step: 2, status: 'doing' } as never)
  await step($, seen)
  return seen
}

const COLUMNS = [120, 72, 56] as const

describe('0.8.8 N2: dòng 1 ba ô', () => {
  for (const columns of COLUMNS) {
    test(`${columns} cột, đang chạy không có mục cần chú ý: ba ô theo thứ tự; ô bước tô đặc có k/n; ô hướng "Đúng hướng"; dòng 2 có thanh với đầu thanh`, { options: { planApproval: 'off' } }, async ($, on) => {
      await running($, on)
      const { lines, tree } = await bandLines($, columns)
      expect(lines.length).toBe(2)
      const cells = cellsOfLine(lines[0] as Node)
      expect(cells.length).toBe(3)
      expect(textOf(cells[0])).toContain('1/3')
      expect(hasBg(cells[0])).toBe(true)
      expect(textOf(cells[1])).toContain('opus')
      expect(textOf(cells[2])).toContain(`${CHECK} Đúng hướng`)
      expect(hasBg(cells[2])).toBe(false)
      expect(textOf(lines[1])).toContain(HALF)
      expect(textOf(tree)).not.toContain(GUTTER)
      for (const line of lines) expect(widthOf(line), textOf(line)).toBeLessThanOrEqual(columns)
    })

    test(`${columns} cột, mục đầu là scope: ô hướng tô đặc "Lệch phạm vi"; ô bước không tô đặc; dòng 2 là câu cảnh báo kèm +N`, { options: { planApproval: 'off' } }, async ($, on) => {
      await running($, on)
      await $.tool.call({ tool: 'Write', file_path: '/repo/scripts/ngoai.py', content: 'x' } as never)
      // Mục thứ hai (bước verified không có lần test nào): +1.
      await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: 'npm test: 12 pass' } as never)
      const { lines } = await bandLines($, columns)
      const cells = cellsOfLine(lines[0] as Node)
      const direction = cells.at(-1) as Node
      expect(textOf(direction)).toContain(`${UP} Lệch phạm vi`)
      expect(hasBg(direction)).toBe(true)
      expect(hasBg(cells[0])).toBe(false)
      expect(textOf(lines[1])).toContain('ngoài phạm vi')
      expect(textOf(lines[1])).toMatch(/\+\d/)
      for (const line of lines) expect(widthOf(line), textOf(line)).toBeLessThanOrEqual(columns)
    })
  }

  test('tiếng Anh: ô hướng "On track", rồi "Out of scope"', { options: { planApproval: 'off', uiLanguage: 'en' } }, async ($, on) => {
    await running($, on)
    expect(textOf(cellsOfLine((await bandLines($, 120)).lines[0] as Node)[2])).toContain(`${CHECK} On track`)
    await $.tool.call({ tool: 'Write', file_path: '/repo/scripts/ngoai.py', content: 'x' } as never)
    expect(textOf(cellsOfLine((await bandLines($, 120)).lines[0] as Node).at(-1))).toContain(`${UP} Out of scope`)
  })

  test('xong, mọi bước verified: ô hướng "Đã kiểm 3/3" tô đặc; dòng 2 là thanh đầy', { options: { planApproval: 'off' } }, async ($, on) => {
    await running($, on)
    await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' } as never)
    await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
    for (const id of [1, 2, 3]) await $.tool.call({ tool: PLAN, action: 'update', step: id, status: 'verified', evidence: 'npm test: 12 pass' } as never)
    const { lines } = await bandLines($, 120)
    const cells = cellsOfLine(lines[0] as Node)
    expect(textOf(cells.at(-1))).toContain(`${CHECK} Đã kiểm 3/3`)
    expect(hasBg(cells.at(-1))).toBe(true)
    expect(hasBg(cells[0])).toBe(false)
    expect(textOf(lines[1])).toContain('\u2501'.repeat(6))
    expect(textOf(lines[1])).not.toContain('\u254C')
  })

  test('xong mà còn bước done: ô hướng "Đã kiểm 2/3" mức cần chú ý, không tô đặc', { options: { planApproval: 'off' } }, async ($, on) => {
    await running($, on)
    await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' } as never)
    await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: 'npm test: 12 pass' } as never)
    await $.tool.call({ tool: PLAN, action: 'update', step: 2, status: 'verified', evidence: 'npm test: 12 pass' } as never)
    // Sửa tiếp sau lần test đạt: bước 3 đóng bằng done không được tự nâng.
    await $.tool.call({ tool: 'Edit', file_path: 'src/b.ts', old_string: 'a', new_string: 'b' } as never)
    await $.tool.call({ tool: PLAN, action: 'update', step: 3, status: 'done' } as never)
    const cells = cellsOfLine((await bandLines($, 120)).lines[0] as Node)
    expect(textOf(cells.at(-1))).toContain(`${DOT} Đã kiểm 2/3`)
    expect(hasBg(cells[0])).toBe(true)
  })

  test('chưa có checklist: ô bước là mục tiêu; dòng 2 là các ô dự kiến', { options: { planApproval: 'off' } }, async ($, on) => {
    base(on, { router: () => plan({ goal: 'Nâng cấp module thanh toán', depth: 'hard', volume: 'large', tasks: [task('Tìm chỗ gọi', 'main', 'sonnet', 'low'), task('Đổi tên', 'main', 'sonnet', 'low'), task('Thiết kế', 'main', 'opus', 'high')] }) })
    await submit($, 'Nâng cấp module thanh toán')
    const { lines } = await bandLines($, 120)
    expect(textOf(cellsOfLine(lines[0] as Node)[0])).toContain('Nâng cấp module thanh toán')
    expect(textOf(lines[1])).toContain(TODO)
  })

  test('maxRows 1: một dòng có đủ ba ô và nút Chi tiết', { options: { planApproval: 'off' } }, async ($, on) => {
    await running($, on)
    const { lines } = await bandLines($, 120, 1)
    expect(lines.length).toBe(1)
    const text = textOf(lines[0])
    for (const part of ['1/3', 'opus', `${CHECK} Đúng hướng`, 'Chi tiết']) expect(text, part).toContain(part)
  })

  test('56 cột với tên bước có chữ CJK và emoji: không dòng nào vượt 56 ô; ô hướng còn nguyên; không tách đôi cụm ký tự', { options: { planApproval: 'off' } }, async ($, on) => {
    const title = 'BƯỚC 2: \u4FEE\u590D\u652F\u4ED8\u6A21\u5757 \uD83D\uDE80\uD83D\uDE80 kiểm thử phần còn lại của module thanh toán'
    await running($, on, ['BƯỚC 1: sửa', title, 'BƯỚC 3: ghi'])
    const { lines } = await bandLines($, 56)
    for (const line of lines) expect(widthOf(line), textOf(line)).toBeLessThanOrEqual(56)
    // Ô bước cắt tên bằng oneLine theo chỗ còn lại: cả dòng 1 (kể cả ô bước) vừa 56 ô.
    expect(kids(lines[0] as Node).reduce((sum, c) => sum + cellsOf(textOf(c)), 0) + kids(lines[0] as Node).length - 1).toBeLessThanOrEqual(56)
    expect(textOf(cellsOfLine(lines[0] as Node).at(-1))).toContain(`${CHECK} Đúng hướng`)
    // Không còn nửa cặp thay thế (emoji bị tách đôi).
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(textOf(lines[0]))).toBe(false)
  })
})

describe('0.8.8 N2: tạm dừng', () => {
  async function hardPause($: Engine, on: On) {
    const seen = base(on, RESUME)
    on('tool.register', () => ({ value: { tool: PLAN } }))
    on('command.register', () => ({ value: { command: 'conductor' } }))
    on('turn.complete', () => ({ text: '' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }))
    memoryStore(on)
    const meter = quotaMeter(on, [session(10)])
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }, { title: 'Kiểm' }] } as never)
    await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'doing' } as never)
    await step($, seen)
    meter.set([session(97)])
    await seen.clock.advance(10_000)
    await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
    return seen
  }

  for (const columns of COLUMNS) {
    test(`${columns} cột: ô hướng "Tạm dừng" tô đặc; dòng 2 có lý do, giờ làm mới và lệnh chạy tiếp; ô model mờ`, { options: { planApproval: 'off' } }, async ($, on) => {
      await hardPause($, on)
      const { lines } = await bandLines($, columns)
      const cells = cellsOfLine(lines[0] as Node)
      expect(textOf(cells.at(-1))).toContain(`${PAUSE} Tạm dừng`)
      expect(hasBg(cells.at(-1))).toBe(true)
      if (cells.length === 3) expect(isDim(cells[1])).toBe(true)
      // Lý do, giờ làm mới và lệnh chạy tiếp; band hẹp ghi tên cửa sổ ngắn và chỉ lệnh.
      const second = textOf(lines[1])
      expect(second).toContain('còn 3%')
      expect(second).toMatch(/[0-9]{2}:[0-9]{2} [0-9]{2}[/][0-9]{2}/)
      expect(second).toContain('/conductor resume')
      if (columns === 120) expect(second).toContain('hạn mức phiên (5 giờ)')
      for (const line of lines) expect(widthOf(line), textOf(line)).toBeLessThanOrEqual(columns)
    })
  }

  test('tiếng Anh: "Paused"', { options: { planApproval: 'off', uiLanguage: 'en' } }, async ($, on) => {
    await hardPause($, on)
    expect(textOf(cellsOfLine((await bandLines($, 120)).lines[0] as Node).at(-1))).toContain(`${PAUSE} Paused`)
  })
})

describe('0.8.8 N2: bảng nhãn ô hướng (mỗi dòng một ca, vi và en)', () => {
  const brief = makeBrief({ at: 1 })
  const warning = (kind: WarningKind): Warning => ({ at: 2, kind, text: `cảnh báo ${kind}` })
  const coreWith = (over: Partial<Core>): Core => S.normalizeCore({ ...S.EMPTY_CORE, brief, ...over } as never)
  const none = { paused: false, notice: null }
  const steps = (...statuses: string[]) => statuses.map((status, i) => ({ id: i + 1, title: `Bước ${i + 1}`, status })) as never
  const CASES: { name: string; core: Core; quota?: { paused: boolean; notice: string | null }; plan?: never; vi: string; en: string; tone: string }[] = [
    { name: 'không có mục nào', core: coreWith({}), plan: steps('done', 'doing'), vi: `${CHECK} Đúng hướng`, en: `${CHECK} On track`, tone: 'ok' },
    { name: 'tạm dừng', core: coreWith({ warnings: [warning('scope')] }), quota: { paused: true, notice: null }, vi: `${PAUSE} Tạm dừng`, en: `${PAUSE} Paused`, tone: 'pause' },
    { name: 'approval', core: coreWith({ approval: { goalId: 1, status: 'presented', rounds: 1, asked: true, awaitingAnswer: false } as never }), vi: `${UP_HOLLOW} Chờ duyệt`, en: `${UP_HOLLOW} Awaiting approval`, tone: 'attention' },
    { name: 'failed', core: coreWith({ delegations: { goalId: 1, items: [{ index: 9, state: 'failed' }] } as never }), vi: `${UP} Lô lỗi`, en: `${UP} Failed batch`, tone: 'warn' },
    { name: 'scope', core: coreWith({ warnings: [warning('scope')] }), vi: `${UP} Lệch phạm vi`, en: `${UP} Out of scope`, tone: 'warn' },
    { name: 'loop', core: coreWith({ warnings: [warning('loop')] }), vi: `${UP} Lặp lỗi`, en: `${UP} Loop`, tone: 'warn' },
    { name: 'notice', core: coreWith({}), quota: { paused: false, notice: 'còn 15%' }, vi: `${UP_HOLLOW} Gần hạn mức`, en: `${UP_HOLLOW} Near limit`, tone: 'attention' },
    { name: 'dropped', core: coreWith({ warnings: [warning('dropped')] }), vi: `${UP_HOLLOW} Mục bị bỏ`, en: `${UP_HOLLOW} Dropped item`, tone: 'attention' },
    { name: 'unverified', core: coreWith({ warnings: [warning('unverified')] }), vi: `${UP_HOLLOW} Chưa kiểm`, en: `${UP_HOLLOW} Unverified`, tone: 'attention' },
    { name: 'skill', core: S.withSkillWrite(1, '/repo/.claude/skills/x/SKILL.md')(coreWith({})), vi: `${UP_HOLLOW} Chưa kiểm`, en: `${UP_HOLLOW} Unverified`, tone: 'attention' },
    { name: 'budget', core: coreWith({ warnings: [warning('budget')] }), vi: `${UP_HOLLOW} Vượt ngân sách`, en: `${UP_HOLLOW} Over budget`, tone: 'attention' },
    { name: 'loại khác', core: coreWith({ warnings: [warning('drift')] }), vi: `${UP_HOLLOW} Cần chú ý`, en: `${UP_HOLLOW} Needs attention`, tone: 'attention' },
    { name: 'xong, mọi bước verified', core: coreWith({}), plan: steps('verified', 'verified'), vi: `${CHECK} Đã kiểm 2/2`, en: `${CHECK} Verified 2/2`, tone: 'done' },
    { name: 'xong, còn bước chưa verified', core: coreWith({}), plan: steps('verified', 'done', 'skipped'), vi: `${DOT} Đã kiểm 1/3`, en: `${DOT} Verified 1/3`, tone: 'attention' },
  ]
  for (const c of CASES) {
    test(`${c.name}: "${c.vi}" / "${c.en}"`, () => {
      const vi = directionOf(c.core, 'vi', c.quota ?? none, c.plan ?? [])
      const en = directionOf(c.core, 'en', c.quota ?? none, c.plan ?? [])
      expect(directionText(vi)).toBe(c.vi)
      expect(directionText(en)).toBe(c.en)
      expect(vi.tone).toBe(c.tone)
    })
  }
})
