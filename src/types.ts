import type { WaybillStatus } from './domain/status.ts';

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
 * Contrato del publicador. Lo cumplen el de SQS y el de memoria,
 * y por eso las pruebas pueden correr sin AWS.
 */
export interface Publisher {
  name: string;
  publish(event: WaybillEvent): Promise<void>;
}

export interface EventStore {
  findKey(key: string): string | undefined;
  reserveKey(key: string, eventId: string): boolean;
  releaseKey(key: string): void;
  statusOf(waybillNumber: string): CurrentStatus | undefined;
  recordEvent(event: WaybillEvent, options: { updateStatus: boolean }): void;
  historyOf(waybillNumber: string): WaybillEvent[];
}
