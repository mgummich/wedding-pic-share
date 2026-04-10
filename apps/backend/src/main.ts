import { loadConfig } from './config.js'
import { buildApp } from './server.js'
import { seedAdmin } from './seed.js'

const config = loadConfig()
const app = await buildApp(config)

await seedAdmin(config)

try {
  await app.listen({ port: config.port, host: '0.0.0.0' })
  app.log.info(`Backend running on port ${config.port}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
