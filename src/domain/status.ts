import type { WaybillEvent, CurrentStatus } from '../types.ts';

// Estados por los que puede pasar una guia y transiciones permitidas entre ellos.
// Esto es lo unico que sabe de "negocio" el servicio; no depende de Express ni de SQS.
//
// Los valores van en espanol a proposito: son el vocabulario que usa la operacion.
// El codigo esta en ingles, el dominio en el idioma del negocio.

export const WAYBILL_STATUSES = [
  'ADMITIDA',
  'EN_TRANSITO',
  'EN_REPARTO',
  'NOVEDAD',
  'ENTREGADA',
  'DEVUELTA'
] as const;

/** El tipo sale de la lista, asi no hay dos sitios que mantener sincronizados. */
export type WaybillStatus = (typeof WAYBILL_STATUSES)[number];

const ALLOWED_TRANSITIONS: Record<WaybillStatus, readonly WaybillStatus[]> = {
  ADMITIDA:    ['EN_TRANSITO', 'NOVEDAD'],
  EN_TRANSITO: ['EN_REPARTO', 'NOVEDAD', 'DEVUELTA'],
  EN_REPARTO:  ['ENTREGADA', 'NOVEDAD', 'DEVUELTA'],
  NOVEDAD:     ['EN_TRANSITO', 'EN_REPARTO', 'DEVUELTA'],
  ENTREGADA:   [], // estado final
  DEVUELTA:    []  // estado final
};

export function isValidStatus(value: unknown): value is WaybillStatus {
  return typeof value === 'string' && (WAYBILL_STATUSES as readonly string[]).includes(value);
}

/**
 * Si es la primera vez que vemos la guia aceptamos cualquier estado,
 * porque el servicio puede empezar a recibir eventos de una guia que ya venia en camino.
 */
export function isTransitionAllowed(
  currentStatus: WaybillStatus | undefined,
  nextStatus: WaybillStatus
): boolean {
  if (!currentStatus) return true;
  return ALLOWED_TRANSITIONS[currentStatus].includes(nextStatus);
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
