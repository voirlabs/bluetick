import { describe, expect, it } from 'vitest'
import { customerLimits, isOverLimit } from './customer-limit'

describe('customerLimits', () => {
  it('defaults to 20 per 10 minutes and 150 a day, and reads the env', () => {
    expect(customerLimits({})).toEqual({ per10Minutes: 20, perDay: 150 })
    expect(
      customerLimits({ CUSTOMER_MESSAGES_PER_10_MIN: '5', CUSTOMER_MESSAGES_PER_DAY: '0' })
    ).toEqual({ per10Minutes: 5, perDay: 0 })
    expect(customerLimits({ CUSTOMER_MESSAGES_PER_10_MIN: 'lots' }).per10Minutes).toBe(20)
  })
})

describe('isOverLimit', () => {
  const limits = { per10Minutes: 20, perDay: 150 }
  it('allows up to the limit, counting the current message', () => {
    expect(isOverLimit({ last10Minutes: 20, lastDay: 150 }, limits)).toBe(false)
    expect(isOverLimit({ last10Minutes: 21, lastDay: 21 }, limits)).toBe(true)
    expect(isOverLimit({ last10Minutes: 3, lastDay: 151 }, limits)).toBe(true)
  })
  it('treats 0 as no limit', () => {
    expect(isOverLimit({ last10Minutes: 999, lastDay: 999 }, { per10Minutes: 0, perDay: 0 })).toBe(false)
  })
})
