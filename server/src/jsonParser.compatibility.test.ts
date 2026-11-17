import express from 'express';
import { request } from 'node:http';
import { deflateSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

describe('Express JSON parser compatibility', () => {
  it.each(['identity', 'gzip', 'deflate'])('parses an ordinary %s JSON request', async (encoding) => {
    const app = express();
    app.use(express.json());
    app.post('/echo', (req, res) => res.json(req.body));
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });

    try {
      const json = { title: 'Svensk text: åäö', enabled: true };
      const plain = Buffer.from(JSON.stringify(json));
      const body = encoding === 'gzip' ? gzipSync(plain) : encoding === 'deflate' ? deflateSync(plain) : plain;
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected a TCP server address');
      const result = await new Promise<{ status: number | undefined; body: unknown }>((resolve, reject) => {
        const req = request({
          host: '127.0.0.1', port: address.port, path: '/echo', method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Encoding': encoding, 'Content-Length': body.length },
        }, (response) => {
          let text = '';
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => { text += chunk; });
          response.once('error', reject);
          response.once('end', () => {
            try { resolve({ status: response.statusCode, body: JSON.parse(text) }); } catch (error) { reject(error); }
          });
        });
        req.once('error', reject);
        req.setTimeout(2000, () => req.destroy(new Error('JSON request timed out')));
        req.end(body);
      });
      expect(result).toEqual({ status: 200, body: json });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
