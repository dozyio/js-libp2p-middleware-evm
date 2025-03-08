export const PROTOCOL_PREFIX = 'mw'
export const PROTOCOL_NAME = 'evm'
export const PROTOCOL_VERSION = '0.0.1'

export const CHALLENGE_RESPONSE_PROTOCOL = `/${PROTOCOL_PREFIX}/${PROTOCOL_NAME}/${PROTOCOL_VERSION}`

export const MAX_INBOUND_STREAMS = 3
export const MAX_OUTBOUND_STREAMS = 3

// Default timeout for challenge response (in ms)
export const TIMEOUT = 10000

// Size of the random challenge in bytes
export const CHALLENGE_SIZE = 32
