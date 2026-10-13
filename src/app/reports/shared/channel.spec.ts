import { describe, expect, it } from 'vitest'
import { MovementChannel } from 'mintly-lib'
import { effectiveChannel } from './channel'

describe('effectiveChannel', () => {
  it('canal informado vence', () => expect(effectiveChannel({ direction: 'out', account: { type: 'cash' }, channel: MovementChannel.Delivery })).toBe('delivery'))
  it('entrada em plataforma → delivery', () => expect(effectiveChannel({ direction: 'in', account: { type: 'platform' } })).toBe('delivery'))
  it('outra entrada → dineIn', () => expect(effectiveChannel({ direction: 'in', account: { type: 'cash' }, channel: null })).toBe('dineIn'))
  it('saída → shared', () => expect(effectiveChannel({ direction: 'out', account: { type: 'platform' } })).toBe('shared'))
})
