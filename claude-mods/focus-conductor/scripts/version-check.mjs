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
