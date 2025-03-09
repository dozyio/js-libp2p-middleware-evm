import { isPeerId, type AbortOptions, type Connection, type Logger, type Startable, type Stream } from '@libp2p/interface'
import { type Wallet, verifyMessage } from 'ethers'
import { ruleDefinitionSchema, type EVMRuleEngine, type RuleDefinition } from 'evm-rule-engine'
import { lpStream } from 'it-length-prefixed-stream'
import { v7 as uuidv7 } from 'uuid'
import { z } from 'zod'
import { MAX_INBOUND_STREAMS, MAX_OUTBOUND_STREAMS, PROTOCOL_NAME, PROTOCOL_PREFIX, PROTOCOL_VERSION, TIMEOUT } from './constants.js'
import type { MiddlewareEVMComponents, MiddlewareEVMInit } from './index.js'
import type { Middleware } from 'libp2p-middleware-registrar'

interface ToSign {
  rules: RuleDefinition[]
  timestamp: number
  peerId: string
  nonce: string
}

export class MiddlewareEVM implements Middleware, Startable {
  public readonly protocol: string
  private readonly components: MiddlewareEVMComponents
  private started: boolean
  public readonly timeout: number
  private readonly maxInboundStreams: number
  private readonly maxOutboundStreams: number
  private readonly runOnLimitedConnection: boolean
  private readonly log: Logger
  private readonly decoratedConnections: Set<string>
  public evmRuleEngine: EVMRuleEngine
  private readonly signer: Wallet

  constructor (components: MiddlewareEVMComponents, init: MiddlewareEVMInit) {
    this.components = components
    this.log = components.logger.forComponent('libp2p:middleware-evm')
    this.started = false
    this.protocol = `/${init.protocolPrefix ?? PROTOCOL_PREFIX}/${PROTOCOL_NAME}/${PROTOCOL_VERSION}`
    this.timeout = init.timeout ?? TIMEOUT
    this.maxInboundStreams = init.maxInboundStreams ?? MAX_INBOUND_STREAMS
    this.maxOutboundStreams = init.maxOutboundStreams ?? MAX_OUTBOUND_STREAMS
    this.runOnLimitedConnection = init.runOnLimitedConnection ?? true
    this.signer = init.signer

    if (init.evmRuleEngine == null) {
      throw new Error('EVM engine required')
    }
    this.evmRuleEngine = init.evmRuleEngine

    this.decoratedConnections = new Set<string>()
    this.handle = this.handle.bind(this)
  }

  readonly [Symbol.toStringTag] = 'libp2p-middleware-evm'

  async start (): Promise<void> {
    if (this.started) return

    // Check if the protocol is already registered before trying to register it
    try {
      // Try to get existing handler first
      this.components.registrar.getHandler(this.protocol)
      // If we get here, the protocol is already registered
      this.log(`Protocol ${this.protocol} already registered, skipping`)
    } catch (err: any) {
      // handle registering protocol
      if (err.name === 'UnhandledProtocolError') {
        await this.components.registrar.handle(this.protocol, this.handle, {
          maxInboundStreams: this.maxInboundStreams,
          maxOutboundStreams: this.maxOutboundStreams,
          runOnLimitedConnection: this.runOnLimitedConnection
        })
        this.log(`Registered handler for ${this.protocol}`)
      } else {
        throw err
      }
    }

    this.log(`Started evm middleware with protocol ${this.protocol}`)
    this.started = true
  }

  async stop (): Promise<void> {
    if (!this.started) return

    // Unregister the protocol handler
    try {
      // Make sure the protocol is registered before trying to unregister it
      this.components.registrar.getHandler(this.protocol)
      await this.components.registrar.unhandle(this.protocol)
      this.log(`Unregistered handler for ${this.protocol}`)
    } catch (err: any) {
      // If it's an UnhandledProtocolError, the protocol is already unregistered
      if (err.name === 'UnhandledProtocolError') {
        this.log(`Protocol ${this.protocol} already unregistered, skipping`)
      } else {
        // Unexpected error, log but don't throw (allow cleanup to continue)
        this.log.error(`Error unregistering protocol ${this.protocol}: ${err.message}`)
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

  wrappedRulesToSign (): string {
    const toSign: ToSign = {
      rules: this.evmRuleEngine.getRuleDefinitions(),
      timestamp: Date.now(),
      peerId: this.components.peerId.toString(),
      nonce: uuidv7()
    }

    return JSON.stringify(toSign)
  }

  // Handle inbound EVM challenge-response requests from clients
  handle ({ stream, connection }: { stream: Stream, connection: Connection }): void {
    this.log('Received middleware connection request', connection.id, connection.remotePeer.toString())

    Promise.resolve().then(async () => {
      const lp = lpStream(stream)

      const wrappedRules = this.wrappedRulesToSign()
      try {
        this.log('Sending EVM challenge to client')
        await lp.write(new TextEncoder().encode(wrappedRules), { signal: AbortSignal.timeout(this.timeout) })
        this.log('EVM Challenge sent successfully to client')
      } catch (err: any) {
        this.log('Error sending EVM challenge to client:', err.message)
        connection.abort(new Error('Error sending EVM challenge to client'))
        return
      }

      try {
        this.log('Reading response to challenge')
        const res = await lp.read({ signal: AbortSignal.timeout(this.timeout) })
        this.log('Read response', res)

        const responseSig = new TextDecoder().decode(res.slice())
        const recoveredAddress = verifyMessage(wrappedRules, responseSig)

        this.log('Recovered address:', recoveredAddress)

        const evalRes = await this.evmRuleEngine.evaluate(recoveredAddress)
        if (!evalRes.result) {
          this.log('Failed EVM rule evaluation', evalRes)
          connection.abort(new Error('Failed EVM rule evaluation'))
          return
        }
      } catch (err: any) {
        this.log('Error reading response:', err.message)
        connection.abort(new Error('Error reading response'))
        return
      }

      try {
        this.decoratedConnections.add(connection.id)
        this.log(`Connection ${connection.id} middleware negotiated 
successfully, sending OK`)
        await lp.write(new TextEncoder().encode('OK'), { signal: AbortSignal.timeout(this.timeout) })
        this.log('Sent OK to client, closing stream')
        await stream.close()
      } catch (err: any) {
        this.log('Error sending challenge to client:', err.message)
        connection.abort(new Error('Error sending challenge to client'))
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
      // Open a stream to the remote peer using the EVM protocol
      this.log('Opening EVM stream to peer', connection.remotePeer.toString(), 'on protocol', this.protocol)
      const stream = await connection.newStream(this.protocol, { signal: AbortSignal.timeout(this.timeout) })

      const lp = lpStream(stream)

      try {
        this.log('Waiting to receive challenge from server...')
        const challengeBytes = await lp.read({ signal: AbortSignal.timeout(this.timeout) })
        const challenge = new TextDecoder().decode(challengeBytes.slice())
        this.log(`Received challenge from server: [${challenge}] (length: ${challenge.length})`)

        const toSignSchema = z.object({
          rules: z.array(ruleDefinitionSchema),
          timestamp: z.number().refine(
            (val) => {
              const now = Date.now()
              return Math.abs(now - val) <= 60000 // within 1 minute (60000 ms)
            },
            {
              message: 'Timestamp must be within ±1 minute of the current time.'
            }
          ),
          peerId: z.string().refine(
            (val) => {
              return val === connection.remotePeer.toString()
            },
            {
              message: 'Peer ID must be a valid PeerId'
            }
          ),
          nonce: z.string().uuid()
        })

        const validateRes = toSignSchema.safeParse(JSON.parse(challenge))
        if (!validateRes.success) {
          console.log(validateRes.error)
          connection.abort(new Error('challenge failed validation'))
          return false
        }

        const toSign = validateRes.data

        if (!this.evmRuleEngine.validateRules(toSign.rules)) {
          this.log('Error validation challenge')
          connection.abort(new Error('Error validating challenge'))
          return false
        }

        const sig = await this.signer.signMessage(challenge)
        this.log(`Signed message : ${sig}`)

        // Send response to server
        try {
          await lp.write(new TextEncoder().encode(sig), { signal: AbortSignal.timeout(this.timeout) })
          this.log('Response sent successfully to server')
        } catch (err: any) {
          this.log('Error sending response to server:', err.message)
          connection.abort(new Error('Error sending response to server'))
          return false
        }

        try {
          const isOK = await lp.read({ signal: AbortSignal.timeout(this.timeout) })
          this.log('Read challenge ok')
          // eslint-disable-next-line max-depth
          if (new TextDecoder().decode(isOK.slice()) !== 'OK') {
            connection.abort(new Error('reading challenge ok failed'))
            return false
          }

          this.decoratedConnections.add(connectionId)
          await stream.close()
          return true
        } catch (err: any) {
          this.log('Error reading response from server:', err.message)
          connection.abort(new Error('Error reading response from server'))
          return false
        }
      } catch (err: any) {
        this.log('Error sending response to server:', err.message)
        connection.abort(new Error('Error sending response to server'))
        return false
      }
    } catch (err: any) {
      // eslint-disable-next-line no-console
      this.log('Middleware error for connection', connectionId, err)
      connection.abort(err)
      return false
    }
  }
}
