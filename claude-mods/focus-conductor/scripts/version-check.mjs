// So MOD_VERSION (hooks/lib/version.ts) với version của .claude-plugin/plugin.json (0.7.9 L1). Kit test của engine không nạp được tệp
// JSON hay node:fs, nên phép so này chạy bằng node ở CI và trước mỗi commit đổi phiên bản: node scripts/version-check.mjs
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
