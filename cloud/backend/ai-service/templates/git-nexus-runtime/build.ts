import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'
import { Template, defaultBuildLogger } from 'e2b'
import { template } from './template'

// Load .env from current directory or parent ai-service folder if present
const candidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '..', '.env'),
  path.resolve(process.cwd(), '..', '..', '.env'),
]
for (const p of candidates) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p })
    break
  }
}

async function main() {
  await Template.build(template, 'gitnexus-runtime', {
    cpuCount: 2,
    memoryMB: 4096,
    onBuildLogs: defaultBuildLogger(),
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
