import { lpStream } from 'it-length-prefixed-stream'
import { fromString } from 'uint8arrays/from-string'
import { toString } from 'uint8arrays/to-string'
import { CHALLENGE_RESPONSE_PROTOCOL, CHALLENGE_SIZE, MAX_INBOUND_STREAMS, MAX_OUTBOUND_STREAMS, PROTOCOL_NAME, PROTOCOL_PREFIX, PROTOCOL_VERSION, TIMEOUT } from './constants.js'
import type { MiddlewareChallengeResponseComponents, MiddlewareChallengeResponseInit } from './index.js'
import type { AbortOptions, Connection, Logger, Startable, Stream } from '@libp2p/interface'
import type { Middleware } from 'libp2p-middleware-registrar'

export class MiddlewareChallengeResponse implements Middleware, Startable {
  public readonly protocol: string
  private readonly components: MiddlewareChallengeResponseComponents
  private started: boolean
  public readonly timeout: number
  private readonly maxInboundStreams: number
  private readonly maxOutboundStreams: number
  private readonly runOnLimitedConnection: boolean
  private readonly log: Logger
  private readonly decoratedConnections: Set<string>

  constructor (components: MiddlewareChallengeResponseComponents, init: MiddlewareChallengeResponseInit = {}) {
    this.components = components
    this.log = components.logger.forComponent('libp2p:middleware-challenge-response')
    this.started = false
    this.protocol = `/${init.protocolPrefix ?? PROTOCOL_PREFIX}/${PROTOCOL_NAME}/${PROTOCOL_VERSION}`
    this.timeout = init.timeout ?? TIMEOUT
    this.maxInboundStreams = init.maxInboundStreams ?? MAX_INBOUND_STREAMS
    this.maxOutboundStreams = init.maxOutboundStreams ?? MAX_OUTBOUND_STREAMS
    this.runOnLimitedConnection = init.runOnLimitedConnection ?? true

    this.decoratedConnections = new Set<string>()
    this.handle = this.handle.bind(this)
  }

  readonly [Symbol.toStringTag] = '@libp2p/middleware-challenge-response'

  async start (): Promise<void> {
    if (this.started) return

    // Check if the protocol is already registered before trying to register it
    try {
      // Try to get existing handler first
      this.components.registrar.getHandler(CHALLENGE_RESPONSE_PROTOCOL)
      // If we get here, the protocol is already registered
      this.log(`Protocol ${CHALLENGE_RESPONSE_PROTOCOL} already registered, skipping`)
    } catch (err: any) {
      // handle registering protocol
      if (err.name === 'UnhandledProtocolError') {
        await this.components.registrar.handle(CHALLENGE_RESPONSE_PROTOCOL, this.handle, {
          maxInboundStreams: this.maxInboundStreams,
          maxOutboundStreams: this.maxOutboundStreams,
          runOnLimitedConnection: this.runOnLimitedConnection
        })
        this.log(`Registered handler for ${CHALLENGE_RESPONSE_PROTOCOL}`)
      } else {
        throw err
      }
    }

    this.log(`Started challenge-response middleware with protocol ${CHALLENGE_RESPONSE_PROTOCOL}`)
    this.started = true
  }

  async stop (): Promise<void> {
    if (!this.started) return

    // Unregister the protocol handler
    try {
      // Make sure the protocol is registered before trying to unregister it
      this.components.registrar.getHandler(CHALLENGE_RESPONSE_PROTOCOL)
      await this.components.registrar.unhandle(CHALLENGE_RESPONSE_PROTOCOL)
      this.log(`Unregistered handler for ${CHALLENGE_RESPONSE_PROTOCOL}`)
    } catch (err: any) {
      // If it's an UnhandledProtocolError, the protocol is already unregistered
      if (err.name === 'UnhandledProtocolError') {
        this.log(`Protocol ${CHALLENGE_RESPONSE_PROTOCOL} already unregistered, skipping`)
      } else {
        // Unexpected error, log but don't throw (allow cleanup to continue)
        this.log.error(`Error unregistering protocol ${CHALLENGE_RESPONSE_PROTOCOL}: ${err.message}`)
      }
    }

    this.decoratedConnections.clear()
    this.started = false

    this.log('Stopped middleware')
  }

  isStarted (): boolean {
    return this.started
  }

  isDecorated (connectionId: string): boolean {
    if (!this.started) return false

    return this.decoratedConnections.has(connectionId)
  }

  // Handle inbound challenge-response requests from clients
  handle ({ stream, connection }: { stream: Stream, connection: Connection }): void {
    this.log('Received middleware connection request', connection.id, connection.remotePeer.toString())

    Promise.resolve().then(async () => {
    // Generate a random challenge to send to the client
      const challenge = this.generateRandomString(CHALLENGE_SIZE)
      this.log(`Generated challenge: [${challenge}] (length: ${challenge.length})`)

      // Calculate the expected response we should receive (SHA-256 hash of challenge)
      const expectedResponse = await this.calculateSha256(challenge)
      this.log(`Expected response hash: ${expectedResponse}`)

      const lp = lpStream(stream)

      try {
        this.log('Sending challenge to client')
        await lp.write(new TextEncoder().encode(challenge), { signal: AbortSignal.timeout(this.timeout) })
        this.log('Challenge sent successfully to client')
      } catch (err: any) {
        this.log('Error sending challenge to client:', err.message)
        stream.abort(new Error('Error sending challenge to client'))
        return
      }

      try {
        this.log('Reading response to challenge')
        const res = await lp.read({ signal: AbortSignal.timeout(this.timeout) })
        this.log('Read response', res)

        if (new TextDecoder().decode(res.slice()) !== expectedResponse) {
          this.log('Response does not match expected:', res, expectedResponse)
          stream.abort(new Error('error response does not match expected'))
          return
        }
      } catch (err: any) {
        this.log('Error reading response:', err.message)
        stream.abort(new Error('Error reading response'))
        return
      }

      try {
        this.decoratedConnections.add(connection.id)
        this.log(`Connection ${connection.id} middleware negotiated 
successfully, sending OK`)
        await lp.write(new TextEncoder().encode('OK'), { signal: AbortSignal.timeout(this.timeout) })
        this.log('Sent ok to client')
        this.log('closing stream')
        await stream.close()
      } catch (err: any) {
        this.log('Error sending challenge to client:', err.message)
        stream.abort(new Error('Error sending challenge to client'))
      }
    }).catch((err: any) => {
      this.log('Error handling request', err)
    })
  }

  // Authentication methods
  async decorate (connectionId: string, abortOptions?: AbortOptions): Promise<boolean> {
    this.log('attempt for connection:', connectionId)

    if (!this.started) {
      this.log('middleware not started')
      return false
    }

    // If already authenticated, return true
    if (this.decoratedConnections.has(connectionId)) {
      this.log('Connection middleware already applied:', connectionId)
      return true
    }

    // We're going to initiate middleware with the server
    // The server will send us a challenge that we need to respond to
    this.log(`Initiating middleware for connection ${connectionId}`)

    const connections = this.components.connectionManager.getConnections()
    this.log('Looking for connection', connectionId, 'among', connections.length, 'connections')

    const connection = connections.find((conn: Connection) => conn.id === connectionId)
    if (connection == null) {
      this.log('Connection', connectionId, 'not found')
      return false
    }

    try {
      // Open a stream to the remote peer using the auth challenge protocol
      this.log('Opening challenge-response stream to peer', connection.remotePeer.toString(), 'on protocol', CHALLENGE_RESPONSE_PROTOCOL)
      const stream = await connection.newStream(CHALLENGE_RESPONSE_PROTOCOL, { signal: AbortSignal.timeout(this.timeout) })

      const lp = lpStream(stream)

      try {
        this.log('Waiting to receive challenge from server...')
        const challengeBytes = await lp.read({ signal: AbortSignal.timeout(this.timeout) })
        const challenge = new TextDecoder().decode(challengeBytes.slice())
        this.log(`Received challenge from server: [${challenge}] (length: ${challenge.length})`)

        // Calculate the response (SHA-256 hash of the challenge)
        const response = await this.calculateSha256(challenge)
        this.log(`Calculated response hash: ${response}`)

        // Send response to server
        try {
          await lp.write(new TextEncoder().encode(response), { signal: AbortSignal.timeout(this.timeout) })
          this.log('Response sent successfully to server')
        } catch (err: any) {
          this.log('Error sending response to server:', err.message)
          stream.abort(new Error('Error sending response to server'))
          return false
        }

        try {
          const isOK = await lp.read({ signal: AbortSignal.timeout(this.timeout) })
          this.log('Read challenge ok')
          // eslint-disable-next-line max-depth
          if (new TextDecoder().decode(isOK.slice()) !== 'OK') {
            stream.abort(new Error('reading challenge ok failed'))
            return false
          }

          this.decoratedConnections.add(connectionId)
          await stream.close()
          return true
        } catch (err: any) {
          this.log('Error reading response from server:', err.message)
          stream.abort(new Error('Error reading response from server'))
          return false
        }
      } catch (err: any) {
        this.log('Error sending response to server:', err.message)
        // Ensure stream is closed in case of error
        if (stream != null) {
          stream.abort(new Error('Error sending response to server'))
          return false
        }
      }
    } catch (err: any) {
      // eslint-disable-next-line no-console
      this.log('Middleware error for connection', connectionId, err)
      return false
    }

    return false
  }

  /**
   * Generate a random string of specified length
   */
  generateRandomString (length: number): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let result = ''

    // Generate twice as many random bytes as needed to ensure good randomness
    const randomValues = new Uint8Array(length * 2)

    try {
    // Try to use crypto.getRandomValues if available (browser or Node.js with webcrypto)
      if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        crypto.getRandomValues(randomValues)
      } else {
      // Fallback for environments without crypto
        for (let i = 0; i < randomValues.length; i++) {
          randomValues[i] = Math.floor(Math.random() * 256)
        }
      }
    } catch (e) {
    // Final fallback if crypto.getRandomValues throws an error
    // eslint-disable-next-line no-console
      console.warn('Crypto.getRandomValues failed, using Math.random fallback')
      for (let i = 0; i < randomValues.length; i++) {
        randomValues[i] = Math.floor(Math.random() * 256)
      }
    }

    // Use only length bytes for the result
    for (let i = 0; i < length; i++) {
      result += chars.charAt(randomValues[i] % chars.length)
    }

    return result
  }

  /**
   * Calculate SHA-256 hash of a string
   */
  async calculateSha256 (input: string): Promise<string> {
  // Ensure input is properly encoded to bytes
    const data = fromString(input, 'utf8')

    // Use the Web Crypto API directly to calculate the SHA-256 hash
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = new Uint8Array(hashBuffer)

    // Convert to hex string with specific formatting
    return toString(hashArray, 'hex')
  }
}
