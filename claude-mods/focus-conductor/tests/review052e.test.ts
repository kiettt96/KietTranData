// Test tái hiện review PR #14 vòng 5: đầu cụm claim của evidence verified. Tùy chọn có giá trị và wrapper, đường dẫn script,
// dấu phân cách --, biến môi trường có nháy đều phải làm claim không khớp lệnh đã chạy. Chỉ dùng API đã có ở 87ad4a0.

import { describe, expect, test } from 'claude-code/testing'

import { acceptsVerified, evidenceStrength, newEvidenceLog, noteEvidence } from '../hooks/lib/drift'

const bash = (command: string, output = '') => ({ tool: 'Bash', input: { command }, isError: false, isReadOnly: false, output })
const edit = { tool: 'Edit', input: { file_path: '/repo/src/a.ts' }, isError: false, isReadOnly: false }

function strength(runs: string[], evidence: string) {
  const log = newEvidenceLog(1)
  noteEvidence(log, edit)
  for (const run of runs) noteEvidence(log, bash(run))
  const result = evidenceStrength(evidence, log)
  return { ...result, accepted: acceptsVerified(result, log) }
}
const accepted = (run: string, evidence: string) => strength([run], evidence).accepted

/** Ca âm: không nhận, mức stale, lý do trung tính nêu yêu cầu khớp chính xác. */
function rejected(run: string, evidence: string) {
  const result = strength([run], evidence)
  expect(result.accepted, `${run} / ${evidence}`).toBe(false)
  expect(result.level, `${run} / ${evidence}`).toBe('stale')
  expect(result.reason ?? '', `${run} / ${evidence}`).toContain('khớp chính xác')
}

/** Lặp các ca âm: mỗi ca là một lệnh expect độc lập. */
function rejectAll(run: string, claims: string[], suffix: string) {
  for (const claim of claims) rejected(run, `${claim}${suffix}`)
}

describe('PR #14 vòng 5: tùy chọn có giá trị và wrapper đứng trước lệnh', () => {
  test('wrapper có tùy chọn kèm giá trị hoặc đối số: không là lệnh kiểm tra trần', () => {
    rejectAll('npm test', [
      'sudo -u alice npm test', 'sudo -u alice -E npm test', 'time -f %e npm test', 'nice -n 5 npm test',
    ], ': 12 pass')
  })

  test('wrapper không tùy chọn, ống xargs, bọc container hay ssh: không là lệnh kiểm tra trần', () => {
    rejectAll('npm test', [
      'nice npm test', 'xargs npm test', 'nohup nice npm test', 'docker run img npm test', 'ssh host npm test',
    ], ': 12 pass')
  })

  test('cờ lạ không thuộc wrapper nào và câu văn chứa từ trùng tên wrapper', () => {
    rejected('npm test', 'chạy -x npm test: 12 pass')
    rejected('npm test', 'the time npm test: 12 pass')
  })

  test('trình chạy script hay runtime đứng trước lệnh: không là lệnh kiểm tra trần', () => {
    rejectAll('npm test', ['bash run.sh npm test', 'python run.py npm test', 'node run npm test', 'deno task npm test'], ': 12 pass')
  })

  test('npx và các runner gói với tsc: tiền tố là danh tính, bọc ngoài không được bỏ', () => {
    rejectAll('tsc -p x', [
      'npx --package typescript tsc -p x', 'npx -p typescript tsc -p x', 'bunx tsc -p x', 'npx tsc -p x',
      'yarn tsc -p x', 'pnpm dlx tsc -p x', 'pnpm exec tsc -p x',
    ], ': sạch')
  })

  test('chạy npx tsc mà evidence bỏ tiền tố hoặc bọc thêm ssh, docker: stale', () => {
    rejected('npx tsc -p x', 'tsc -p x: sạch')
    rejected('npx tsc -p x', 'ssh host npx tsc -p x: sạch')
    rejected('npx tsc -p x', 'docker run img npx --yes tsc -p x: sạch')
  })

  test('runner của Python: poetry run và uv run không là pytest trần', () => {
    rejectAll('pytest', ['poetry run pytest', 'uv run pytest'], ': đạt')
  })
})

describe('đường dẫn script', () => {
  test('mỗi nhánh đường dẫn độc lập: ./ ../ tuyệt đối ~/ đứng trước lệnh', () => {
    rejectAll('npm test', ['./run npm test', '../run npm test', '/opt/ci/run npm test', '~/run npm test'], ': 12 pass')
  })

  test('đường dẫn script chỉ khác nhau ở đuôi file: từng đuôi một', () => {
    rejectAll('npm test', ['run.py', 'run.sh', 'run.bash', 'run.zsh', 'run.js', 'run.mjs', 'run.cjs'].map(file => `${file} npm test`), ': 12 pass')
  })

  test('đường dẫn dữ liệu (không bắt đầu bằng ./ ../ / ~/ và không đuôi script) không phải tiền tố', () => {
    expect(accepted('npm test', 'src/a.ts npm test: 12 pass')).toBe(true)
    expect(accepted('npm test', 'đã sửa src/a.test.ts và npm test: 12 pass')).toBe(true)
  })
})

describe('mỗi từ trong danh sách tiền tố', () => {
  test('đứng một mình ngay trước lệnh kiểm tra: claim không khớp lần chạy trần', () => {
    const words = [
      'sudo', 'doas', 'command', 'nohup', 'exec', 'time', 'env', 'nice', 'ionice', 'stdbuf', 'setsid', 'taskset', 'chrt', 'flock',
      'xargs', 'strace', 'unbuffer', 'cross-env', 'dotenv', 'bunx', 'pnpx', 'dlx', 'uvx', 'docker', 'podman', 'kubectl', 'ssh',
      'bash', 'sh', 'zsh', 'dash', 'python', 'python3', 'node', 'bun', 'deno', 'npm', 'pnpm', 'yarn', 'uv', 'poetry', 'pipx',
    ]
    for (const word of words) rejected('npm test', `${word} npm test: 12 pass`)
    for (const word of words) rejected('npm test', `${word.toUpperCase()} npm test: 12 pass`)
  })
})

describe('dấu phân cách --', () => {
  test('-- tách lệnh khác ra khỏi claim: phần sau -- không là claim độc lập', () => {
    rejectAll('npm test', ['foo -- npm test', 'go test ./... -args npm test', 'npm test -- npm run lint'], ': 12 pass')
  })

  test('-- sau wrapper có tùy chọn: claim neo về dấu phân cách, vẫn stale', () => {
    rejected('npm test', 'sudo -u alice -- npm test: 12 pass')
    rejected('npm test', 'env CI=1 -- npm test: 12 pass')
  })

  test('log có hai lần chạy riêng: một claim ghép bằng -- không khớp lần nào', () => {
    const result = strength(['npm test', 'npm run lint'], 'npm test -- npm run lint: 12 pass')
    expect(result.accepted).toBe(false)
    expect(result.level).toBe('stale')
  })

  test('echo -- npm run lint không phải lệnh kiểm tra npm run lint', () => {
    rejected('npm run lint', 'echo -- npm run lint: 12 pass')
  })
})

describe('biến môi trường có nháy', () => {
  test('nháy không đóng hoặc giá trị là phép thay thế: không phải biến môi trường hợp lệ', () => {
    rejected('npm test', 'CI="1 npm test: 12 pass')
    rejected('npm test', "CI='1 npm test: 12 pass")
    rejected('npm test', 'CI=$(echo 1) npm test: 12 pass')
    rejected('npm test', 'CI="a\\"b" npm test: 12 pass')
  })

  test('thay thế lệnh trong giá trị hay trong đối số (lồng nhau, backtick, không đóng): không bị dấu ngoặc tách thành ranh giới', () => {
    rejected('npm test', 'CI=`echo 1` npm test: 12 pass')
    rejected('npm test', 'CI=$(echo $(echo 1)) npm test: 12 pass')
    rejected('npm test', 'CI=$(echo 1 npm test: 12 pass')
    rejected('go test ./...', 'go test $(go list ./...): ok')
  })

  test('chạy không có biến môi trường mà evidence nêu CI có nháy: stale', () => {
    rejected('npm test', 'CI="1" npm test: 12 pass')
    rejected('npm test', "CI='1' npm test: 12 pass")
  })

  test('biến môi trường thiếu hoặc khác giữa hai phía: stale', () => {
    rejected('CI=1 npm test', 'npm test: 12 pass')
    rejected('CI=1 npm test', 'CI="2" npm test: 12 pass')
    rejected('npm test', 'CI=1 npm test: 12 pass')
  })
})

describe('phía lệnh chạy không phải lệnh kiểm tra: fail closed', () => {
  test('lần chạy bọc ngoài không được coi là lệnh kiểm tra trần, dù evidence chép y nguyên', () => {
    rejected('sudo -u alice npm test', 'sudo -u alice npm test: 12 pass')
    rejected('npx --package typescript tsc -p x', 'npx --package typescript tsc -p x: sạch')
    rejected('./run.sh npm test', './run.sh npm test: 12 pass')
  })
})

describe('đối chứng: ca đúng vẫn được nhận', () => {
  test('biến môi trường có nháy hoặc không, hai phía cùng nêu', () => {
    expect(accepted('CI=1 npm test', 'CI=1 npm test: 12 pass'), 'CI=1').toBe(true)
    expect(accepted('CI="1" npm test', 'CI="1" npm test: 12 pass'), 'CI="1" cùng nháy').toBe(true)
    expect(accepted('CI="1" npm test', 'CI=1 npm test: 12 pass'), 'CI="1" so với CI=1').toBe(true)
    expect(accepted("CI='1 2' npm test", "CI='1 2' npm test: 12 pass"), "CI='1 2'").toBe(true)
  })

  test('npx có hay không có cờ, alias -y là --yes', () => {
    expect(accepted('npx tsc -p x', 'npx tsc -p x: sạch')).toBe(true)
    expect(accepted('npx --yes tsc -p x', 'npx --yes tsc -p x: sạch')).toBe(true)
    expect(accepted('npx -y tsc -p x', 'npx --yes tsc -p x: sạch')).toBe(true)
  })

  test('backtick bao lệnh trong lời văn vẫn là nháy bao ngoài, không phải thay thế lệnh', () => {
    expect(accepted('npm test', '`npm test` passed')).toBe(true)
    expect(accepted('npm test', 'đã chạy `npm test`: 12 pass')).toBe(true)
  })

  test('biến môi trường có nháy và khoảng trắng vẫn là tiền tố danh tính (chuẩn hóa cờ trình bày của trình chạy)', () => {
    expect(
      accepted("CI='1 2' node --test --test-reporter=tap src/a.test.ts", "CI='1 2' node --test src/a.test.ts: đạt"),
    ).toBe(true)
  })

  test('python -m <module> giữ nguyên claim', () => {
    expect(accepted('python -m pytest tests/', 'python -m pytest tests/: đạt')).toBe(true)
  })

  test('lời dẫn hay gạch đầu dòng trước lệnh vẫn là ranh giới, không phải wrapper', () => {
    for (const evidence of ['- npm test: 12 pass', '-- npm test: 12 pass', 'đã sửa src/a.ts và npm test: đạt', 'đã chạy npm test: 12 pass']) {
      expect(accepted('npm test', evidence), evidence).toBe(true)
    }
  })
})
