import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Unmount rendered components after every test so DOM from one test never leaks into the next.
afterEach(() => {
  cleanup()
})
