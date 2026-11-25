import { healthRepository } from '../repositories/healthRepository.js';
import { logger } from '../lib/logger.js';

export const healthService = {
  async check(): Promise<{ ok: boolean; body: { status: 'ok' | 'down'; db: 'ok' | 'down' } }> {
    try {
      await healthRepository.pingDb();
      return { ok: true, body: { status: 'ok', db: 'ok' } };
    } catch (err) {
      logger.error({ err: { name: (err as Error).name } }, 'Health check: database unreachable');
      return { ok: false, body: { status: 'down', db: 'down' } };
    }
  },
};
