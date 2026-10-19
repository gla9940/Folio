import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
vi.mock('node:https', () => ({ request: mocks.request }));
import { fetchSource } from './source.ts';
const url = new URL('https://witchculttranslation.com/2021/01/29/arc-7-chapter-2-animal-tracking/');
describe('pinned source network requests', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.lookup.mockResolvedValue([{ address: '1.1.1.1', family: 4 }]); });
  it('rejects a private DNS answer before opening a connection', async () => {
    mocks.lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    await expect(fetchSource(url)).rejects.toMatchObject({ code: 'UNSAFE_ADDRESS' });
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('never follows redirects to another host or an internal URL', async () => {
    mocks.request.mockImplementation((_url, _options, callback: (res: IncomingMessage) => void) => {
      const req = new EventEmitter() as EventEmitter & { end: () => void };
      req.end = () => {
        const res = new EventEmitter() as IncomingMessage;
        res.statusCode = 302;
        res.headers = { location: 'https://127.0.0.1/admin' };
        callback(res);
        queueMicrotask(() => res.emit('end'));
      };
      return req;
    });
    await expect(fetchSource(url)).rejects.toMatchObject({ code: 'SOURCE_REDIRECT' });
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it('pins the checked DNS answer while preserving the TLS hostname', async () => {
    mocks.request.mockImplementation((_url, options, callback: (res: IncomingMessage) => void) => {
      const pinned = vi.fn();
      options.lookup('witchculttranslation.com', {}, pinned);
      expect(pinned).toHaveBeenCalledWith(null, '1.1.1.1', 4);
      expect(_url.hostname).toBe('witchculttranslation.com');
      const req = new EventEmitter() as EventEmitter & { end: () => void };
      req.end = () => {
        const res = new EventEmitter() as IncomingMessage;
        res.statusCode = 200; res.headers = { 'content-type': 'text/html' };
        callback(res);
        queueMicrotask(() => { res.emit('data', Buffer.from('<html>test</html>')); res.emit('end'); });
      };
      return req;
    });
    expect((await fetchSource(url)).status).toBe(200);
  });
});
