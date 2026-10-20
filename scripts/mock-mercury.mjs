// Local stand-in for the Inception chat-completions endpoint, for trying the diffusion dock
// without an API key. It streams a canned answer: complete-text denoising frames when the
// request sets `diffusing: true`, ordinary deltas otherwise. Not a model: it ignores tools.
//
//   node scripts/mock-mercury.mjs            # listens on 127.0.0.1:18931
//   MOCK_PORT=9000 MOCK_STEPS=40 MOCK_STEP_MS=60 node scripts/mock-mercury.mjs

import { createServer } from 'node:http'

const port = Number(process.env.MOCK_PORT ?? 18931)
const steps = Number(process.env.MOCK_STEPS ?? 28)
const stepMs = Number(process.env.MOCK_STEP_MS ?? 90)
const NOISE = 'abcdefghijklmnopqrstuvwxyz0123456789#$%&*+=?@~扩散去噪模型并行生成文本'

function answerFor(body) {
  const last = [...body.messages ?? []].reverse().find(message => message.role === 'user')
  const question = typeof last?.content === 'string' ? last.content.slice(0, 80) : ''
  return [
    `你问的是：「${question}」。`,
    '',
    '这是本地 mock 服务模拟的 Mercury 扩散生成：模型先给出整段带噪声的草稿，',
    '再在每一步并行修正所有位置，直到文本收敛为最终答案。',
    'Diffusion language models refine every token in parallel instead of writing left to right.',
  ].join('\n')
}

function chunk(res, delta, finish = null) {
  res.write(`data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'mercury-3', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`)
}

function finish(res, text) {
  chunk(res, { content: '' }, 'stop')
  const completion = Array.from(text).length
  res.write(`data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', created: 0, model: 'mercury-3', choices: [], usage: { prompt_tokens: 42, completion_tokens: completion, total_tokens: 42 + completion, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 0 } } })}\n\n`)
  res.end('data: [DONE]\n\n')
}

/** Frame k reveals each position once its fixed random threshold falls below k/steps. */
function frames(text) {
  const chars = Array.from(text)
  const thresholds = chars.map(char => (/\s/u.test(char) ? 0 : Math.random()))
  const noise = Array.from(NOISE)
  return Array.from({ length: steps }, (_, step) => {
    const progress = (step + 1) / steps
    return chars.map((char, i) => thresholds[i] < progress ? char : noise[Math.floor(Math.random() * noise.length)]).join('')
  })
}

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/v1/models') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'mercury-3', name: 'Inception: Mercury 3' }] }))
    return
  }
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    res.writeHead(404).end()
    return
  }
  let raw = ''
  req.on('data', part => { raw += part })
  req.on('end', () => {
    const body = JSON.parse(raw)
    console.log(`[mock-mercury] model=${body.model} diffusing=${body.diffusing === true} tools=${body.tools?.length ?? 0} messages=${body.messages?.length ?? 0}`)
    if (req.headers.authorization === undefined) {
      res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'Missing API key', type: 'authentication_error', code: 'invalid_api_key' } }))
      return
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    const text = answerFor(body)
    const queue = body.diffusing === true
      ? frames(text).map(frame => () => chunk(res, { content: frame }))
      : Array.from(text.matchAll(/.{1,6}/gsu), match => () => chunk(res, { content: match[0] }))
    chunk(res, { role: 'assistant', content: '' })
    const timer = setInterval(() => {
      const next = queue.shift()
      if (next !== undefined) return next()
      clearInterval(timer)
      finish(res, text)
    }, body.diffusing === true ? stepMs : 25)
    res.on('close', () => { clearInterval(timer) })
  })
})

server.listen(port, '127.0.0.1', () => { console.log(`[mock-mercury] listening on http://127.0.0.1:${port}/v1`) })
