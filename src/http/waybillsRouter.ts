import { Router, type Request, type Response } from 'express';

import type { RegisterWaybillEvent, RegisterWaybillEventResult } from '../application/registerWaybillEvent.ts';
import type { EventStore } from '../application/ports.ts';

/**
 * Capa HTTP: traduce peticion -> comando y resultado -> codigo de respuesta.
 * Aqui no hay ninguna regla de negocio; si aparece una, va en el caso de uso.
 */

export interface WaybillsRouterDependencies {
  registerWaybillEvent: RegisterWaybillEvent;
  store: EventStore;
}

export function createWaybillsRouter(
  { registerWaybillEvent, store }: WaybillsRouterDependencies
): Router {
  const router = Router();

  router.post('/:waybillNumber/events', async (request: Request, response: Response) => {
    // La cabecera es parte del contrato HTTP, asi que se valida aqui y no en el caso de uso.
    const idempotencyKey = request.header('Idempotency-Key');
    if (!idempotencyKey) {
      return response.status(400).json({
        error: 'MISSING_HEADER',
        message: 'Falta la cabecera Idempotency-Key'
      });
    }

    const result = await registerWaybillEvent({
      waybillNumber: request.params.waybillNumber ?? '',
      idempotencyKey,
      body: request.body
    });

    return replyAccordingTo(result, response);
  });

  router.get('/:waybillNumber/status', (request: Request, response: Response) => {
    // Esta consulta no tiene caso de uso propio: hoy seria una funcion que solo reenvia
    // la llamada al almacen. Cuando tenga reglas (permisos, cache, agregacion), se extrae.
    const waybillNumber = request.params.waybillNumber ?? '';
    const currentStatus = store.statusOf(waybillNumber);
    if (!currentStatus) {
      return response.status(404).json({ error: 'WAYBILL_NOT_FOUND' });
    }
    return response.json({ waybillNumber, ...currentStatus });
  });

  return router;
}

/** Unico sitio donde se decide el codigo HTTP de cada resultado del caso de uso. */
function replyAccordingTo(result: RegisterWaybillEventResult, response: Response): Response {
  switch (result.outcome) {
    case 'ACCEPTED':
      return response.status(202).json({ eventId: result.eventId, result: 'ACCEPTED' });

    case 'DISCARDED_AS_STALE':
      // 202 porque el evento se acepto y se guardo, aunque no cambie el estado actual.
      return response.status(202).json({ eventId: result.eventId, result: 'DISCARDED_AS_STALE' });

    case 'DUPLICATE':
      // 200 y no 409: el cliente reintento, no se equivoco.
      return response.status(200).json({ eventId: result.eventId, result: 'DUPLICATE' });

    case 'INVALID_BODY':
      return response.status(400).json({ error: 'INVALID_BODY', errors: result.errors });

    case 'INVALID_TRANSITION':
      return response.status(422).json({
        error: 'INVALID_TRANSITION',
        message: `No se puede pasar de ${result.from} a ${result.to}`
      });

    case 'PUBLISH_FAILED':
      return response.status(502).json({
        error: 'PUBLISH_FAILED',
        message: 'No se pudo publicar el evento, reintente con la misma Idempotency-Key'
      });

    default:
      return assertNever(result);
  }
}

/**
 * Si manana se agrega un resultado nuevo al caso de uso y se olvida mapearlo aqui,
 * esto no compila. El compilador hace de prueba.
 */
function assertNever(value: never): never {
  throw new Error(`Resultado del caso de uso no contemplado: ${JSON.stringify(value)}`);
}
