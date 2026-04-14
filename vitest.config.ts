import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/__tests__/**/*.test.ts', 'src/**/__tests__/**/*.test.tsx']
  },
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer'),
      '@': resolve('src/renderer')
    }
  }
})
