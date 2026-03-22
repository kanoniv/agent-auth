import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'kanoniv-auth',
  description: 'Sudo for AI agents. Replace API keys with cryptographic delegation.',
  head: [
    ['meta', { property: 'og:title', content: 'kanoniv-auth - Sudo for AI Agents' }],
    ['meta', { property: 'og:description', content: 'Replace API keys with cryptographic delegation. Scope-confined, time-bounded, auditable.' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
  ],
  themeConfig: {
    logo: '/favicon.svg',
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Reference', link: '/reference/python-api' },
      { text: 'GitHub', link: 'https://github.com/kanoniv/agent-auth' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting Started', link: '/guide/getting-started' },
          { text: 'How It Works', link: '/guide/how-it-works' },
          { text: 'Claude Code Skill', link: '/guide/claude-code-skill' },
          { text: 'GitHub Action', link: '/guide/github-action' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Python API', link: '/reference/python-api' },
          { text: 'CLI', link: '/reference/cli' },
          { text: 'Token Format', link: '/reference/token-format' },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/kanoniv/agent-auth' },
    ],
    footer: {
      message: 'MIT Licensed',
      copyright: 'Kanoniv',
    },
    search: {
      provider: 'local',
    },
  },
})
