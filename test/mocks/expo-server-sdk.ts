// Jest stub for `expo-server-sdk` — the real package ships as pure ESM
// (`"type": "module"`, `import from 'node:assert'`) and ts-jest cannot
// parse it from node_modules without heavy transform config. Unit tests
// don't exercise real push delivery, so we replace it with a no-op.
export default class Expo {
  static isExpoPushToken(_token: unknown): boolean {
    return true;
  }
  chunkPushNotifications(msgs: unknown[]): unknown[][] {
    return [msgs];
  }
  async sendPushNotificationsAsync(_msgs: unknown[]): Promise<unknown[]> {
    return [];
  }
  chunkPushNotificationReceiptIds(_ids: string[]): string[][] {
    return [];
  }
  async getPushNotificationReceiptsAsync(
    _ids: string[],
  ): Promise<Record<string, unknown>> {
    return {};
  }
}
export type ExpoPushMessage = any;
export type ExpoPushTicket = any;
export type ExpoPushReceipt = any;
