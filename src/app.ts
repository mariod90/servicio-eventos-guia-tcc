import express, { type Express, type Request, type Response } from 'express';

import { createRegisterWaybillEvent } from './application/registerWaybillEvent.ts';
import { createWaybillsRouter } from './http/waybillsRouter.ts';
import { errorHandler } from './http/errorHandler.ts';
import type { EventStore, Publisher } from './application/ports.ts';

export interface AppDependencies {
  publisher: Publisher;
  store: EventStore;
}

/**
 * Aqui solo se arma el servicio: se conectan las piezas y se montan las rutas.
 * El publicador y el almacen entran desde fuera, asi las pruebas usan el publicador
 * en memoria y no necesitan AWS.
 */
export function createApp({ publisher, store }: AppDependencies): Express {
  const app = express();
  app.use(express.json({ limit: '32kb' }));

  const registerWaybillEvent = createRegisterWaybillEvent({ store, publisher });

  app.get('/health', (_request: Request, response: Response) => {
    response.json({ status: 'ok', publisher: publisher.name });
  });

  app.use('/api/v1/waybills', createWaybillsRouter({ registerWaybillEvent, store }));

  app.use(errorHandler);

  return app;
}
