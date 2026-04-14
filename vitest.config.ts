import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  oxc: {
    jsx: {
      runtime: 'automatic'
    }
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/__tests__/**/*.test.ts', 'src/**/__tests__/**/*.test.tsx'],
    setupFiles: ['src/test/setup.ts']
  },
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer'),
      '@': resolve('src/renderer')
    }
  }
})
