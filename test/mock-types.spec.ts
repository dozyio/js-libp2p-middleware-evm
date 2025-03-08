/* eslint-env mocha */
import { expect } from 'aegir/chai'
import { getByteAt, ensureUint8Array } from '../src/mock-types.js'

describe('Mock Type Helpers', () => {
  describe('getByteAt', () => {
    it('should get value using at method if available', () => {
      const array = {
        at: (index: number) => index === 1 ? 42 : undefined
      }

      expect(getByteAt(array, 1)).to.equal(42)
      expect(getByteAt(array, 2)).to.equal(0) // Undefined becomes 0
    })

    it('should fallback to get method if at is not available', () => {
      const array = {
        get: (index: number) => index === 1 ? 42 : undefined
      }

      expect(getByteAt(array, 1)).to.equal(42)
      expect(getByteAt(array, 2)).to.equal(0) // Undefined becomes 0
    })

    it('should return 0 if neither method exists', () => {
      const array = {}
      expect(getByteAt(array, 1)).to.equal(0)
    })
  })

  describe('ensureUint8Array', () => {
    it('should return the input if it is already a Uint8Array', () => {
      const input = new Uint8Array([1, 2, 3])
      const result = ensureUint8Array(input)

      expect(result).to.equal(input)
      expect(result).to.deep.equal(new Uint8Array([1, 2, 3]))
    })

    it('should use subarray method if available', () => {
      const input = {
        subarray: () => new Uint8Array([4, 5, 6])
      }

      const result = ensureUint8Array(input)
      expect(result).to.deep.equal(new Uint8Array([4, 5, 6]))
    })

    it('should convert array to Uint8Array', () => {
      const input = [7, 8, 9]
      const result = ensureUint8Array(input)

      expect(result).to.deep.equal(new Uint8Array([7, 8, 9]))
    })

    it('should return empty Uint8Array for unsupported input', () => {
      const input = 'not an array'
      const result = ensureUint8Array(input)

      expect(result).to.deep.equal(new Uint8Array())
    })
  })
})
