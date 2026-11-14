// Dải màu neon của band và pane (0.8.8 N1). Tệp duy nhất của hooks/ được chứa mã màu thô: mọi tệp khác lấy màu qua đây
// (scripts/version-check.mjs kiểm). Ba option: neon (bảng màu của giai đoạn đang chạy, hay off), neonMotion (dải màu dịch theo nhịp),
// neonTheme (bảng nền tối hay nền sáng). neon off thì mọi màu là theme key như 0.8.7.
// Hàm thuần: không gọi $ và không dựng phần tử.

import type { Color } from 'claude-code'

import type { ModelFamily } from '../../types'
import type { Phase, Run } from './style'
import { graphemeCells, graphemesOf } from './cells'

export type NeonPalette = 'cyber' | 'aurora' | 'plasma' | 'off'
export type NeonMotion = 'on' | 'off'
export type NeonTheme = 'dark' | 'light'
/** Kiểu đã đọc từ ba option. `theme` là kết quả sau khi giải auto (engine không báo nền sáng hay tối nên auto là dark). */
export type NeonStyle = { palette: NeonPalette; motion: NeonMotion; theme: NeonTheme }

export const DEFAULT_NEON: NeonStyle = { palette: 'cyber', motion: 'on', theme: 'dark' }

/** Tên các dải màu: ba bảng của giai đoạn đang chạy, và năm dải theo trạng thái. */
export type GradientName = 'cyber' | 'aurora' | 'plasma' | 'start' | 'almost' | 'done' | 'warn' | 'pause'
/** Màu đơn: bốn họ model, chữ trên ô tô đặc, nền ô thường, đạt, cần chú ý, lỗi. */
export type SolidName = ModelFamily | 'onFill' | 'cell' | 'ok' | 'attention' | 'error'

/** Bảng nền tối [Nguồn: chủ mod, đặc tả 0.8.8, 14/11/2026]. */
export const DARK_GRADIENTS: Readonly<Record<GradientName, readonly string[]>> = {
  cyber: ['#00e5ff', '#7b61ff', '#ff2bd6'],
  aurora: ['#00ffa3', '#00c2ff', '#9d6bff'],
  plasma: ['#ff3cac', '#8a5cff', '#2b9bff'],
  start: ['#3d7bff', '#00e5ff'],
  almost: ['#ff2bd6', '#ff8a00', '#ffd23f'],
  done: ['#b6ff3c', '#00f5d4'],
  warn: ['#ffb300', '#ff2d75'],
  pause: ['#ffe600', '#ff8a00'],
}

export const DARK_SOLIDS: Readonly<Record<SolidName, string>> = {
  haiku: '#2ef2c5',
  sonnet: '#7aa2ff',
  opus: '#c77dff',
  fable: '#ff9d5c',
  onFill: '#07080d',
  cell: '#171a28',
  ok: '#5dff8f',
  attention: '#ffc233',
  error: '#ff4d7d',
}

/** Nền dùng để kiểm tương phản của bảng nền tối và bảng nền sáng. */
export const DARK_BACKGROUND = '#0a0b13'
export const LIGHT_BACKGROUND = '#ffffff'
/** Tương phản tối thiểu (WCAG 2, chữ thường) [Nguồn: WCAG 2.1, tiêu chí 1.4.3]. */
export const MIN_CONTRAST = 4.5
/** Chu kỳ của dải màu (ô): nửa đầu đi từ mốc đầu tới mốc cuối, nửa sau đi ngược lại, nên không có đường nối. */
export const CYCLE = 24

// ------------------------------------------------------------- màu thô

type Rgb = [number, number, number]

const HEX = /^#[0-9a-f]{6}$/

function rgbOf(hex: string): Rgb {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as Rgb
}

function hexOf(rgb: Rgb): string {
  return `#${rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`
}

/** Độ chói tương đối (WCAG 2). */
export function luminance(hex: string): number {
  const [r, g, b] = rgbOf(hex).map(v => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as Rgb
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Tỷ lệ tương phản của hai màu (WCAG 2), từ 1 tới 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

function hslOf([r, g, b]: Rgb): [number, number, number] {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255]
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === rr ? (gg - bb) / d + (gg < bb ? 6 : 0) : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4
  return [h / 6, s, l]
}

function rgbOfHsl([h, s, l]: [number, number, number]): Rgb {
  if (s === 0) return [l * 255, l * 255, l * 255]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hue = (t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t
    if (u < 1 / 6) return p + (q - p) * 6 * u
    if (u < 1 / 2) return q
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6
    return p
  }
  return [hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255]
}

/** Bản nền sáng của một màu: giảm L của HSL từng 1% cho tới khi tương phản với nền trắng đạt MIN_CONTRAST. */
export function lightOf(hex: string): string {
  const [h, s, l] = hslOf(rgbOf(hex))
  let out = hex
  for (let step = 0; contrast(out, LIGHT_BACKGROUND) < MIN_CONTRAST && step <= 100; step++) out = hexOf(rgbOfHsl([h, s, Math.max(0, l - step / 100)]))
  return out
}

/** Bảng nền sáng: cùng tên, mỗi mốc là lightOf của mốc nền tối. */
export const LIGHT_GRADIENTS: Readonly<Record<GradientName, readonly string[]>> = Object.fromEntries(
  Object.entries(DARK_GRADIENTS).map(([name, stops]) => [name, stops.map(lightOf)]),
) as Record<GradientName, readonly string[]>

const LIGHT_STOPS = Object.values(LIGHT_GRADIENTS).flat()

export const LIGHT_SOLIDS: Readonly<Record<SolidName, string>> = {
  haiku: lightOf(DARK_SOLIDS.haiku),
  sonnet: lightOf(DARK_SOLIDS.sonnet),
  opus: lightOf(DARK_SOLIDS.opus),
  fable: lightOf(DARK_SOLIDS.fable),
  // Chữ trên ô tô đặc của nền sáng: trắng nếu đạt tương phản với mọi mốc của mọi dải, không thì màu chữ của nền tối.
  onFill: LIGHT_STOPS.every(stop => contrast(LIGHT_BACKGROUND, stop) >= MIN_CONTRAST) ? LIGHT_BACKGROUND : DARK_SOLIDS.onFill,
  cell: '#e6e8f0',
  ok: lightOf(DARK_SOLIDS.ok),
  attention: lightOf(DARK_SOLIDS.attention),
  error: lightOf(DARK_SOLIDS.error),
}

export function isHexColor(value: unknown): boolean {
  return typeof value === 'string' && HEX.test(value)
}

// ---------------------------------------------------------------- option

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback

export function neonPaletteOf(value: unknown): NeonPalette {
  return pick(value, ['cyber', 'aurora', 'plasma', 'off'] as const, 'cyber')
}

export function neonMotionOf(value: unknown): NeonMotion {
  return pick(value, ['on', 'off'] as const, 'on')
}

/** auto (mặc định) theo giao diện engine báo; engine không báo (2.1.296 tới 2.1.325) nên auto là dark. */
export function neonThemeOf(value: unknown): NeonTheme {
  return pick(value, ['dark', 'light'] as const, 'dark')
}

export function neonStyleOf(options: Readonly<Record<string, unknown>>): NeonStyle {
  return { palette: neonPaletteOf(options['neon']), motion: neonMotionOf(options['neonMotion']), theme: neonThemeOf(options['neonTheme']) }
}

/** Màu chạy: dải màu dịch theo nhịp khi neon khác off và neonMotion là on. */
export function isMoving(style: NeonStyle): boolean {
  return style.palette !== 'off' && style.motion === 'on'
}

// ---------------------------------------------------------------- dải màu

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

/** Màu ở vị trí `position` của chu kỳ: phản chiếu quanh nửa chu kỳ, nội suy tuyến tính giữa các mốc. */
export function colorAt(stops: readonly string[], position: number): string {
  if (stops.length === 0) return ''
  if (stops.length === 1) return stops[0] as string
  const half = CYCLE / 2
  const t = ((position % CYCLE) + CYCLE) % CYCLE
  const u = t <= half ? t / half : (CYCLE - t) / half
  const scaled = u * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(scaled))
  return hexOf(mix(rgbOf(stops[i] as string), rgbOf(stops[i + 1] as string), scaled - i))
}

/**
 * Mỗi ô ký tự một màu theo dải `stops`: ô thứ i lấy màu ở vị trí (i + frame) mod 24, nên mỗi nhịp dải dịch sang trái một ô. Đếm ô theo
 * cụm ký tự (chữ có dấu, emoji không bị tách đôi; chữ rộng hai ô chiếm hai vị trí). Các ô liền nhau cùng màu gộp thành một Run.
 */
export function gradientRuns(text: string, stops: readonly string[], frame: number, extra: Omit<Run, 'text' | 'color'> = {}): Run[] {
  const runs: Run[] = []
  let cell = 0
  for (const g of graphemesOf(text.normalize('NFC'))) {
    const color = colorAt(stops, cell + frame)
    const last = runs.at(-1)
    if (last !== undefined && last.color === color) last.text += g
    else runs.push({ text: g, color, ...extra })
    cell += graphemeCells(g)
  }
  return runs
}

// ---------------------------------------------------------------- bộ màu

/** Màu theme key thay cho từng dải khi neon là off (như 0.8.7). */
const OFF_GRADIENT: Record<GradientName, Color> = {
  cyber: 'claude',
  aurora: 'claude',
  plasma: 'claude',
  start: 'ide',
  almost: 'warning',
  done: 'success',
  warn: 'error',
  pause: 'warning',
}

const OFF_SOLID: Record<SolidName, Color | undefined> = {
  haiku: 'planMode',
  sonnet: 'suggestion',
  opus: 'merged',
  fable: 'bashBorder',
  onFill: 'inverseText',
  cell: undefined,
  ok: 'success',
  attention: 'warning',
  error: 'error',
}

/** Dải đứng yên khi tạm dừng (0.8.8 N5). */
const STILL: ReadonlySet<GradientName> = new Set(['pause'])

/** Bộ màu đã giải theo kiểu neon: mọi tệp vẽ lấy màu qua đây. */
export type Paint = {
  style: NeonStyle
  frame: number
  /** Có mã màu thô hay không (neon khác off). */
  isNeon: boolean
  /** Chữ tô theo dải, bắt đầu ở ô `offset` của dải; neon off thì một Run màu theme key. */
  text: (name: GradientName, text: string, extra?: Omit<Run, 'text' | 'color'>, offset?: number) => Run[]
  /** Ô tô đặc: nền theo dải, chữ màu onFill. */
  fill: (name: GradientName, text: string, extra?: Omit<Run, 'text' | 'color'>, offset?: number) => Run[]
  solid: (name: SolidName) => Color | undefined
  /** Dải màu của một giai đoạn: start, bảng của option neon, almost, done; idle là null (dùng inactive). */
  phase: (phase: Phase) => GradientName | null
}

/** Bộ màu theme key (neon off), mặc định của các hàm dựng thanh khi nơi gọi không truyền bộ màu. */
export const OFF_STYLE: NeonStyle = { palette: 'off', motion: 'off', theme: 'dark' }

export function paintOf(style: NeonStyle = DEFAULT_NEON, frame = 0): Paint {
  const isNeon = style.palette !== 'off'
  const gradients = style.theme === 'light' ? LIGHT_GRADIENTS : DARK_GRADIENTS
  const solids = style.theme === 'light' ? LIGHT_SOLIDS : DARK_SOLIDS
  const shift = isMoving(style) ? frame : 0
  const at = (name: GradientName) => (STILL.has(name) ? 0 : shift)
  const solid = (name: SolidName): Color | undefined => (isNeon ? solids[name] : OFF_SOLID[name])
  return {
    style,
    frame: shift,
    isNeon,
    text: (name, text, extra = {}, offset = 0) => (text === '' ? [] : isNeon ? gradientRuns(text, gradients[name], at(name) + offset, extra) : [{ text, color: OFF_GRADIENT[name], ...extra }]),
    fill: (name, text, extra = {}, offset = 0) =>
      text === ''
        ? []
        : isNeon
          ? gradientRuns(text, gradients[name], at(name) + offset).map(run => ({ ...extra, text: run.text, color: solids.onFill, bg: run.color }))
          : [{ ...extra, text, color: OFF_SOLID.onFill as Color, bg: OFF_GRADIENT[name] }],
    solid,
    phase: phase => (phase === 'idle' ? null : phase === 'active' ? (isNeon ? (style.palette as GradientName) : 'cyber') : phase),
  }
}
