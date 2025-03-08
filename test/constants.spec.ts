/* eslint-env mocha */
import { expect } from 'aegir/chai'
import { CHALLENGE_RESPONSE_PROTOCOL, CHALLENGE_SIZE, MAX_INBOUND_STREAMS, MAX_OUTBOUND_STREAMS, PROTOCOL_NAME, PROTOCOL_PREFIX, PROTOCOL_VERSION, TIMEOUT } from '../src/constants.js'

describe('Constants', () => {
  it('should export correctly formed protocol string', () => {
    // Check the protocol string format
    expect(CHALLENGE_RESPONSE_PROTOCOL).to.equal(`/${PROTOCOL_PREFIX}/${PROTOCOL_NAME}/${PROTOCOL_VERSION}`)
    expect(CHALLENGE_RESPONSE_PROTOCOL).to.match(/^\/[a-z0-9-]+\/[a-z0-9-]+\/\d+\.\d+\.\d+$/)
  })

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

  it('should export challenge size', () => {
    expect(CHALLENGE_SIZE).to.be.a('number')
    expect(CHALLENGE_SIZE).to.be.at.least(16) // At least 16 bytes for security
  })
})
