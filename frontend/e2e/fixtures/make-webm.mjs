// One-off generator for e2e/fixtures/clip.webm: records 1.5 s of canvas animation
// in Chrome. Kept so the fixture can be reproduced; the committed file is what tests use.
import { writeFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage()
await page.goto('about:blank')
const base64 = await page.evaluate(async () => {
  const c = document.createElement('canvas')
  c.width = 640
  c.height = 360
  const g = c.getContext('2d')
  const rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm;codecs=vp8' })
  const chunks = []
  rec.ondataavailable = (e) => chunks.push(e.data)
  let t = 0
  const draw = () => {
    const sky = g.createLinearGradient(0, 0, 0, 360)
    sky.addColorStop(0, `hsl(${(200 + t) % 360},55%,35%)`)
    sky.addColorStop(1, `hsl(${(30 + t) % 360},70%,60%)`)
    g.fillStyle = sky
    g.fillRect(0, 0, 640, 360)
    g.fillStyle = '#1d2b24'
    g.beginPath()
    g.moveTo(0, 360)
    for (let x = 0; x <= 640; x += 40) g.lineTo(x, 250 + Math.sin(x / 90 + t / 20) * 30)
    g.lineTo(640, 360)
    g.fill()
    g.fillStyle = '#f3efe8'
    g.beginPath()
    g.arc(120 + t * 8, 90, 28, 0, 7)
    g.fill()
    t++
  }
  draw()
  rec.start(100)
  const timer = setInterval(draw, 33)
  await new Promise((r) => setTimeout(r, 1500))
  clearInterval(timer)
  const stopped = new Promise((r) => (rec.onstop = r))
  rec.stop()
  await Promise.race([
    stopped,
    new Promise((_, rej) => setTimeout(() => rej(new Error('recorder did not stop')), 5000)),
  ])
  const blob = new Blob(chunks, { type: 'video/webm' })
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
})
await browser.close()
const buf = Buffer.from(base64, 'base64')
if (buf.length < 2000) throw new Error('fixture too small: ' + buf.length)
writeFileSync(new URL('./clip.webm', import.meta.url), buf)
process.stdout.write(`wrote clip.webm (${buf.length} bytes)\n`)
