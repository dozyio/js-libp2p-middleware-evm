/* eslint-env mocha */
import { defaultLogger } from '@libp2p/logger'
import { expect } from 'aegir/chai'
import { Wallet, ethers, id, verifyMessage } from 'ethers'
import { EVMRuleEngine, addressIsEOA, walletBalance, type EngineConfig } from 'evm-rule-engine'
import { lpStream } from 'it-length-prefixed-stream'
import { duplexPair } from 'it-pair/duplex'
import sinon from 'sinon'
import { stubInterface, type StubbedInstance } from 'sinon-ts'
import { fromString } from 'uint8arrays/from-string'
import { TIMEOUT } from '../src/constants.js'
import { MiddlewareEVM } from '../src/middleware-evm.js'
import type { ComponentLogger, PeerId } from '@libp2p/interface'
import type { ConnectionManager, Registrar } from '@libp2p/interface-internal'

interface StubbedMiddlewareEVMComponents {
  registrar: StubbedInstance<Registrar>
  connectionManager: StubbedInstance<ConnectionManager>
  logger: ComponentLogger
  peerId: StubbedInstance<PeerId>
}

describe('Challenge Response Middleware', () => {
  let components: StubbedMiddlewareEVMComponents

  let middleware: MiddlewareEVM
  let connectionId: string
  let mockConnection: any
  let mockStream: any
  let evmRuleEngine: any

  beforeEach(() => {
    connectionId = 'test-connection-id'

    components = {
      registrar: stubInterface<Registrar>(),
      connectionManager: stubInterface<ConnectionManager>(),
      logger: defaultLogger(),
      peerId: stubInterface<PeerId>()
    }

    // Create mock connection
    mockConnection = {
      id: connectionId,
      remotePeer: {
        toString: () => 'test-peer-id'
      },
      newStream: sinon.stub(),
      abort: sinon.stub()
    }

    // Set up connection manager to return our mock connection
    components.connectionManager.getConnections.returns([mockConnection])
    components.peerId.toString.returns('test-peer-id')

    // Create mock stream for authentication
    mockStream = {
      sink: sinon.stub().resolves(),
      source: [],
      close: sinon.stub().resolves()
    }

    // Set up connection to return our mock stream
    mockConnection.newStream.resolves(mockStream)

    const CHAIN_ID_0 = '31337'
    const CHAIN_ID_0_ENDPOINT = 'http://127.0.0.1:8545'
    const engineConfig: EngineConfig = {
      networks: [
        {
          provider: new ethers.JsonRpcProvider(CHAIN_ID_0_ENDPOINT),
          chainId: CHAIN_ID_0
        }
      ]
    }

    evmRuleEngine = new EVMRuleEngine(engineConfig)
    evmRuleEngine.addRules([
      addressIsEOA(engineConfig.networks, CHAIN_ID_0, {}),
      walletBalance(engineConfig.networks, CHAIN_ID_0, {
        value: ethers.parseEther('1'),
        compareType: 'gte'
      })
    ])

    // Create provider
    middleware = new MiddlewareEVM(components, { evmRuleEngine, signer: new Wallet(id('test')) })
  })

  describe('Middleware factory', () => {
    it('should create a middleware with the correct interface', () => {
      expect(middleware[Symbol.toStringTag]).to.equal('libp2p-middleware-evm')
      expect(middleware.decorate).to.be.a('function')
      expect(middleware.isDecorated).to.be.a('function')
      expect(middleware.start).to.be.a('function')
      expect(middleware.stop).to.be.a('function')
      expect(middleware.isStarted).to.be.a('function')
    })

    it('should accept custom timeout option', () => {
      const customTimeout = TIMEOUT * 2
      const mw = new MiddlewareEVM(components, { timeout: customTimeout, evmRuleEngine, signer: new Wallet(id('test')) })
      expect(mw.timeout).to.equal(customTimeout)
    })

    it('should accept custom protocol prefix', () => {
      const mw = new MiddlewareEVM(components, { protocolPrefix: 'custom', evmRuleEngine, signer: new Wallet(id('test')) })
      expect(mw.protocol).to.contain('custom')
    })
  })

  describe('Provider instance', () => {
    it('should create a valid provider instance', () => {
      expect(middleware).to.exist()
      expect(middleware.start).to.be.a('function')
      expect(middleware.stop).to.be.a('function')
      expect(middleware.isStarted).to.be.a('function')
      expect(middleware.decorate).to.be.a('function')
      expect(middleware.isDecorated).to.be.a('function')
    })

    it('should return false for isStarted initially', () => {
      expect(middleware.isStarted()).to.be.false()
    })

    it('should return false for isDecorated', async () => {
      expect(middleware.isDecorated(mockConnection)).to.be.false()
    })

    it('should return false for decorate when not started', async () => {
      const result = await middleware.decorate(mockStream, mockConnection)
      expect(result).to.be.false()
    })

    describe('start and stop', () => {
      it('should register and unregister protocol handler', async () => {
        components.registrar.getHandler.throws('UnhandledProtocolError')
        await middleware.start()

        expect(components.registrar.handle.called, 'handle called').to.be.true()
        expect(middleware.isStarted(), 'isStarted true').to.be.true()

        components.registrar.getHandler.reset()
        await middleware.stop()

        expect(components.registrar.unhandle.called, 'unhandle called').to.be.true()
        expect(middleware.isStarted(), 'isStarted false').to.be.false()
      })
    })

    describe('decorate', () => {
      beforeEach(async () => {
        await middleware.start()
      })

      afterEach(async () => {
        await middleware.stop()
      })

      it('should open a stream to the remote peer for decorate', async () => {
        // Set up a simple successful response in the mock stream
        mockStream.source = {
          [Symbol.asyncIterator]: async function * () {
            yield fromString('valid-response', 'hex')
          }
        }

        // Start authentication process
        const authPromise = middleware.decorate(mockStream, mockConnection)

        // Wait for the promise to resolve
        await authPromise

        // Verify that newStream was called
        expect(mockConnection.newStream.called).to.be.true()
      })

      it('should send a challenge, wait for response and send OK using a duplex pair', async () => {
        // Create a duplex pair.
        const [clientStream, serverStream] = duplexPair<any>()

        // Polyfill a synchronous iterator on each stream's source.
        const clientSource: any = clientStream.source
        if (clientSource[Symbol.iterator] == null) {
          clientSource[Symbol.iterator] = clientSource[Symbol.asyncIterator].bind(clientSource)
        }
        const serverSource: any = serverStream.source
        if (serverSource[Symbol.iterator] == null) {
          serverSource[Symbol.iterator] = serverSource[Symbol.asyncIterator].bind(serverSource)
        }

        // Ensure a "close" method exists.
        if ((clientStream as any).close == null) {
          (clientStream as any).close = sinon.stub().resolves()
        }
        if ((serverStream as any).close == null) {
          (serverStream as any).close = sinon.stub().resolves()
        }

        // Create a fake connection that returns our clientStream when a new stream is requested.
        const fakeConnection = {
          id: 'test-connection-id',
          remotePeer: { toString: () => 'test-peer-id' },
          newStream: async (_protocol: string, _options?: any) => clientStream,
          abort: sinon.stub()
        }

        // Stub the connection manager to return the fake connection.
        ;(middleware as any).components.connectionManager.getConnections = () => [fakeConnection]

        // Simulate the server behavior.
        async function simulateServer (): Promise<void> {
          const lpServer = lpStream(serverStream)
          const wrappedRules = middleware.wrappedRulesToSign()
          await lpServer.write(new TextEncoder().encode(wrappedRules))
          // Server reads the client's response.
          const res = await lpServer.read({ signal: AbortSignal.timeout(1000) })
          const receivedSig = new TextDecoder().decode(res.slice())
          verifyMessage(wrappedRules, receivedSig)

          // assume signature is OK and EVM rules passed
          await lpServer.write(new TextEncoder().encode('OK'))
          await (serverStream as any).close()
        }

        mockConnection.newStream = sinon.stub().resolves(clientStream)

        // eslint-disable-next-line no-console
        simulateServer().catch(err => { console.error('simulateServer error:', err) })

        // Run the client's decorate process.
        const result: boolean = await middleware.decorate(mockStream, mockConnection)

        expect(result, 'result').to.equal(true)
        expect((clientStream as any).close.called).to.be.true()
      })

      it('should have a working isDecorated function', () => {
        // Initially, connection is not decorated
        expect(middleware.isDecorated(mockConnection)).to.be.false()
      })
    })
  })
})
