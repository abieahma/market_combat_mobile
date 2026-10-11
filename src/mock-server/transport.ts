// "Network" between the app and the server stub: copies every request and
// response (nothing is shared by reference, as over a real network), adds a
// delay and, when switched on, drops some requests.

import { ApiError, ApiRequest, ApiResponse, Transport } from '../api/transport';
import type { MockServer } from './server';

export interface NetworkSim {
  latency: boolean;
  failures: boolean;
}

export const FAILURE_RATE = 0.1;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const copy = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

export class MockTransport implements Transport {
  constructor(
    private readonly server: MockServer,
    private readonly sim: () => NetworkSim,
  ) {}

  async send(req: ApiRequest): Promise<ApiResponse> {
    const { latency, failures } = this.sim();
    if (latency) await sleep(120 + Math.random() * 260);
    if (failures && Math.random() < FAILURE_RATE) throw new ApiError(0, 'network', 'No connection to the server');
    const res = await this.server.handle(copy(req));
    if (latency) await sleep(30 + Math.random() * 70);
    return copy(res);
  }
}
