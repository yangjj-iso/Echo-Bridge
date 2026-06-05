import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';

import { createEchoBridgeApiServer, type EchoBridgeApiServer } from './index.js';

describe('createEchoBridgeApiServer', () => {
  let server: EchoBridgeApiServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('can listen on an ephemeral port and serve health checks', async () => {
    server = createEchoBridgeApiServer({
      ...process.env,
      ECHO_BRIDGE_AI_PROVIDER: undefined,
      ECHO_BRIDGE_API_PORT: undefined,
    });
    const { url, port } = await server.listen(0);
    const response = await fetch(`${url}/health`);

    expect(port).toBeGreaterThan(0);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      service: 'echo-bridge-api',
      aiProvider: 'mock',
      aiProviderMode: 'mock',
    });
  });

  it('returns the same address when listen is called repeatedly', async () => {
    server = createEchoBridgeApiServer();

    const firstAddress = await server.listen(0);
    const secondAddress = await server.listen(0);

    expect(secondAddress).toEqual(firstAddress);
  });

  it('can close before listening', async () => {
    server = createEchoBridgeApiServer();

    await expect(server.close()).resolves.toBeUndefined();
    await expect(server.close()).resolves.toBeUndefined();
  });

  it('rejects listen attempts after closing', async () => {
    server = createEchoBridgeApiServer();

    await server.listen(0);
    await server.close();

    await expect(server.listen(0)).rejects.toThrow('already been closed');
  });

  it('can retry listening after an address-in-use error', async () => {
    const blockingServer = createServer();
    await new Promise<void>((resolve) => blockingServer.listen(0, '127.0.0.1', resolve));

    const address = blockingServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('Blocking server did not bind to a TCP address.');
    }

    server = createEchoBridgeApiServer();
    try {
      await expect(server.listen(address.port)).rejects.toMatchObject({ code: 'EADDRINUSE' });

      const retryAddress = await server.listen(0);
      expect(retryAddress.port).toBeGreaterThan(0);
    } finally {
      await closeNodeServer(blockingServer);
    }
  });
});

async function closeNodeServer(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
