/**
 * @packageDocumentation
 *
 * The challenge-response middleware implements a challenge-response
 * authentication protocol for libp2p protocol middleware.
 */

import { type Middleware } from 'libp2p-middleware-registrar'
import { MiddlewareEVM as MiddlewareEVMClass } from './middleware-evm.js'
import type { AbortOptions, ComponentLogger, PeerId } from '@libp2p/interface'
import type { ConnectionManager, Registrar } from '@libp2p/interface-internal'
import type { Wallet } from 'ethers'
import type { EVMRuleEngine } from 'evm-rule-engine'

export interface MiddlewareChallengeResponse {
  start(): Promise<void>
  stop(): Promise<void>
  isStarted(): boolean
  decorate(connectionId: string, options?: AbortOptions): Promise<boolean>
  isDecorated(connectionId: string): boolean
}

export interface MiddlewareEVMInit {
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

  /**
   * Run on limited connection - default: true
   */
  runOnLimitedConnection?: boolean

  /**
   * A configured EVM rule engine
   */
  evmRuleEngine: EVMRuleEngine

  /**
   * Signer for EVM challenges
   */
  signer: Wallet
}

export interface MiddlewareEVMComponents {
  connectionManager: ConnectionManager
  registrar: Registrar
  logger: ComponentLogger
  peerId: PeerId
}

export function middlewareEVM (init: MiddlewareEVMInit): (components: MiddlewareEVMComponents) => Middleware {
  return (components) => new MiddlewareEVMClass(components, init)
}
