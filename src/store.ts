import type { CurrentStatus, WaybillEvent } from './domain/waybillEvent.ts';
import type { EventStore } from './application/ports.ts';

/**
 * Almacen en memoria.
 *
 * Guarda tres cosas:
 *   - claves de idempotencia ya usadas, para no procesar dos veces el mismo evento
 *   - el estado actual de cada guia, para validar la transicion y descartar eventos atrasados
 *   - el historico de eventos aceptados
 *
 * En produccion esto seria una tabla en Postgres con un indice UNIQUE sobre la clave
 * de idempotencia. Lo dejo en memoria a proposito, ver el README.
 */
export function createEventStore(): EventStore {
  const usedKeys = new Map<string, string>();            // idempotencyKey -> eventId
  const statusByWaybill = new Map<string, CurrentStatus>(); // waybillNumber -> ultimo estado
  const history: WaybillEvent[] = [];

  return {
    findKey(key) {
      return usedKeys.get(key);
    },

    // Se reserva ANTES de publicar para que dos peticiones simultaneas
    // con la misma clave no publiquen las dos.
    reserveKey(key, eventId) {
      if (usedKeys.has(key)) return false;
      usedKeys.set(key, eventId);
      return true;
    },

    // Si la publicacion falla soltamos la clave para que el cliente pueda reintentar.
    releaseKey(key) {
      usedKeys.delete(key);
    },

    statusOf(waybillNumber) {
      return statusByWaybill.get(waybillNumber);
    },

    recordEvent(event, { updateStatus }) {
      history.push(event);
      if (updateStatus) {
        statusByWaybill.set(event.waybillNumber, {
          status: event.status,
          occurredAt: event.occurredAt,
          sequence: event.sequence
        });
      }
    },

    historyOf(waybillNumber) {
      return history.filter((event) => event.waybillNumber === waybillNumber);
    }
  };
}
