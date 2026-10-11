// The one server stub instance of the app, stored on the device.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { KeyValue, MemoryKV } from './db';
import { MockServer } from './server';

/** AsyncStorage, falling back to memory if storage is unavailable. */
class DeviceKV implements KeyValue {
  private readonly memory = new MemoryKV();
  private broken = false;

  async get(key: string) {
    if (this.broken) return this.memory.get(key);
    try {
      return await AsyncStorage.getItem(key);
    } catch {
      this.broken = true;
      return this.memory.get(key);
    }
  }
  async set(key: string, value: string) {
    await this.memory.set(key, value);
    if (this.broken) return;
    try {
      await AsyncStorage.setItem(key, value);
    } catch {
      this.broken = true;
    }
  }
  async remove(key: string) {
    await this.memory.remove(key);
    if (this.broken) return;
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      this.broken = true;
    }
  }
}

export const server = new MockServer(new DeviceKV());
export { makeMockGoogleToken, TELEGRAM_BOT } from './server';
export type { InboxMessage } from './server';
