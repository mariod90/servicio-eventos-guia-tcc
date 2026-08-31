import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.ts';
import { createEventStore } from '../src/store.ts';
import { createInMemoryPublisher } from '../src/publisher/inMemory.ts';

interface TestEvent {
  waybillNumber: string;
  status: string;
  occurredAt: string;
  sequence: number;
  operationCenter?: string;
}

/** Lo que puede traer una respuesta del servicio. Todo opcional: cada caso mira lo suyo. */
interface ResponseBody {
  eventId?: string;
  result?: string;
  error?: string;
  errors?: string[];
}

/** response.json() devuelve unknown, asi que lo tipamos en un solo sitio. */
async function readBody(response: Response): Promise<ResponseBody> {
  return (await response.json()) as ResponseBody;
}

/**
 * Levanta el servicio en un puerto libre con el publicador en memoria.
 * No hace falta AWS ni base de datos para correr las pruebas.
 */
function startService(t: TestContext) {
  const publisher = createInMemoryPublisher();
  const store = createEventStore();
  const server = createApp({ publisher, store }).listen(0);

  t.after(() => server.close());

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('El servidor no expuso un puerto');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const sendEvent = (event: TestEvent, idempotencyKey: string | null) =>
    fetch(`${baseUrl}/api/v1/waybills/${event.waybillNumber}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
      },
      body: JSON.stringify(event)
    });

  return { publisher, store, baseUrl, sendEvent };
}

const baseEvent: TestEvent = {
  waybillNumber: 'TCC00918273',
  status: 'EN_TRANSITO',
  occurredAt: '2026-07-14T09:12:33-05:00',
  sequence: 1,
  operationCenter: 'MDE-01'
};

test('un evento valido se acepta y se publica una vez', async (t) => {
  const { publisher, sendEvent } = startService(t);

  const response = await sendEvent(baseEvent, 'key-1');
  const body = await readBody(response);

  assert.equal(response.status, 202);
  assert.equal(body.result, 'ACCEPTED');
  assert.equal(publisher.published.length, 1);
  assert.equal(publisher.published[0]?.waybillNumber, 'TCC00918273');
});

test('reenviar el mismo evento con la misma clave no lo publica dos veces', async (t) => {
  const { publisher, sendEvent } = startService(t);

  const first = await sendEvent(baseEvent, 'key-1');
  const second = await sendEvent(baseEvent, 'key-1');

  const firstBody = await readBody(first);
  const secondBody = await readBody(second);

  assert.equal(first.status, 202);
  assert.equal(second.status, 200);
  assert.equal(secondBody.result, 'DUPLICATE');
  // Devuelve el mismo id de evento que la primera vez.
  assert.equal(secondBody.eventId, firstBody.eventId);
  // Y sobre todo: solo hay un mensaje en la cola.
  assert.equal(publisher.published.length, 1);
});

test('una transicion invalida se rechaza y no publica nada', async (t) => {
  const { publisher, sendEvent } = startService(t);

  // ENTREGADA es un estado final.
  await sendEvent({ ...baseEvent, status: 'ENTREGADA' }, 'key-1');

  const response = await sendEvent(
    { ...baseEvent, status: 'EN_TRANSITO', occurredAt: '2026-07-14T10:00:00-05:00', sequence: 2 },
    'key-2'
  );
  const body = await readBody(response);

  assert.equal(response.status, 422);
  assert.equal(body.error, 'INVALID_TRANSITION');
  assert.equal(publisher.published.length, 1); // solo el primero
});

test('un evento que llega tarde no pisa el estado actual', async (t) => {
  const { publisher, store, sendEvent } = startService(t);

  // Primero llega el evento de las 10:00.
  await sendEvent(
    { ...baseEvent, status: 'EN_REPARTO', occurredAt: '2026-07-14T10:00:00-05:00', sequence: 5 },
    'key-1'
  );

  // Despues llega uno que ocurrio a las 09:00 (el mensajero recupero senal).
  const response = await sendEvent(
    { ...baseEvent, status: 'EN_TRANSITO', occurredAt: '2026-07-14T09:00:00-05:00', sequence: 4 },
    'key-2'
  );
  const body = await readBody(response);

  assert.equal(response.status, 202);
  assert.equal(body.result, 'DISCARDED_AS_STALE');
  assert.equal(store.statusOf('TCC00918273')?.status, 'EN_REPARTO');
  assert.equal(publisher.published.length, 1);
});

test('sin la cabecera Idempotency-Key la peticion se rechaza', async (t) => {
  const { sendEvent } = startService(t);

  const response = await sendEvent(baseEvent, null);
  const body = await readBody(response);

  assert.equal(response.status, 400);
  assert.equal(body.error, 'MISSING_HEADER');
});

test('un cuerpo invalido devuelve 400 con la lista de errores', async (t) => {
  const { sendEvent } = startService(t);

  const response = await sendEvent(
    { ...baseEvent, status: 'VOLANDO', sequence: -3 },
    'key-1'
  );
  const body = await readBody(response);

  assert.equal(response.status, 400);
  assert.equal(body.error, 'INVALID_BODY');
  assert.equal(body.errors?.length, 2);
});

test('si falla la publicacion se devuelve 502 y el reintento con la misma clave funciona', async (t) => {
  const { publisher, sendEvent } = startService(t);

  publisher.failNextCall();

  const first = await sendEvent(baseEvent, 'key-1');
  assert.equal(first.status, 502);
  assert.equal(publisher.published.length, 0);

  // La clave quedo libre, asi que el reintento del cliente si publica.
  const retry = await sendEvent(baseEvent, 'key-1');
  const body = await readBody(retry);

  assert.equal(retry.status, 202);
  assert.equal(body.result, 'ACCEPTED');
  assert.equal(publisher.published.length, 1);
});

test('consultar el estado de una guia sin eventos devuelve 404', async (t) => {
  const { baseUrl } = startService(t);

  const response = await fetch(`${baseUrl}/api/v1/waybills/UNKNOWN/status`);

  assert.equal(response.status, 404);
});
