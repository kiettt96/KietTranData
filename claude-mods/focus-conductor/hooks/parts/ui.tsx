// Giao diện: band trên prompt và pane chi tiết.

import { atom, derive, read, update } from 'claude-code'
import * as S from '../lib/state'
import { renderBand } from '../ui/band'
import { PANE, PANE_TITLE, renderPane } from '../ui/pane'
import type { On } from 'claude-code'
import type { Ctx } from '../context'
import { viewOf } from '../atoms'

// Atom của mod, khai báo lại ở mỗi file dùng chúng (engine chỉ nhận tham chiếu state viết trong chính file đó);
// cùng plugin và key nên là cùng một giá trị trong $.state.
const coreState = atom({ plugin: 'focus-conductor', key: 'core' } as const, S.EMPTY_CORE)
const bandHiddenState = atom({ plugin: 'focus-conductor', key: 'isBandHidden' } as const, false)
const modeState = atom({ plugin: 'focus-conductor', key: 'mode' } as const, null)

export function registerUi(on: On, ctx: Ctx): void {
  const { resetLocal } = ctx
  const view = derive([coreState, modeState, bandHiddenState], viewOf(ctx.options))

  // ------------------------------------------------------- giao diện

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const tree = renderBand($.ui.resolve(e), await read($, view), e.props.maxRows, {
      onDetails: () => $.ui.open({ id: PANE, title: PANE_TITLE }),
      onHide: () => update($, bandHiddenState, () => true),
    })
    return tree ?? next(e)
  })

  on('ui.render', { component: 'Pane', requestId: 'focus-conductor' }, async ($, e) =>
    renderPane($.ui.resolve(e), await read($, view), {
      onMode: picked => update($, modeState, () => picked),
      onReset: async () => {
        resetLocal()
        await update($, coreState, S.resetCore)
      },
      onToggleBand: () => update($, bandHiddenState, hidden => !hidden),
    }),
  )
}
