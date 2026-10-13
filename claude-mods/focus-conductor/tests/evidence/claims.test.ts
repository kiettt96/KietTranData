// Đầu cụm claim của evidence (hooks/lib/drift/claims): tiền tố npx và wrapper, biến môi trường, chuyển hướng, đối số trong nháy, lệnh chạy nền, đường dẫn script, dấu --.
// Gom từ test của review PR #14 vòng 4 và 5; tên describe và test giữ nguyên.

import { describe, expect, test } from 'claude-code/testing'
import { classifyBash, completePass, evidenceStrength, newEvidenceLog, noteEvidence } from '../../hooks/lib/drift'
import { CARGO, GO, JS, NODE, tailLines } from '../fixtures/runner-output'
import { accepted, bash, edit, rejectAll, rejected, strength, verifiedAfter } from '../support/commands'

describe('PR #14 vòng 4: tiền tố npx là danh tính, token con không cứu claim', () => {
  test('chạy trực tiếp mà evidence nêu npx (có hay không có cờ): stale', () => {
    for (const evidence of ['npx --no-install tsc -p x: sạch', 'npx --yes tsc -p x: sạch', 'npx tsc -p x: sạch']) rejected('tsc -p x', evidence)
  })

  test('chạy npx mà evidence bỏ hay đổi tiền tố: stale', () => {
    rejected('npx --no-install tsc -p x', 'tsc -p x: sạch')
    rejected('npx --no-install tsc -p x', 'npx tsc -p x: sạch')
    rejected('npx --no-install tsc -p x', 'npx --yes tsc -p x: sạch')
    rejected('npx tsc -p x', 'tsc -p x: sạch')
  })

  test('đối chứng: cùng tiền tố, alias thật (-y là --yes, --no-install là --no)', () => {
    expect(accepted('npx tsc -p x', 'npx tsc -p x: sạch')).toBe(true)
    expect(accepted('npx -y tsc -p x', 'npx --yes tsc -p x: sạch')).toBe(true)
    expect(accepted('npx --no-install tsc -p x', 'npx --no tsc -p x: sạch')).toBe(true)
  })

  test('wrapper khác không bị bỏ ở evidence, kể cả đứng sau npx', () => {
    for (const wrapper of ['sudo', 'time', 'command', 'exec', 'nohup']) rejected('npm test', `${wrapper} npm test: 12 pass`)
    rejected('npx tsc -p x', 'npx sudo tsc -p x: sạch')
  })

  test('claim con chỉ hợp lệ trong python -m <module>; đối số của lệnh khác không là claim độc lập', () => {
    rejected('pytest tests/', 'python -m pytest tests/: đạt')
    expect(accepted('python -m pytest tests/', 'python -m pytest tests/: đạt')).toBe(true)
    rejected('npm test -- npm run lint', 'npm test -- npm run lint: 12 pass')
    rejected('npm test', 'npm test -- npm run lint: 12 pass')
  })
})

describe('PR #14 vòng 4: biến môi trường và chuyển hướng đầu vào là danh tính', () => {
  test('biến môi trường có trong lệnh chạy hay trong evidence: phải nêu cả hai phía', () => {
    rejected('CI=1 npm test', 'npm test: 12 pass')
    rejected('npm test', 'CI=1 npm test: 12 pass')
    rejected('TEST_FILTER=a npm test', 'TEST_FILTER=b npm test: 12 pass')
    expect(accepted('CI=1 npm test', 'CI=1 npm test: 12 pass')).toBe(true)
  })

  test('timeout N chỉ có thể làm lệnh lỗi, không tạo đạt giả: vẫn là cùng lệnh', () => {
    expect(accepted('timeout 60 npm test', 'npm test: 12 pass')).toBe(true)
  })

  test('chuyển hướng đầu vào khác nhau hay thiếu: stale; cùng nhau (dính hay tách): nhận', () => {
    rejected('node --test < input-a', 'node --test < input-b: đạt')
    rejected('node --test < input-a', 'node --test: đạt')
    rejected('node --test', 'node --test < input-a: đạt')
    expect(accepted('node --test < input-a', 'node --test < input-a: đạt')).toBe(true)
    expect(accepted('node --test < input-a', 'node --test <input-a: đạt')).toBe(true)
    expect(accepted('node --test <<< x', 'node --test <<< x: đạt')).toBe(true)
  })

  test('heredoc làm stdin: nội dung không so được, không bao giờ khớp', () => {
    rejected("node --test <<'EOF'\nx\nEOF", 'node --test: đạt')
    rejected("node --test <<'EOF'\nx\nEOF", 'node --test <<EOF: đạt')
    // Dấu giữ chỗ của heredoc không thể bị evidence mạo danh bằng một delimiter trùng tên.
    rejected("node --test <<'H'\nx\nH", 'node --test <<H: đạt')
  })
})

describe('PR #14 vòng 4: chuyển hướng đầu ra dựa vào mã thoát, không vào danh tính', () => {
  test('không qua ống: xác minh theo mã thoát, evidence có hay không có chuyển hướng đều nhận, dấu : vẫn là ranh giới', () => {
    expect(verifiedAfter('node --test src/a.test.ts > out.log')).toBe(true)
    for (const evidence of [
      'node --test src/a.test.ts: đạt', 'node --test src/a.test.ts > out.log: đạt', 'node --test src/a.test.ts >out.log: đạt',
      'node --test src/a.test.ts 2>/dev/null: đạt', 'node --test src/a.test.ts &> out.log: đạt', 'node --test src/a.test.ts 2>&1: đạt',
    ]) {
      expect(accepted('node --test src/a.test.ts > out.log', evidence), evidence).toBe(true)
    }
  })

  test('gộp luồng và chuyển hướng dính (&>, 2>&1, >&2) không bị đọc là lệnh chạy nền', () => {
    for (const command of ['node --test &> out.log', 'node --test 2>&1', 'node --test >&2', 'node --test 2>/dev/null']) {
      expect(verifiedAfter(command), command).toBe(true)
    }
  })

  test('chuyển hướng đầu ra rồi nối ống: không xác minh (output không còn đến từ lệnh)', () => {
    expect(verifiedAfter('node --test > out.log | cat', '# tests 1')).toBe(false)
  })
})

describe('PR #14 vòng 4: đối số trong nháy là một token duy nhất', () => {
  test('toán tử shell trong nháy không bị xóa hay tách ở cả hai phía', () => {
    expect(accepted("pytest -k 'a > b' tests/", "pytest -k 'a > b' tests/: đạt")).toBe(true)
    expect(accepted("pytest -k 'a|b' tests/", "pytest -k 'a|b' tests/: đạt")).toBe(true)
    expect(accepted('pytest -k "a b" tests/', "pytest -k 'a b' tests/: đạt")).toBe(true)
    expect(accepted("pytest -k 'smoke' tests/", 'pytest -k smoke tests/: đạt')).toBe(true)
    rejected("pytest -k 'a > b' tests/", 'pytest -k a > b tests/: đạt')
    rejected("pytest -k 'a > b' tests/", "pytest -k 'a b' tests/: đạt")
  })

  test('nháy mở sau một từ thường (không có lệnh kiểm tra trong mệnh đề) vẫn là nháy bao ngoài, lệnh trong nháy vẫn là claim', () => {
    expect(accepted('npm test', 'đã chạy "npm test": 12 pass')).toBe(true)
    rejected('npm test', 'đã chạy "npm run lint": đạt')
  })

  test('lệnh không phải kiểm tra có > trong nháy không tạo lệnh kiểm tra', () => {
    expect(classifyBash(`node -e 'console.log("x > y")'`).effects.some(e => e.kind === 'check')).toBe(false)
  })
})

describe('PR #14 vòng 4: lệnh chạy nền và |& không xác minh', () => {
  test('npm test & (nền): mã thoát không thuộc về nó', () => {
    expect(verifiedAfter('npm test & echo ok', 'ok')).toBe(false)
    expect(verifiedAfter('npm test &')).toBe(false)
    expect(verifiedAfter('echo a & npm test')).toBe(true)
  })

  test('|& là ống không hỗ trợ: hidden', () => {
    const effect = classifyBash('npm test |& cat').effects.find(e => e.kind === 'check')
    expect(effect?.kind === 'check' && effect.exit).toBe('hidden')
    expect(verifiedAfter('npm test |& cat', 'Tests: 12 passed, 12 total')).toBe(false)
  })
})

describe('PR #14 vòng 4: ca biên do kiểm đột biến chỉ ra', () => {
  test('ống chỉ giữ mức filtered với bộ lọc chỉ đọc từ ống, đứng một mình: head, nhiều ống, output bị cắt đều không', () => {
    expect(verifiedAfter('node --test | cat', NODE.pass_tap)).toBe(true)
    expect(verifiedAfter('node --test | head -n 20', NODE.pass_tap)).toBe(false)
    expect(verifiedAfter('node --test | cat | true', NODE.pass_tap)).toBe(false)
    expect(verifiedAfter('cargo test | tail -n 100', CARGO.pass)).toBe(false)
    expect(verifiedAfter('go test ./... | tail -n 100', GO.pass)).toBe(false)
    expect(verifiedAfter('node --test | tail -n 12', tailLines(NODE.pass_tap, 12))).toBe(true)
  })

  test('lỗi có tiền tố tên lỗi hay Uncaught nằm TRƯỚC khối tổng kết đạt: không đạt', () => {
    expect(completePass(`TypeError: setup failed\n${JS.mocha_pass}`, 'mocha')).toBe(false)
    expect(completePass(`Uncaught TypeError: boom\n${JS.mocha_pass}`, 'mocha')).toBe(false)
    expect(completePass(`Uncaught Error: boom\n${JS.mocha_pass}`, 'mocha')).toBe(false)
    expect(completePass(`AssertionError [ERR_ASSERTION]: 1 == 2\n${JS.jest_pass}`, 'jest')).toBe(false)
    expect(completePass(JS.mocha_pass, 'mocha')).toBe(true)
  })

  test('lý do từ chối nêu đoạn lệnh kiểm tra, không nêu cả câu lệnh chứa nó', () => {
    const log = newEvidenceLog(1)
    noteEvidence(log, edit())
    noteEvidence(log, { ...bash('cd /repo && npm test'), isError: true })
    const result = evidenceStrength('npm test: đạt', log)
    expect(result.level).toBe('stale')
    expect(result.reason ?? '').toContain('`npm test`')
    expect(result.reason ?? '').not.toContain('cd /repo')
  })

  test('mã thoát 0 nhưng output có dấu hiệu lỗi: không xác minh', () => {
    expect(verifiedAfter('npm test', 'FAIL src/a.test.ts\nTests: 1 failed, 1 total')).toBe(false)
    expect(verifiedAfter('npm test', 'Tests: 1 passed, 1 total')).toBe(true)
  })

  test('lệnh kiểm tra sau ; vẫn được xác minh, sau && ... & thì cả danh sách chạy nền', () => {
    expect(verifiedAfter('echo a; npm test')).toBe(true)
    expect(verifiedAfter('npm test && echo ok &')).toBe(false)
    expect(verifiedAfter('echo a && npm test &')).toBe(false)
    expect(verifiedAfter('sleep 1 & npm test & echo b')).toBe(false)
  })

  test('|& là toán tử riêng: đoạn sau vẫn được đọc đúng (đích ghi của tee)', () => {
    expect(classifyBash('echo x |& tee src/a.ts').paths).toContain('src/a.ts')
  })

  test('wrapper có cờ đứng trước lệnh trong evidence vẫn là một phần cụm lệnh', () => {
    rejected('npm test', 'sudo -E npm test: 12 pass')
    rejected('npm test', 'time -p npm test: 12 pass')
    rejected('npx tsc -p x', 'nohup -x npx tsc -p x: sạch')
  })

  test('nháy chữ Việt đóng luôn là ranh giới, kể cả dính chữ sau; & đứng một mình là ranh giới', () => {
    expect(accepted('npm test', '“npm test”12 pass')).toBe(true)
    expect(strength(['npm test', 'npm run lint'], 'npm test & npm run lint: đạt').accepted).toBe(true)
    expect(strength(['npm test', 'npm run lint'], 'npm test && npm run lint: đạt').accepted).toBe(true)
    expect(strength(['npm test', 'npm run lint'], 'npm test |& npm run lint: đạt').accepted).toBe(true)
    rejected('npm test', 'npm test & npm run lint: đạt')
  })
})

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
