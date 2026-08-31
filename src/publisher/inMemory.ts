import type { WaybillEvent } from '../domain/waybillEvent.ts';
import type { Publisher } from '../application/ports.ts';

/** El publicador de memoria expone dos cosas extra que solo usan las pruebas. */
export interface InMemoryPublisher extends Publisher {
  published: WaybillEvent[];
  failNextCall(): void;
}

/**
 * Publicador falso, para pruebas y para poder levantar el servicio sin AWS.
 * Cumple el mismo contrato que el publicador de SQS: un metodo publish(event).
 */
export function createInMemoryPublisher(
  { logToConsole = false }: { logToConsole?: boolean } = {}
): InMemoryPublisher {
  const published: WaybillEvent[] = [];
  let shouldFailNext = false;

  return {
    name: 'in-memory',

    async publish(event) {
      if (shouldFailNext) {
        shouldFailNext = false;
        throw new Error('Fallo simulado del publicador');
      }
      published.push(event);
      if (logToConsole) {
        console.log(JSON.stringify({ level: 'info', message: 'evento publicado (memoria)', event }));
      }
    },

    published,
    failNextCall() {
      shouldFailNext = true;
    }
  };
}
