const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: '*.spec.js',
  timeout: 30000,
  workers: 1,
  use: { browserName: 'chromium', screenshot: 'only-on-failure' },
  projects: ['socketio', 'native'].flatMap((transport) => [
    { name: `${transport}-desktop`, use: { viewport: { width: 1366, height: 768 } } },
    { name: `${transport}-mobile`, use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: `${transport}-small`, use: { viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true } },
    { name: `${transport}-landscape`, use: { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true } },
  ].map((project) => ({ ...project, use: { ...project.use, baseURL: `http://localhost:${transport === 'native' ? 3411 : 3410}` } }))),
  webServer: [
    { command: 'node server.js', env: { PORT: '3410' }, url: 'http://localhost:3410', reuseExistingServer: false },
    { command: 'node server.js --nativo', env: { PORT: '3411' }, url: 'http://localhost:3411', reuseExistingServer: false },
  ],
});