# @libp2p/middleware-auth-challenge

[![libp2p.io](https://img.shields.io/badge/project-libp2p-yellow.svg?style=flat-square)](http://libp2p.io/)
[![Discuss](https://img.shields.io/discourse/https/discuss.libp2p.io/posts.svg?style=flat-square)](https://discuss.libp2p.io)
[![codecov](https://img.shields.io/codecov/c/github/libp2p/js-libp2p.svg?style=flat-square)](https://codecov.io/gh/libp2p/js-libp2p)
[![CI](https://img.shields.io/github/actions/workflow/status/libp2p/js-libp2p/main.yml?branch=main\&style=flat-square)](https://github.com/libp2p/js-libp2p/actions/workflows/main.yml?query=branch%3Amain)

> Challenge-response authentication provider for libp2p protocol middleware

## Description

This module implements a challenge-response authentication provider for the libp2p protocol middleware. It verifies that a remote peer controls the private key corresponding to their peer ID by:

1. Sending a random challenge to the remote peer
2. Having the peer sign the challenge with their private key
3. Verifying the signature with the peer's public key
4. Recording authentication status in the connection's metadata

## Example

```js
import { createLibp2p } from 'libp2p'
import { createProtocolMiddleware } from '@libp2p/protocol-middleware'
import { challengeResponseProvider } from '@libp2p/middleware-auth-challenge'
import { ping } from '@libp2p/ping'

const node = await createLibp2p({
  services: {
    ping: ping(),
    // Initialize protocol middleware with challenge-response provider
    protocolMiddleware: createProtocolMiddleware({
      provider: challengeResponseProvider({
        timeout: 5000 // 5 second timeout
      }),
      protectedServices: {
        ping: ping()
      }
    })
  }
})

// Get a connection to authenticate
const connection = await node.dial('multiaddr')

// Authenticate the connection
const authenticated = await node.services.protocolMiddleware.authenticate(connection.id)

if (authenticated) {
  console.log('Authentication successful!')
} else {
  console.log('Authentication failed!')
}
```

## API

### Initialize

```js
import { challengeResponseProvider } from '@libp2p/middleware-auth-challenge'

const provider = challengeResponseProvider({
  // options
})
```

### Options

| Name               | Type       | Description                                               | Default      |
|--------------------|------------|-----------------------------------------------------------|--------------|
| protocolPrefix     | `string`   | Protocol prefix to use                                    | `'libp2p'`   |
| timeout            | `number`   | How long to wait for challenge response (in ms)           | `10000`      |
| maxInboundStreams  | `number`   | Maximum number of inbound streams                         | `1`          |
| maxOutboundStreams | `number`   | Maximum number of outbound streams                        | `1`          |
| verifyChallenge    | `Function` | Custom challenge verification function                     | Default verifier |
| autoAuthenticate   | `boolean`  | Automatically authenticate when accessing protected services | `true`     |

## Custom Challenge Verification

You can provide a custom verification function to implement your own challenge-response logic:

```js
const provider = challengeResponseProvider({
  verifyChallenge: async (remotePeerId, challenge, response) => {
    // Implement custom verification logic
    // Return true if authenticated, false otherwise
    return customVerificationLogic(remotePeerId, challenge, response)
  }
})
```

## Security Considerations

The challenge-response authentication provides an additional layer of authentication beyond the encryption handshake. It verifies that the remote peer still controls the private key corresponding to their peer ID, which is particularly useful in scenarios where you want to ensure the continued validity of a peer's identity over a long-lived connection.

## License

Licensed under either of

- Apache 2.0, ([LICENSE-APACHE](LICENSE-APACHE) / <http://www.apache.org/licenses/LICENSE-2.0>)
- MIT ([LICENSE-MIT](LICENSE-MIT) / <http://opensource.org/licenses/MIT>)