// Band phía trên prompt: mục tiêu hiện tại, mức độ, model đang chạy, tiến độ
// checklist và cảnh báo mới nhất. Tối đa hai dòng để không chiếm chỗ.
// Hàm vẽ thuần: nhận bảng phần tử của surface, dữ liệu và các handler mà
// hook đã tạo; không tự gọi $.

import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import { describePick } from '../lib/route'
import type { View } from '../lib/state'
import { progress } from '../lib/text'

export type BandHandlers = {
  onDetails: () => unknown
  onHide: () => unknown
}

/** Trả cây để vẽ, hoặc null khi band nên nhường chỗ cho engine. */
export function renderBand(
  t: Elements[RenderSurface],
  view: View,
  maxRows: number,
  handlers: BandHandlers,
): RenderElement | null {
  const { brief, plan, route, warnings } = view.core
  if (view.mode === 'off' || brief === null || view.isBandHidden) return null
  const { Box, Text, Button } = t

  const latest = warnings.filter(w => w.at >= brief.at).at(-1)
  const { closed, total } = progress(plan)
  const steps = total > 0 ? `bước ${closed}/${total}` : brief.steps.length > 0 ? `${brief.steps.length} bước dự kiến` : ''
  const routeText = route ? `${view.mode === 'suggest' ? 'đề xuất' : 'chạy'} ${describePick(route)}` : ''
  const facts = [`${brief.depth} · ${brief.volume}`, routeText, steps, view.mode === 'auto' ? '' : `chế độ ${view.mode}`]
    .filter(Boolean)
    .join(' · ')

  const header = (
    <Box flexShrink={1}>
      <Text wrap="truncate-end">
        <Text color="claude" bold>
          Mục tiêu
        </Text>{' '}
        {brief.goal}
      </Text>
    </Box>
  )
  const details = (
    <Box flexDirection="row" gap={1}>
      <Box flexShrink={1}>
        <Text dimColor wrap="truncate-end">
          {facts}
        </Text>
      </Box>
      {latest ? (
        <Box flexShrink={2}>
          <Text color="warning" wrap="truncate-end">
            {latest.text}
          </Text>
        </Box>
      ) : null}
      <Button key="details" label="Chi tiết" onPress={handlers.onDetails} />
      <Button key="hide" label="Ẩn" onPress={handlers.onHide} />
    </Box>
  )

  return maxRows >= 2 ? (
    <Box flexDirection="column">
      {header}
      {details}
    </Box>
  ) : (
    details
  )
}
