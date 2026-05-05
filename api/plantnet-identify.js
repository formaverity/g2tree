// Vercel serverless function — proxies Pl@ntNet requests server-side.
// Keeps the API key off the browser and resolves Pl@ntNet's CORS restriction.
//
// Local dev: run `vercel dev` (not `npm run dev`) to serve both the Vite
// frontend and this function together. Install the CLI with:
//   npm install -g vercel
//   vercel dev
//
// Set PLANTNET_API_KEY in .env.local for local use, or in the Vercel project
// dashboard for production. Never prefix it with VITE_ — that would expose it.

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export const config = {
  api: { bodyParser: false },
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.PLANTNET_API_KEY
  if (!apiKey) {
    return res.status(503).json({
      error: 'PLANTNET_API_KEY is not configured. Set it in .env.local or your Vercel project environment variables.',
    })
  }

  const contentType = req.headers['content-type'] ?? ''
  if (!contentType.includes('multipart/form-data')) {
    return res.status(400).json({ error: 'Expected multipart/form-data' })
  }

  let body
  try {
    body = await readBody(req)
  } catch (err) {
    return res.status(400).json({ error: `Failed to read request body: ${err.message}` })
  }

  if (body.length === 0) {
    return res.status(400).json({ error: 'Empty request body' })
  }

  const url =
    `https://my-api.plantnet.org/v2/identify/all` +
    `?api-key=${encodeURIComponent(apiKey)}&include-related-images=false&nb-results=5`

  let plantnetRes
  try {
    plantnetRes = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body,
    })
  } catch (err) {
    return res.status(502).json({ error: `Failed to reach Pl@ntNet: ${err.message}` })
  }

  const data = await plantnetRes.json().catch(() => ({}))
  return res.status(plantnetRes.status).json(data)
}
