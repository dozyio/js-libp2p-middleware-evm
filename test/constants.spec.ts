/* eslint-env mocha */
import { expect } from 'aegir/chai'
import { MAX_INBOUND_STREAMS, MAX_OUTBOUND_STREAMS, TIMEOUT } from '../src/constants.js'

describe('Constants', () => {
  it('should export stream limits', () => {
    expect(MAX_INBOUND_STREAMS).to.be.a('number')
    expect(MAX_INBOUND_STREAMS).to.be.at.least(1)
    expect(MAX_OUTBOUND_STREAMS).to.be.a('number')
    expect(MAX_OUTBOUND_STREAMS).to.be.at.least(1)
  })

  it('should export timeout value', () => {
    expect(TIMEOUT).to.be.a('number')
    expect(TIMEOUT).to.be.at.least(1000) // At least 1 second
  })
})
