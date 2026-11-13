// So MOD_VERSION (hooks/lib/version.ts) với version của .claude-plugin/plugin.json (0.7.9 L1), và kiểm mọi khóa option của plugin.json có
// một dòng trong bảng tùy chọn của README (0.8.5 K13). Kit test của engine không nạp được tệp JSON, Markdown hay node:fs, nên các phép kiểm
// này chạy bằng node ở CI và trước mỗi commit đổi phiên bản: node scripts/version-check.mjs
import { readFileSync } from 'node:fs'

const root = new URL('..', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('.claude-plugin/plugin.json', root), 'utf8'))
const source = readFileSync(new URL('hooks/lib/version.ts', root), 'utf8')
const constant = /export const MOD_VERSION = '([^']+)'/.exec(source)?.[1]
if (constant !== manifest.version) {
  console.error(`MOD_VERSION ${constant ?? '(không thấy)'} khác version ${manifest.version} của plugin.json`)
  process.exit(1)
}
console.log(`MOD_VERSION khớp plugin.json: ${constant}`)

const readme = readFileSync(new URL('README.md', root), 'utf8')
const rows = new Set([...readme.matchAll(/^\| `([A-Za-z]+)` \|/gm)].map(match => match[1]))
const keys = Object.keys(manifest.userConfig ?? {})
const missing = keys.filter(key => !rows.has(key))
if (missing.length > 0) {
  console.error(`Bảng tùy chọn của README thiếu ${missing.length} option: ${missing.join(', ')}`)
  process.exit(1)
}
console.log(`Bảng tùy chọn của README có đủ ${keys.length} option`)

// Chữ 'fable' trong hooks/ (0.8.7 G1): đếm theo tệp, so với tests/fixtures/fable-sites.ts. Test conductor-family-g1-087 so tệp đó với danh
// sách vị trí được phép (kèm lý do); kit test không đọc được tệp nguồn, nên phép đếm chạy ở đây. Ghi lại tệp sau khi sửa mã:
// node scripts/version-check.mjs --write-fable-sites
import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const hooksDir = fileURLToPath(new URL('hooks/', root))
const sites = {}
const walk = dir => {
  for (const name of readdirSync(dir).sort()) {
    const path = dir + name
    if (statSync(path).isDirectory()) walk(path + '/')
    else if (/\.tsx?$/.test(name)) {
      const count = (readFileSync(path, 'utf8').match(/'fable'/g) ?? []).length
      if (count > 0) sites[path.slice(hooksDir.length)] = count
    }
  }
}
walk(hooksDir)
const fixturePath = new URL('tests/fixtures/fable-sites.ts', root)
const fixtureText = `// Sinh bởi node scripts/version-check.mjs --write-fable-sites (0.8.7 G1): số lần chuỗi 'fable' xuất hiện trong từng tệp của hooks/.\nexport const FABLE_SITES: Record<string, number> = ${JSON.stringify(sites).replaceAll('"', "'").replaceAll(',', ', ').replaceAll(':', ': ')}\n`
if (process.argv.includes('--write-fable-sites')) writeFileSync(fixturePath, fixtureText)
let stored = ''
try {
  stored = readFileSync(fixturePath, 'utf8')
} catch {
  stored = ''
}
if (stored !== fixtureText) {
  console.error(`tests/fixtures/fable-sites.ts không khớp mã hiện tại (${JSON.stringify(sites)}); chạy node scripts/version-check.mjs --write-fable-sites`)
  process.exit(1)
}
console.log(`Chuỗi 'fable' trong hooks/: ${Object.entries(sites).map(([file, n]) => `${file} ${n}`).join(', ')}`)
