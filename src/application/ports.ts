import type { CurrentStatus, WaybillEvent } from '../domain/waybillEvent.ts';

/**
 * Los puertos: lo que el caso de uso necesita del mundo exterior para poder trabajar.
 *
 * Viven aqui y no en domain/ a proposito. El dominio no tiene por que saber que los
 * eventos "se publican" o "se guardan"; eso es una necesidad de la aplicacion.
 * Quien los implementa (SQS, memoria) esta en infraestructura y depende de estas
 * interfaces, no al reves.
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
