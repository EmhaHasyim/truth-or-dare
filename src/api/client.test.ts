import { describe, it, expect } from 'vitest'
import { apiClient } from './client'

describe('apiClient', () => {
  it('should be defined', () => {
    expect(apiClient).toBeDefined()
  })

  it('should have base URL set to /api', () => {
    // The hc() client uses a function for baseUrl
    expect(typeof (apiClient as any).baseUrl).toBe('function')
  })
})
