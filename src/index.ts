/**
 * @packageDocumentation
 *
 * The challenge-response middleware implements a challenge-response
 * authentication protocol for libp2p protocol middleware.
 */

import { type Middleware } from 'libp2p-middleware-registrar'
import { MiddlewareChallengeResponse as MiddlewareChallengeResponseClass } from './middleware-challenge-response.js'
import type { AbortOptions, ComponentLogger } from '@libp2p/interface'
import type { ConnectionManager, Registrar } from '@libp2p/interface-internal'

export interface MiddlewareChallengeResponse {
  start(): Promise<void>
  stop(): Promise<void>
  isStarted(): boolean
  decorate(connectionId: string, options?: AbortOptions): Promise<boolean>
  isDecorated(connectionId: string): boolean
}

export interface MiddlewareChallengeResponseInit {
  /**
   * How long to wait for challenge responses (in ms)
   */
  timeout?: number

  /**
   * Protocol prefix to use
   */
  protocolPrefix?: string

  /**
   * Maximum number of inbound streams
   */
  maxInboundStreams?: number

  /**
   * Maximum number of outbound streams
   */
  maxOutboundStreams?: number

  runOnLimitedConnection?: boolean
}

export interface MiddlewareChallengeResponseComponents {
  connectionManager: ConnectionManager
  registrar: Registrar
  logger: ComponentLogger
}

export function middlewareChallengeResponse (init: MiddlewareChallengeResponseInit = {}): (components: MiddlewareChallengeResponseComponents) => Middleware {
  return (components) => new MiddlewareChallengeResponseClass(components, init)
}

export { CHALLENGE_RESPONSE_PROTOCOL } from './constants.js'
