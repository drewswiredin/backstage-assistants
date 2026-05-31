import { LoggerService } from '@backstage/backend-plugin-api';
import express, { type Router } from 'express';

export interface RouterOptions {
  logger: LoggerService;
}

/**
 * Builds the Express router for the Assistants backend plugin. Placeholder
 * skeleton — a single health route until the real endpoints are built.
 */
export async function createRouter(_options: RouterOptions): Promise<Router> {
  const router = express.Router();
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  return router;
}
