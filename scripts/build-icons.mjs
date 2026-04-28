/**
 * Build app icons from logo designs/Picture4.svg.
 *
 * Outputs:
 *   build/icon.png   — 1024×1024 master PNG (Linux / macOS source)
 *   build/icon.ico   — multi-size Windows ICO (16, 32, 48, 64, 128, 256 px)
 *
 * Run with: node scripts/build-icons.mjs
 */

import sharp from 'sharp'
import pngToIco from 'png-to-ico'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root      = join(__dirname, '..')
const svgPath   = join(root, 'logo designs', 'Picture4.svg')
const buildDir  = join(root, 'build')

mkdirSync(buildDir, { recursive: true })

const svgBuffer = readFileSync(svgPath)

// Render the SVG onto a transparent square canvas, letterboxed with 8% padding.
const MASTER = 1024
const padding = Math.round(MASTER * 0.08)
const inner   = MASTER - padding * 2

console.log('Rendering SVG → 1024×1024 master PNG…')
const masterPng = await sharp(svgBuffer)
  .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .extend({ top: padding, bottom: padding, left: padding, right: padding,
             background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer()

writeFileSync(join(buildDir, 'icon.png'), masterPng)
console.log('  ✓ build/icon.png')

// Generate each ICO frame from the master PNG (sharp resize is faster than re-rendering SVG).
const icoSizes = [16, 32, 48, 64, 128, 256]
console.log(`Generating ICO frames (${icoSizes.join(', ')} px)…`)
const frames = await Promise.all(
  icoSizes.map(size =>
    sharp(masterPng)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer()
  )
)

const icoBuffer = await pngToIco(frames)
writeFileSync(join(buildDir, 'icon.ico'), icoBuffer)
console.log('  ✓ build/icon.ico')
console.log('Done.')
