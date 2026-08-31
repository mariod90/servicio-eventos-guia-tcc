import type { WaybillStatus } from './waybillStatus.ts';

// El evento y el estado actual de una guia, mas la regla del evento atrasado.
// Depende solo de waybillStatus.ts, en una sola direccion.

/** Un evento de estado ya validado. Lo que entra por HTTP es `unknown` hasta que pasa por validateEvent. */
export interface WaybillEvent {
  eventId: string;
  waybillNumber: string;
  status: WaybillStatus;
  /** Codigo de novedad, cuando el evento reporta una. */
  exceptionCode: string | null;
  /** Hora en que ocurrio el hecho, con zona horaria. No es la hora de llegada. */
  occurredAt: string;
  /** Contador del dispositivo, para desempatar dos eventos con la misma hora. */
  sequence: number;
  operationCenter?: string;
  receivedAt: string;
}

/** Lo ultimo que sabemos de una guia. Sirve para validar la transicion y descartar eventos atrasados. */
export interface CurrentStatus {
  status: WaybillStatus;
  occurredAt: string;
  sequence: number;
}

/**
 * Un mensajero sin senal sincroniza sus eventos cuando recupera cobertura,
 * asi que pueden llegar en desorden. Comparamos por la hora en que ocurrio el hecho
 * (no por la hora en que llego) y desempatamos con el contador del dispositivo.
 */
export function isNewerThanCurrent(event: WaybillEvent, current: CurrentStatus | undefined): boolean {
  if (!current) return true;

  const eventTime = Date.parse(event.occurredAt);
  const currentTime = Date.parse(current.occurredAt);

  if (eventTime !== currentTime) {
    return eventTime > currentTime;
  }
  return event.sequence > current.sequence;
}
