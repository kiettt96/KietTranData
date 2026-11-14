// 0.8.8 N6g: band không còn hộp rỗng ở cột đầu (gờ trái đã bỏ ở N2): gốc là một hộp cột, mỗi con là một dòng.

import { describe, expect, test } from 'claude-code/testing'
import { base, plan, submit } from '../support/engine'

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const PLAN = 'mcp__focus-conductor__plan'
const kids = (n: Node) => (n.children ?? []).filter(c => c !== null && typeof c === 'object') as Node[]

describe('0.8.8 N6g: cấu trúc band', () => {
  for (const maxRows of [1, 2])
    test(`maxRows ${maxRows}: gốc là hộp cột gồm ${maxRows} dòng, không có hộp rỗng`, { options: { planApproval: 'off' } }, async ($, on) => {
      base(on, { router: () => plan({ goal: 'Sửa module thanh toán', depth: 'substantial', volume: 'small' }) })
      await submit($, 'Sửa module thanh toán')
      await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }, { title: 'Kiểm' }] } as never)
      const ui = await $.ui.mount({ plugin: 'focus-conductor', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isCollapsed: false, isWorking: true, maxRows, bodyColumns: 120, scroll: { offset: 0, bodyRows: maxRows }, view: {} } } as never)
      const tree = (await ui.drawn()) as unknown as Node
      await ui.unmount()
      expect(tree.type).toBe('Box')
      expect(tree.props?.flexDirection).toBe('column')
      expect(kids(tree).length).toBe(maxRows)
      for (const line of kids(tree)) expect(kids(line).length).toBeGreaterThan(0)
    })
})
