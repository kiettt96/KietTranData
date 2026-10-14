// Nhận diện lệnh kiểm tra và lệnh tự sửa của hooks/lib/drift.ts: trình chạy bọc (pnpm exec, uv run, bundle exec...) chỉ khi
// phần bọc là trình chạy đã biết; trình chạy và kiểm tĩnh mới; lệnh tự sửa (--fix, --write, --apply, *:fix, ruff format) là
// tác động ghi chứ không phải lệnh kiểm tra; lệnh riêng của dự án (checkCommands); nhật ký verify-reject.

import { describe, expect, test } from 'claude-code/testing'

import { acceptsVerified, checkKindOf, classifyBash, evidenceStrength, isMutation, newEvidenceLog, noteEvidence } from '../hooks/lib/drift'
import * as drift from '../hooks/lib/drift'
import { createContext } from '../hooks/context'
import { COMPLEX_PROMPT, base, submit } from './support/engine'

const bashCall = (command: string, isError = false) => ({ tool: 'Bash', input: { command }, isError, isReadOnly: false, output: '' })
const editCall = { tool: 'Edit', input: { file_path: '/repo/src/a.ts' }, isError: false, isReadOnly: false }
const mutates = (command: string) => isMutation(bashCall(command))

/** Sửa một file, chạy các lệnh, rồi đối chiếu evidence: có được nhận là verified không. */
function accepted(runs: string[], evidence: string): boolean {
  const log = newEvidenceLog(1)
  noteEvidence(log, editCall)
  for (const run of runs) noteEvidence(log, bashCall(run))
  return acceptsVerified(evidenceStrength(evidence, log), log)
}

describe('kiểm tĩnh mới: là lệnh kiểm tra, không phải thay đổi', () => {
  test('prettier, black, ruff format, cargo fmt, terraform, shellcheck và format:check đều là kiểm tĩnh', () => {
    const commands = [
    'prettier --check .',
    'prettier . --check',
    'npx prettier --check src',
    'black --check .',
    'black src --check',
    'ruff format --check .',
    'ruff format --diff .',
    'cargo fmt --check',
    'cargo fmt -- --check',
    'terraform fmt -check',
    'terraform validate',
    'shellcheck run.sh',
    'npm run format:check',
    'pnpm run format:check',
    'yarn format:check',
    'pnpm format:check',
    ]
    expect(commands.filter(command => checkKindOf(command) !== 'static' || mutates(command))).toEqual([])
  })

  test('gofmt -l không phải lệnh kiểm tra (liệt kê file chưa format nhưng vẫn thoát 0); prettier, black không kèm --check vẫn là ghi', () => {
    expect(checkKindOf('gofmt -l .')).toBeNull()
    expect(checkKindOf('prettier .')).toBeNull()
    expect(checkKindOf('black .')).toBeNull()
    expect(checkKindOf('cargo fmt')).toBeNull()
    expect(checkKindOf('terraform fmt')).toBeNull()
    expect(mutates('black .')).toBe(true)
    expect(mutates('cargo fmt')).toBe(true)
  })
})

describe('trình chạy test mới', () => {
  test('deno test, rspec, phpunit, swift test, tox, gradlew test, mvnw test và verify là test', () => {
    const commands = ['deno test', 'rspec', 'phpunit', 'swift test', 'tox', './gradlew test', './mvnw test', './mvnw verify']
    expect(commands.filter(command => checkKindOf(command) !== 'test' || mutates(command))).toEqual([])
  })

  test('./gradlew check là kiểm tĩnh; deno run, swift build kiểu khác không phải kiểm tra', () => {
    expect(checkKindOf('./gradlew check')).toBe('static')
    expect(checkKindOf('deno run main.ts')).toBeNull()
    expect(checkKindOf('swift package update')).toBeNull()
  })
})

describe('lệnh bọc: chỉ khi phần bọc là trình chạy đã biết', () => {
  test('trình chạy đã biết bọc bởi pnpm, yarn, bunx, uv run, poetry run, bundle exec hay ./node_modules/.bin là lệnh kiểm tra', () => {
    const cases: Array<[string, 'test' | 'static']> = [
    ['pnpm exec tsc -p tsconfig.json', 'static'],
    ['pnpm tsc --noEmit', 'static'],
    ['yarn tsc --noEmit', 'static'],
    ['yarn eslint .', 'static'],
    ['pnpm exec vitest run', 'test'],
    ['bunx vitest run', 'test'],
    ['uv run pytest tests/', 'test'],
    ['uv run python -m pytest tests/', 'test'],
    ['poetry run pytest -q', 'test'],
    ['poetry run mypy src', 'static'],
    ['bundle exec rspec', 'test'],
    ['./node_modules/.bin/jest', 'test'],
    ['./node_modules/.bin/tsc --noEmit', 'static'],
    ]
    expect(cases.filter(([command, kind]) => checkKindOf(command) !== kind || mutates(command)).map(([command]) => command)).toEqual([])
  })

  test('phần bọc không phải trình chạy đã biết thì không là lệnh kiểm tra, vẫn là ghi', () => {
    const commands = ['pnpm add eslint', 'yarn install', 'bunx create-react-app app', 'pnpm exec node script.js', 'uv run python script.py', 'poetry run python main.py', 'bundle exec rake db:migrate', 'bunx some-tool']
    expect(commands.filter(command => checkKindOf(command) !== null || !mutates(command))).toEqual([])
  })

  test('danh tính giữ nguyên tiền tố: pnpm exec tsc -p x chỉ khớp đúng lần chạy đó, không khớp tsc -p x', () => {
    expect(accepted(['pnpm exec tsc -p x'], 'pnpm exec tsc -p x: sạch')).toBe(true)
    expect(accepted(['pnpm exec tsc -p x'], 'tsc -p x: sạch')).toBe(false)
    expect(accepted(['tsc -p x'], 'pnpm exec tsc -p x: sạch')).toBe(false)
    expect(accepted(['uv run pytest tests/'], 'uv run pytest tests/: đạt')).toBe(true)
    expect(accepted(['uv run pytest tests/'], 'pytest tests/: đạt')).toBe(false)
    expect(accepted(['bundle exec rspec'], 'bundle exec rspec: đạt')).toBe(true)
    expect(accepted(['bundle exec rspec'], 'rspec: đạt')).toBe(false)
    expect(accepted(['./node_modules/.bin/jest'], './node_modules/.bin/jest: đạt')).toBe(true)
    expect(accepted(['poetry run pytest -q'], 'poetry run pytest -q: đạt')).toBe(true)
    expect(accepted(['bunx vitest run'], 'bunx vitest run: đạt')).toBe(true)
  })

  test('pnpm exec không tương đương pnpm run exec', () => {
    expect(accepted(['pnpm exec tsc -p x'], 'pnpm run exec tsc -p x: sạch')).toBe(false)
  })
})

describe('lệnh tự sửa là tác động ghi, không phải lệnh kiểm tra', () => {
  test('--fix, --write, --apply, *:fix, ruff format không --check, script format đều là ghi', () => {
    const commands = [
    'eslint --fix .',
    'npx eslint src --fix',
    'pnpm exec eslint --fix .',
    'npm run lint:fix',
    'pnpm run lint:fix',
    'yarn lint:fix',
    'npm run lint -- --fix',
    'ruff check --fix .',
    'ruff format .',
    'biome check --write .',
    'biome check --apply .',
    'biome format --write .',
    'cargo clippy --fix',
    'prettier --write .',
    'prettier -w .',
    'stylelint --fix "src/**/*.css"',
    'npm run format',
    'pnpm run format',
    'npm run fix',
    'biome check --apply-unsafe .',
    'ruff check --fix-only .',
    'eslint --fix=true .',
    'prettier --check -w .',
    'npm "run" lint:fix',
    ]
    expect(commands.filter(command => checkKindOf(command) !== null || !mutates(command))).toEqual([])
  })

  test('cờ chỉ xem trước hoặc nằm trong chuỗi có nháy không làm lệnh thành tự sửa', () => {
    const commands = ['eslint --fix-dry-run .', 'eslint .', "pytest -k '--fix'", 'pytest -k "--write"', 'ruff check .', 'biome check .']
    expect(commands.filter(command => checkKindOf(command) === null || mutates(command))).toEqual([])
  })

  test('lệnh tự sửa trong chuỗi && vẫn để lại lệnh kiểm tra đứng riêng', () => {
    const effects = classifyBash('eslint --fix . && tsc --noEmit').effects
    expect(effects.filter(e => e.kind === 'check').length).toBe(1)
    expect(effects.some(e => e.kind === 'write')).toBe(true)
  })

  test('chạy lệnh tự sửa rồi ghi evidence cùng lệnh đó: không nhận verified', () => {
    expect(accepted(['eslint --fix .'], 'eslint --fix .: sạch')).toBe(false)
    expect(accepted(['eslint --fix .', 'eslint .'], 'eslint .: sạch')).toBe(true)
  })
})

describe('cờ tự sửa đặt trong nháy', () => {
  test('cờ, giá trị cờ hay tên script đặt trong nháy vẫn là tự sửa: shell bỏ nháy trước khi chạy', () => {
    const commands = [
      'eslint --fix="true" .',
      'eslint "--fix" .',
      "eslint '--fix' .",
      'npm run "lint:fix"',
      'ruff "format" .',
      'yarn "lint:fix"',
      'eslint --max-warnings=0 "--fix" .',
      'eslint --quiet --fix="true" .',
      'npm run lint -- "--fix"',
      'eslint -- "--fix" .',
    ]
    expect(commands.filter(command => checkKindOf(command) !== null || !mutates(command))).toEqual([])
  })

  test('giá trị của tùy chọn đặt trong nháy là đối số, không phải cờ', () => {
    const commands = ["pytest -k '--fix'", 'pytest -k "--write"', 'pytest -k "not --fix" tests', 'eslint --fix-dry-run "src"', 'eslint "src" .']
    expect(commands.filter(command => checkKindOf(command) === null || mutates(command))).toEqual([])
  })

  test('giới hạn đã biết: sau tùy chọn không có dấu =, token trong nháy bị coi là giá trị của tùy chọn đó', () => {
    // `--quiet` không nhận giá trị nhưng mod không biết; `eslint --quiet "--fix" .` thực ra tự sửa, vẫn bị xếp là kiểm tra.
    expect(checkKindOf('eslint --quiet "--fix" .')).not.toBeNull()
  })
})

describe('checkCommands: lệnh kiểm tra riêng của dự án', () => {
  const reset = () => drift.applyCheckCommands([])

  test('đọc option: phân tách bằng dấu phẩy, mỗi lệnh tách theo khoảng trắng, mục rỗng bị bỏ', () => {
    expect(drift.parseCheckCommands('make ci, ./scripts/check.sh --strict ,, just verify')).toEqual([['make', 'ci'], ['./scripts/check.sh', '--strict'], ['just', 'verify']])
    expect(drift.parseCheckCommands(undefined)).toEqual([])
    expect(drift.parseCheckCommands('')).toEqual([])
    expect(drift.parseCheckCommands(42)).toEqual([])
  })

  test('lệnh khai là kiểm tra chạy hành vi; lệnh gần giống (make cinema) thì không', () => {
    drift.applyCheckCommands(drift.parseCheckCommands('make ci, ./scripts/check.sh'))
    try {
      expect(checkKindOf('make ci')).toBe('test')
      expect(checkKindOf('./scripts/check.sh')).toBe('test')
      expect(checkKindOf('./scripts/check.sh --fast')).toBe('test')
      expect(checkKindOf('make cinema')).toBeNull()
      expect(checkKindOf('make')).toBeNull()
      expect(mutates('make ci')).toBe(false)
      expect(mutates('make cinema')).toBe(true)
    } finally {
      reset()
    }
    expect(checkKindOf('make ci')).toBeNull()
  })

  test('danh tính nghiêm ngặt: evidence nhắc ./scripts/check.sh trần không khớp lần chạy có --fast', () => {
    drift.applyCheckCommands(drift.parseCheckCommands('./scripts/check.sh'))
    try {
      expect(accepted(['./scripts/check.sh --fast'], './scripts/check.sh --fast: đạt')).toBe(true)
      expect(accepted(['./scripts/check.sh --fast'], './scripts/check.sh: đạt')).toBe(false)
      // Nhắc lệnh khai mà chưa chạy: bị từ chối như mọi lệnh kiểm tra khác.
      expect(accepted([], './scripts/check.sh: đạt')).toBe(false)
    } finally {
      reset()
    }
  })

  test('lệnh khai mà kèm cờ tự sửa thì vẫn là ghi', () => {
    drift.applyCheckCommands(drift.parseCheckCommands('make ci'))
    try {
      expect(checkKindOf('make ci --fix')).toBeNull()
      expect(mutates('make ci --fix')).toBe(true)
    } finally {
      reset()
    }
  })

  test('lệnh khai là trình quản lý gói: script tự sửa (fix, format, fmt, lint:fix, run-script) vẫn là ghi, script kiểm tra thì giữ', () => {
    drift.applyCheckCommands(drift.parseCheckCommands('npm run, npm run-script, yarn, bun'))
    try {
      for (const command of ['npm run fix', 'npm run format', 'npm run fmt', 'npm run --silent format', 'npm run-script lint:fix', 'npm run-script format', 'yarn fix', 'yarn fmt', 'bun format']) {
        expect(checkKindOf(command), command).toBeNull()
        expect(mutates(command), command).toBe(true)
      }
      for (const command of ['npm run ci', 'npm run-script ci', 'yarn ci', 'bun ci']) {
        expect(checkKindOf(command), command).toBe('test')
        expect(mutates(command), command).toBe(false)
      }
    } finally {
      reset()
    }
  })

  test('so khớp lệnh khai không phân biệt hoa thường: khai Make CI thì make ci là lệnh kiểm tra', () => {
    drift.applyCheckCommands([['Make', 'CI']])
    try {
      expect(checkKindOf('make ci')).toBe('test')
      expect(checkKindOf('MAKE CI')).toBe('test')
      expect(checkKindOf('make cinema')).toBeNull()
    } finally {
      reset()
    }
  })

  test('lệnh khai rỗng không khớp lệnh nào', () => {
    drift.applyCheckCommands([[]])
    try {
      expect(checkKindOf('make ci')).toBeNull()
      expect(checkKindOf('rm -rf build')).toBeNull()
      expect(mutates('rm -rf build')).toBe(true)
    } finally {
      reset()
    }
  })

  test('createContext áp option checkCommands; thiếu thì xóa', () => {
    try {
      createContext({ checkCommands: 'just verify' })
      expect(checkKindOf('just verify')).toBe('test')
      createContext({})
      expect(checkKindOf('just verify')).toBeNull()
    } finally {
      reset()
    }
  })
})

describe('verified bị hạ: ghi vào log quyết định', () => {
  const PLAN = 'mcp__focus-conductor__plan'

  test('evidence không đủ mạnh: dòng verify-reject kèm bước, mức, lý do và đoạn đầu evidence', { options: { decisionLog: '/tmp/fc-verify.jsonl' } }, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    const writes: string[] = []
    on('fs.write', (_$, e) => {
      writes.push(e.text)
      return { value: undefined }
    })
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] })
    await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
    const downgraded = await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: 'npm test: 12 pass' })
    expect(String(downgraded.result)).toContain('[x] 1. Sửa')
    const lines = (writes[writes.length - 1] ?? '').trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    const reject = lines.find(line => line['kind'] === 'verify-reject')
    expect(reject).toMatchObject({ kind: 'verify-reject', step: 1, level: 'stale' })
    expect(String(reject?.['reason'])).toContain('npm test')
    expect(String(reject?.['evidence'])).toBe('npm test: 12 pass')
  })

  test('evidence đủ mạnh: không có dòng verify-reject', { options: { decisionLog: '/tmp/fc-verify2.jsonl' } }, async ($, on) => {
    base(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: '12 pass' }))
    const writes: string[] = []
    on('fs.write', (_$, e) => {
      writes.push(e.text)
      return { value: undefined }
    })
    await submit($, COMPLEX_PROMPT)
    await $.tool.call({ tool: PLAN, action: 'set', steps: [{ title: 'Sửa' }] })
    await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    const ok = await $.tool.call({ tool: PLAN, action: 'update', step: 1, status: 'verified', evidence: 'npm test: 12 pass' })
    expect(String(ok.result)).toContain('[v] 1. Sửa')
    expect(writes.join('\n')).not.toContain('verify-reject')
  })
})
