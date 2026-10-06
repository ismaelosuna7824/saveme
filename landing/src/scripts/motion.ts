/**
 * Las animaciones de la landing. Todo es opcional: el `<head>` solo pone la
 * clase `motion` en `<html>` si hay JavaScript y nadie pidió menos movimiento,
 * y el CSS solo esconde o anima algo bajo esa clase. Sin ella, la página es la
 * de siempre, entera y quieta.
 *
 * Si este módulo no llega a cargar, el `<head>` quita `motion` a los pocos
 * segundos: sin ese seguro, lo que espera a animarse se quedaría invisible.
 */
const root = document.documentElement

export function setupMotion(): void {
  if (!root.classList.contains('motion')) return
  root.classList.add('motion-run')
  setupKickers()
  setupReveal()
  setupLoops()
  void typeTerminal()
}

/**
 * Lo marcado con `data-reveal` entra al aparecer en pantalla. Se observa una
 * sola vez: lo que ya se vio no vuelve a esconderse al subir.
 */
function setupReveal(): void {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.classList.add('is-visible')
        observer.unobserve(entry.target)
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
  )
  for (const el of document.querySelectorAll('[data-reveal]')) observer.observe(el)
}

/**
 * Lo marcado con `data-loop` solo se mueve mientras se ve: una animación
 * infinita fuera de pantalla es CPU tirada.
 */
function setupLoops(): void {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) entry.target.classList.toggle('in-view', entry.isIntersecting)
  })
  for (const el of document.querySelectorAll('[data-loop]')) observer.observe(el)
}

/** Los `// kicker` se escriben letra a letra: el CSS necesita saber cuántas hay. */
function setupKickers(): void {
  for (const kicker of document.querySelectorAll<HTMLElement>('.kicker')) {
    // +3 por el `// ` que pone el CSS delante.
    kicker.style.setProperty('--chars', String((kicker.textContent ?? '').trim().length + 3))
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * La terminal del hero escribe su sesión: los comandos letra a letra, con un
 * ritmo irregular como el de una persona, y la salida línea a línea. Las líneas
 * esperan con `visibility: hidden`, que conserva su sitio: la terminal no cambia
 * de alto mientras se escribe.
 */
async function typeTerminal(): Promise<void> {
  const terminal = document.querySelector<HTMLElement>('[data-terminal]')
  const caret = terminal?.querySelector<HTMLElement>('.caret')
  if (!terminal || !caret) return
  const lines = [...terminal.querySelectorAll<HTMLElement>('.tl')]

  await sleep(650)
  terminal.classList.add('typing')
  for (const line of lines) {
    const typed = line.querySelector<HTMLElement>('[data-type]')
    if (!typed) {
      line.classList.add('on')
      // La última línea es el prompt vacío: ahí se queda el cursor.
      if (line === lines.at(-1)) line.append(caret)
      await sleep(55)
      continue
    }
    const text = typed.textContent ?? ''
    typed.textContent = ''
    typed.after(caret)
    line.classList.add('on')
    await sleep(220)
    for (const char of text) {
      typed.textContent += char
      await sleep(char === ' ' ? 70 : 28 + Math.random() * 38)
    }
    await sleep(320)
  }
  terminal.classList.remove('typing')
}
