import { buildApp } from './server.js'

const app = await buildApp()

try {
  await app.listen({
    port: Number(process.env.PORT ?? 4000),
    host: '0.0.0.0',
  })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
