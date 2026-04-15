import { defineConfig } from 'vitepress'

function resolveBasePath(): string {
  if (process.env.GITHUB_ACTIONS !== 'true') {
    return '/'
  }

  const repository = process.env.GITHUB_REPOSITORY ?? ''
  const repoName = repository.split('/')[1]
  if (!repoName || repoName.endsWith('.github.io')) {
    return '/'
  }

  return `/${repoName}/`
}

export default defineConfig({
  title: 'Wedding Pic Share Docs',
  description: 'Documentation for backend, frontend, deployment, and operations.',
  lang: 'en-US',
  srcDir: '.',
  base: resolveBasePath(),
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Deployment', link: '/deployment' },
      { text: 'Runbook', link: '/runbook' },
      { text: 'Architecture', link: '/architecture-decisions' },
      { text: 'API', link: '/api/' },
    ],
    sidebar: [
      {
        text: 'Documentation',
        items: [
          { text: 'Overview', link: '/' },
          { text: 'Deployment', link: '/deployment' },
          { text: 'Runbook', link: '/runbook' },
          { text: 'Architecture Decisions', link: '/architecture-decisions' },
        ],
      },
      {
        text: 'API',
        items: [
          { text: 'API Overview', link: '/api/' },
          { text: 'OpenAPI Spec', link: '/api/openapi' },
        ],
      },
    ],
    search: {
      provider: 'local',
    },
    footer: {
      message: 'Wedding Pic Share',
      copyright: 'Copyright © Wedding Pic Share',
    },
  },
})
