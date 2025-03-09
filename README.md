# js-libp2p-middleware-evm

Requires https://github.com/dozyio/js-libp2p-middleware-registrar and https://github.com/libp2p/js-libp2p/pull/3040. Uses https://github.com/dozyio/evm-rule-engine

## Example

An slightly contrived example of 2 js-libp2p peers using a EVM blockchain to
validate that each peer is holding 1 Eth.

The middleware is run after connection setup and encryption / multiplexing is
negotiated but before another stream is setup. The middleware is mutual i.e.
both sides run middleware checks, so it should run twice per connection.

If the middleware fails, i.e. a peer isn't holding 1 Eth, the connection closes.

### Example Source

```typescript
// evm.ts
import { tcp } from "@libp2p/tcp"
import { createLibp2p } from "libp2p"
import { noise } from "@chainsafe/libp2p-noise"
import { identify } from '@libp2p/identify'
import { ping } from '@libp2p/ping'
import { yamux } from "@chainsafe/libp2p-yamux"
import { ethers, Wallet } from 'ethers'
import { prefixLogger } from '@libp2p/logger'
import { MiddlewareRegistrar } from 'libp2p-middleware-registrar'
import { middlewareEVM } from 'libp2p-middleware-evm'
import { EVMRuleEngine, createRulesFromDefinitions } from 'evm-rule-engine'
import type { Networks } from 'evm-rule-engine'

const networks: Networks = [
  {
    provider: new ethers.JsonRpcProvider('http://127.0.0.1:8545'),
    chainId: '31337'
  }
]

const engine = new EVMRuleEngine({ networks })

const ruleDefinitions = [
  {
    type: 'walletBalance',
    chainId: '31337',
    params: {
      value: ethers.parseEther('1'),
      compareType: 'gte'
    }
  },
]

const rules = createRulesFromDefinitions(networks, ruleDefinitions)
engine.addRules(rules)

async function newNode(port: string, nickname: string) {
  let signer: Wallet
  if (nickname === 'n1') {
    signer = new Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80')
  } else if (nickname === 'n2') {
    signer = new Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
  }
  const node = await createLibp2p({
    logger: prefixLogger(nickname),
    addresses: {
      listen: [
        `/ip6/::/tcp/${port}`
      ]
    },
    transports: [
      tcp(),
    ],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: {
      identify: identify(),
      ping: ping()
    },
    registrar: (components) => {
      const middleware = middlewareEVM({ signer, evmRuleEngine: engine })

      return new MiddlewareRegistrar(components.registrar, middleware(components), components.logger)
    }
  })

  await node.start()

  console.log(`Node started with id ${node.peerId.toString()}`)
  console.log('Mutliaddrs', node.getMultiaddrs())

  return node
}

const n1 = await newNode('12345', 'n1')
const n2 = await newNode('12346', 'n2')

const rtt1 = await n1.services.ping.ping(n2.getMultiaddrs()[0])
console.log('rtt1', rtt1)
```

### Running Example
Run anvil in a terminal window
```sh
anvil --port 8545 --chain-id 31337
```

Run the example with logging (note: use node 23 to run typescript)
```sh
DEBUG=* node evm.ts
```
