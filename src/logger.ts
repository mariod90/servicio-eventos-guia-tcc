import type { WaybillEvent } from './types.ts';

/**
 * Log en JSON con waybillNumber y eventId como campos, no dentro del texto,
 * para poder buscar todos los eventos de una guia despues.
 */
export function logEvent(message: string, event: WaybillEvent, error?: unknown): void {
  console.log(JSON.stringify({
    level: error ? 'error' : 'info',
    message,
    waybillNumber: event.waybillNumber,
    eventId: event.eventId,
    status: event.status,
    ...(error instanceof Error ? { cause: error.message } : {})
  }));
}
