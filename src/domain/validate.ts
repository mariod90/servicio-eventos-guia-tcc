import { randomUUID } from 'node:crypto';

import { WAYBILL_STATUSES, isValidStatus } from './status.ts';
import type { WaybillEvent } from '../types.ts';

/**
 * El resultado es un tipo union: o hay evento, o hay errores, nunca las dos cosas.
 * El compilador obliga a revisar `valid` antes de tocar `event`, asi que no se puede
 * seguir adelante con un evento a medio validar.
 */
export type ValidationResult =
  | { valid: true; event: WaybillEvent }
  | { valid: false; errors: string[] };

export function validateEvent(waybillNumber: string, body: unknown): ValidationResult {
  const data = (body ?? {}) as Record<string, unknown>;
  const errors: string[] = [];

  if (!isNonEmptyText(waybillNumber)) {
    errors.push('waybillNumber es obligatorio');
  }

  if (!isValidStatus(data.status)) {
    errors.push(`status debe ser uno de: ${WAYBILL_STATUSES.join(', ')}`);
  }

  if (!isValidDate(data.occurredAt)) {
    errors.push('occurredAt debe ser una fecha ISO 8601, por ejemplo 2026-07-14T09:12:33-05:00');
  }

  if (!Number.isInteger(data.sequence) || (data.sequence as number) < 0) {
    errors.push('sequence debe ser un entero mayor o igual a 0');
  }

  // Campos opcionales: solo se validan si vienen.
  if (data.operationCenter !== undefined && !isNonEmptyText(data.operationCenter)) {
    errors.push('operationCenter, si viene, no puede estar vacio');
  }

  if (data.exceptionCode !== undefined && data.exceptionCode !== null && !isNonEmptyText(data.exceptionCode)) {
    errors.push('exceptionCode, si viene, no puede estar vacio');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    event: {
      eventId: isNonEmptyText(data.eventId) ? data.eventId : randomUUID(),
      waybillNumber,
      status: data.status as WaybillEvent['status'],
      exceptionCode: isNonEmptyText(data.exceptionCode) ? data.exceptionCode : null,
      occurredAt: data.occurredAt as string,
      sequence: data.sequence as number,
      ...(isNonEmptyText(data.operationCenter) ? { operationCenter: data.operationCenter } : {}),
      receivedAt: new Date().toISOString()
    }
  };
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}
