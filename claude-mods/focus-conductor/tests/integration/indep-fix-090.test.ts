// 0.9.0, vòng sửa sau kiểm độc lập: (1) vai chỉ đọc và audit không chạy được lệnh tự sửa hay lệnh ghi đã biết ở mức possible (eslint --fix,
// curl -o, perl -pi, find -delete, patch, node -e), và lệnh đó làm kết luận không còn sạch; (2) cổng đóng theo kết luận mới nhất, như pane;
// (3) ghi nháp vào thư mục tạm không tính vào số file bật đội hình; (4) đoạn lệnh của bước bị che mã thoát (; echo, || true, &) không là
// bằng chứng; (5) kết quả mong đợi so theo ranh giới từ (=> 1 không khớp 10); (6) vai chỉ đọc không chạy git commit, push, tag.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { roleDenial } from '../../hooks/parts/agents'
import { stepEvidence, stepRunOf } from '../../hooks/lib/drift/stepcheck'
import { hardFileCount } from '../../hooks/lib/team'
import { JS } from '../fixtures/runner-output'
import { base, plan, step, submit } from '../support/engine'
import type { Json, Seen } from '../support/engine'

describe('0.9.0 vòng sửa (1, 6): quyền theo vai với lệnh ghi mức possible và git', () => {
  for (const command of ['eslint --fix src', 'prettier --write src', 'curl -o /repo/x http://a', 'perl -pi -e s/a/b/ src/a.ts', 'find src -delete', 'patch -p1 < x.diff', "node -e \"require('fs').writeFileSync('a', '1')\"", "python3 -c \"open('a','w')\""]) {
    test(`review và audit bị từ chối: ${command}`, () => {
      expect(roleDenial('review', 'Bash', { command }, 'duyệt')).not.toBeNull()
      expect(roleDenial('audit', 'Bash', { command }, 'kiểm')).not.toBeNull()
    })
  }
  for (const command of ['git commit -am x', 'git push origin main', 'git tag v1']) {
    test(`vai chỉ đọc bị từ chối: ${command}`, () => {
      expect(roleDenial('review', 'Bash', { command }, 'duyệt')).not.toBeNull()
    })
  }
  // Đổi đặc tả C2 (danh sách cho phép): script lạ không chứng minh được nên vai duyệt bị từ chối; vai kiểm vẫn chạy được.
  for (const command of ['bash tests/kiem.sh', 'bun test', 'git status', 'git diff --stat', "bash -c 'source src/a.sh; f 1'", 'node scripts/check.js']) {
    test(`vẫn chạy được: ${command}`, () => {
      expect(roleDenial('audit', 'Bash', { command }, 'kiểm')).toBeNull()
    })
  }
  for (const command of ['bun test', 'git status', 'git diff --stat']) {
    test(`vai duyệt vẫn chạy được: ${command}`, () => {
      expect(roleDenial('review', 'Bash', { command }, 'duyệt')).toBeNull()
    })
  }
})

describe('0.9.0 vòng sửa (3, 4, 5): số file và bằng chứng theo bước', () => {
  test('tệp trong thư mục tạm không tính vào số file bật đội hình', () => {
    expect(hardFileCount(['/tmp/a.ts', '/tmp/b.ts', '/tmp/c.ts'])).toBe(0)
    expect(hardFileCount(['src/a.ts', '/tmp/b.ts'])).toBe(1)
  })
  for (const command of ['bun test > /tmp/o.txt; echo xong', 'bun test || true', 'bun test &']) {
    test(`đoạn lệnh của bước bị che mã thoát không là bằng chứng: ${command}`, () => {
      expect(stepEvidence({ check: '`bun test`' }, [stepRunOf(command, false, '12 pass', 5)], 1, 0)).toBeNull()
    })
  }
  test('kết quả mong đợi so theo ranh giới: => 1 không khớp 10, khớp 1', () => {
    expect(stepEvidence({ check: '`grep -c tong out.json` => 1' }, [stepRunOf('grep -c tong out.json', false, '10', 5)], 1, 0)).toBeNull()
    expect(stepEvidence({ check: '`grep -c tong out.json` => 1' }, [stepRunOf('grep -c tong out.json', false, '1', 5)], 1, 0)).not.toBeNull()
    expect(stepEvidence({ check: '`bash x.sh` => TỔNG: ĐẠT' }, [stepRunOf('bash x.sh', false, 'K1: ĐẠT\nTỔNG: ĐẠT', 5)], 1, 0)).not.toBeNull()
  })
})

const PLAN = 'mcp__focus-conductor__plan'
const GOAL = (over: Json = {}) => plan({ goal: 'Sửa luồng phí', depth: 'substantial', volume: 'medium', kind: 'edit', main: { model: 'sonnet', effort: 'medium' }, ...over })
const OPTS = { options: { planApproval: 'off', checkCommands: 'bun test' } }
function setup(on: On, reply: Json = GOAL()): Seen {
  const seen = base(on, { router: () => reply })
  on('tool.call', { tool: /^(?:Edit|Write|Read|Agent)$/ }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: JS.bun_pass }))
  on('agent.spawn', (_$, e) => ({ model: 'claude-opus-5-5', agentId: `a-${String((e as { tool_use_id?: unknown }).tool_use_id)}` }) as never)
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  on('agent.offer', () => ({ isOffered: true }))
  return seen
}
const stop = async ($: Engine) => String(((await $.classic.Stop({ stop_hook_active: false } as never)) as { block?: string }).block ?? '')
let n = 0
async function answer($: Engine, description: string, text: string, commands: readonly string[] = []) {
  const id = `f${(n += 1)}`
  await $.tool.call({ tool: 'Agent', tool_use_id: id, description, prompt: 'Rà.' } as never)
  await $.agent.spawn({ prompt: 'Rà.', description, tool_use_id: id } as never)
  for (const command of commands) await $.tool.call({ tool: 'Bash', command, agentId: `a-${id}` } as never)
  await $.turn.complete({ turnId: `x-${id}`, agentId: `a-${id}`, answer: text, durationMs: 5, isAborted: false, reason: 'answer' } as never)
}
async function start($: Engine, seen: Seen) {
  await $.agent.offer({ agent: 'general-purpose', description: 'việc chung', source: 'built-in', provider: { plugin: 'engine', tier: 'core' } } as never)
  await submit($, 'Sửa luồng phí')
  await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa phí' }] })
  await $.turn.start({ text: 'Sửa luồng phí', turnId: 't1' })
  await step($, seen, { turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: 'src/phi.ts', old_string: 'a', new_string: 'b' } as never)
  await $.tool.call({ tool: 'Bash', command: 'bun test' } as never)
}
const close = ($: Engine) => $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'done' })

describe('0.9.0 vòng sửa (1, 2, 3): cổng đóng', () => {
  test('subagent không tiền tố chạy eslint --fix rồi trả ĐẠT: kết luận không tính, cổng chặn', OPTS, async ($, on) => {
    const seen = setup(on)
    await start($, seen)
    await answer($, 'Rà phí', 'ĐẠT', ['eslint --fix src', 'bun test'])
    await close($)
    expect(await stop($)).toContain('duyệt độc lập')
  })
  test('duyệt ĐẠT rồi duyệt lần hai CHƯA ĐẠT, không sửa gì: cổng chặn', OPTS, async ($, on) => {
    const seen = setup(on)
    await start($, seen)
    await answer($, 'Duyệt: phí', 'ĐẠT')
    await answer($, 'Duyệt: phí lần hai', 'CHƯA ĐẠT\n- Lớn: thiếu test')
    await close($)
    expect(await stop($)).toContain('duyệt độc lập')
  })
  test('hard: SẴN SÀNG rồi CHƯA SẴN SÀNG: cổng chặn', OPTS, async ($, on) => {
    const seen = setup(on, GOAL({ depth: 'hard', main: { model: 'opus', effort: 'high' } }))
    await start($, seen)
    await answer($, 'Duyệt: phí', 'ĐẠT')
    await answer($, 'Sẵn sàng: phí', 'SẴN SÀNG')
    await answer($, 'Sẵn sàng: phí lần hai', 'CHƯA SẴN SÀNG')
    await close($)
    expect(await stop($)).toContain('SẴN SÀNG')
  })
  test('mục tiêu light ghi ba tệp mã vào /tmp: không bật đội hình, không chặn', OPTS, async ($, on) => {
    const seen = setup(on, GOAL({ depth: 'light', volume: 'small' }))
    await submit($, 'Sửa luồng phí')
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa phí' }] })
    await $.turn.start({ text: 'Sửa luồng phí', turnId: 't1' })
    await step($, seen, { turnId: 't1' })
    for (const path of ['/tmp/a.ts', '/tmp/b.ts', '/tmp/c.ts']) await $.tool.call({ tool: 'Write', file_path: path, content: 'x' } as never)
    await close($)
    expect(await stop($)).toBe('')
  })
})
