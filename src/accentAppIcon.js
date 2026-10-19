// The app's own icon (Windows taskbar / Linux window, macOS Dock, tray) gets
// the theme's accent colour on its sticker, like the sidebar logo. Drawn here
// and handed to the desktop app; the installed icon itself stays yellow.

const SIZE = 256
let lastAccent = null
let timer = null

const loadImage = src => new Promise((resolve, reject) => {
  const image = new Image()
  image.onload = () => resolve(image)
  image.onerror = reject
  image.src = src
})

async function draw(accent) {
  const [logo, sticker] = await Promise.all([loadImage('lokal-icon.png'), loadImage('lokal-icon-sticker.png')])
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = SIZE
  const ctx = canvas.getContext('2d')
  // The sticker's shape filled with the accent...
  ctx.fillStyle = accent
  ctx.fillRect(0, 0, SIZE, SIZE)
  ctx.globalCompositeOperation = 'destination-in'
  ctx.drawImage(sticker, 0, 0, SIZE, SIZE)
  // ...over the logo.
  ctx.globalCompositeOperation = 'destination-over'
  ctx.drawImage(logo, 0, 0, SIZE, SIZE)
  return canvas.toDataURL('image/png')
}

export function syncAccentAppIcon(accent) {
  if (!window.electron?.setAccentIcon || !accent || accent === lastAccent) return
  lastAccent = accent
  clearTimeout(timer)
  // Clicking through accents redraws once, for the last one.
  timer = setTimeout(() => {
    draw(accent).then(dataUrl => { if (accent === lastAccent) window.electron.setAccentIcon(dataUrl) }).catch(() => {})
  }, 300)
}
