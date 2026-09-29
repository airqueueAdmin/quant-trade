import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const APP_BASE_URL = process.env.PORTFOLIO_CAPTURE_BASE_URL ?? 'http://127.0.0.1:4173'
const CDP_BASE_URL = process.env.PORTFOLIO_CAPTURE_CDP_URL ?? 'http://127.0.0.1:9225'
const VIEWPORT = { width: 430, height: 932, deviceScaleFactor: 2 }
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const outputDirectory = path.resolve(scriptDirectory, '..', 'assets', 'portfolio')

class CdpClient {
  constructor(socket) {
    this.socket = socket
    this.nextId = 1
    this.pending = new Map()

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (!message.id) {
        return
      }

      const request = this.pending.get(message.id)
      if (!request) {
        return
      }

      this.pending.delete(message.id)
      if (message.error) {
        request.reject(new Error(`${request.method}: ${message.error.message}`))
      } else {
        request.resolve(message.result)
      }
    })
  }

  send(method, params = {}) {
    const id = this.nextId
    this.nextId += 1

    return new Promise((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function connectToPage() {
  const targets = await fetch(`${CDP_BASE_URL}/json/list`).then((response) => response.json())
  const pageTarget = targets.find((target) => target.type === 'page')
  if (!pageTarget?.webSocketDebuggerUrl) {
    throw new Error('Chrome DevTools page target을 찾지 못했습니다.')
  }

  const socket = new WebSocket(pageTarget.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  return new CdpClient(socket)
}

async function evaluate(client, expression) {
  const response = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text ?? '브라우저 스크립트 실행에 실패했습니다.')
  }
  return response.result.value
}

async function waitFor(client, expression, description, timeoutMilliseconds = 45_000) {
  const deadline = Date.now() + timeoutMilliseconds
  while (Date.now() < deadline) {
    if (await evaluate(client, expression)) {
      return
    }
    await delay(250)
  }
  throw new Error(`${description} 대기 시간이 초과됐습니다.`)
}

async function preparePage(client, pathname) {
  await client.send('Page.navigate', { url: `${APP_BASE_URL}${pathname}` })
  await waitFor(client, "document.readyState === 'complete'", `${pathname} 문서 로드`)
  await waitFor(client, "Boolean(document.querySelector('main.page-shell'))", `${pathname} React 화면 렌더링`)
  await evaluate(client, `
    (async () => {
      if (document.fonts?.ready) {
        await document.fonts.ready
      }
      const style = document.createElement('style')
      style.dataset.portfolioCapture = 'true'
      style.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }'
      document.head.appendChild(style)
      window.scrollTo(0, 0)
      return true
    })()
  `)
}

async function capture(client, filename) {
  await evaluate(client, 'window.scrollTo(0, 0); true')
  await delay(500)
  const screenshot = await client.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  })
  const targetPath = path.join(outputDirectory, filename)
  await writeFile(targetPath, Buffer.from(screenshot.data, 'base64'))
  return targetPath
}

async function captureHome(client) {
  await preparePage(client, '/')
  await waitFor(client, "Boolean(document.querySelector('.daily-routine'))", '홈 루틴 카드')
  await delay(2_000)
  return capture(client, '01-home-mobile.png')
}

async function capturePaperTrading(client) {
  await preparePage(client, '/paper-trading')
  await waitFor(
    client,
    `(() => {
      const value = document.querySelector('.paper-account-card__assets')?.textContent?.trim()
      return Boolean(value && value !== '-') && !document.body.textContent.includes('모의투자 상태를 불러오는 중입니다')
    })()`,
    '모의투자 계좌 상태',
  )
  await delay(2_000)
  return capture(client, '02-paper-trading-mobile.png')
}

async function captureMarketAnalysis(client) {
  await preparePage(client, '/sector-flow')
  const selected = await evaluate(client, `(() => {
    const button = [...document.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.trim() === '국내주식')
    button?.click()
    return Boolean(button)
  })()`)
  if (!selected) {
    throw new Error('시장 분석의 국내주식 버튼을 찾지 못했습니다.')
  }

  await waitFor(
    client,
    "Boolean(document.querySelector('.summary-card')) && !Boolean(document.querySelector('.state-box--error'))",
    '국내주식 섹터 분석 결과',
    60_000,
  )
  await delay(1_000)
  return capture(client, '03-market-analysis-mobile.png')
}

async function main() {
  await mkdir(outputDirectory, { recursive: true })
  const client = await connectToPage()

  await client.send('Page.enable')
  await client.send('Runtime.enable')
  await client.send('Network.enable')
  await client.send('Emulation.setDeviceMetricsOverride', {
    ...VIEWPORT,
    mobile: true,
    screenWidth: VIEWPORT.width,
    screenHeight: VIEWPORT.height,
  })
  await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await client.send('Network.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 Chrome/136.0.0.0 Mobile Safari/537.36',
    platform: 'Android',
  })

  const screenshots = []
  screenshots.push(await captureHome(client))
  screenshots.push(await capturePaperTrading(client))
  screenshots.push(await captureMarketAnalysis(client))

  for (const screenshot of screenshots) {
    console.log(path.relative(process.cwd(), screenshot))
  }

  await client.send('Browser.close')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
