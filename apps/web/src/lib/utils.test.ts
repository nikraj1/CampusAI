import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import { cx, fmtBytes } from '../components/ui'

describe('core web utilities', () => {
  it('cx joins truthy class names cleanly', () => {
    expect(cx('a', false, null, undefined, 'b', 'c')).toBe('a b c')
    expect(cx(false, null)).toBe('')
  })

  it('fmtBytes formats B, KB, and MB accurately', () => {
    expect(fmtBytes(512)).toBe('512 B')
    expect(fmtBytes(2048)).toBe('2 KB')
    expect(fmtBytes(2.5 * 1024 * 1024)).toBe('2.5 MB')
  })

  it('ApiError preserves status, code, message, and retryable flag', () => {
    const err = new ApiError(429, 'RATE_LIMITED', 'Slow down', true)
    expect(err).toBeInstanceOf(Error)
    expect(err.status).toBe(429)
    expect(err.code).toBe('RATE_LIMITED')
    expect(err.message).toBe('Slow down')
    expect(err.retryable).toBe(true)
  })
})
