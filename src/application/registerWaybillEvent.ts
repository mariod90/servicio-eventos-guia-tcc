import { validateEvent } from '../domain/validate.ts';
import { isTransitionAllowed, type WaybillStatus } from '../domain/waybillStatus.ts';
import { isNewerThanCurrent } from '../domain/waybillEvent.ts';
import { logEvent } from '../logger.ts';
import type { EventStore, Publisher } from './ports.ts';

/**
 * Caso de uso: registrar un evento de estado de una guia.
 *
 * No sabe nada de HTTP a proposito. Recibe un comando y devuelve un resultado;
 * quien lo llama decide como se traduce eso a codigos de respuesta. Asi el dia que
 * los eventos lleguen tambien por una cola (el escenario menciona TMS y EDI, no solo
 * la app del mensajero) se reutiliza esto tal cual, sin duplicar reglas.
 */

export interface RegisterWaybillEventCommand {
  waybillNumber: string;
  /** La manda el cliente; debe ser la misma en todos los reintentos del mismo evento. */
  idempotencyKey: string;
  /** El cuerpo crudo, sin validar. */
  body: unknown;
}

export type RegisterWaybillEventResult =
  | { outcome: 'ACCEPTED'; eventId: string }
  | { outcome: 'DUPLICATE'; eventId: string }
  | { outcome: 'DISCARDED_AS_STALE'; eventId: string }
  | { outcome: 'INVALID_BODY'; errors: string[] }
  | { outcome: 'INVALID_TRANSITION'; from: WaybillStatus; to: WaybillStatus }
  | { outcome: 'PUBLISH_FAILED' };

export interface RegisterWaybillEventDependencies {
  store: EventStore;
  publisher: Publisher;
}

export type RegisterWaybillEvent =
  (command: RegisterWaybillEventCommand) => Promise<RegisterWaybillEventResult>;

export function createRegisterWaybillEvent(
  { store, publisher }: RegisterWaybillEventDependencies
): RegisterWaybillEvent {

  return async function registerWaybillEvent(command) {
    // 1. Si ya vimos esta clave, el cliente reintento. No es un error.
    const previousEventId = store.findKey(command.idempotencyKey);
    if (previousEventId) {
      return { outcome: 'DUPLICATE', eventId: previousEventId };
    }

    // 2. Validacion. El resultado es un tipo union, asi que no se puede seguir
    //    adelante con un evento a medio validar.
    const validation = validateEvent(command.waybillNumber, command.body);
    if (!validation.valid) {
      return { outcome: 'INVALID_BODY', errors: validation.errors };
    }

    const event = validation.event;
    const currentStatus = store.statusOf(event.waybillNumber);

    // 3. Evento atrasado: llego tarde pero ocurrio antes que el estado que ya tenemos.
    //    No es un error del emisor, asi que lo guardamos en el historico, pero no cambia
    //    el estado actual ni se publica: no queremos notificar al cliente un estado viejo.
    if (!isNewerThanCurrent(event, currentStatus)) {
      store.reserveKey(command.idempotencyKey, event.eventId);
      store.recordEvent(event, { updateStatus: false });
      logEvent('evento descartado por atraso', event);
      return { outcome: 'DISCARDED_AS_STALE', eventId: event.eventId };
    }

    // 4. Transicion valida segun el estado que ya conocemos de la guia.
    if (currentStatus && !isTransitionAllowed(currentStatus.status, event.status)) {
      return { outcome: 'INVALID_TRANSITION', from: currentStatus.status, to: event.status };
    }

    // 5. Reservamos la clave antes de publicar para que dos llamadas simultaneas
    //    con la misma clave no publiquen las dos.
    if (!store.reserveKey(command.idempotencyKey, event.eventId)) {
      const winnerEventId = store.findKey(command.idempotencyKey);
      return { outcome: 'DUPLICATE', eventId: winnerEventId ?? event.eventId };
    }

    try {
      await publisher.publish(event);
    } catch (error) {
      // Si no pudimos publicar, soltamos la clave para que el cliente reintente
      // con la misma y no se pierda el evento.
      store.releaseKey(command.idempotencyKey);
      logEvent('fallo al publicar', event, error);
      return { outcome: 'PUBLISH_FAILED' };
    }

    store.recordEvent(event, { updateStatus: true });
    logEvent('evento aceptado', event);

    return { outcome: 'ACCEPTED', eventId: event.eventId };
  };
}
