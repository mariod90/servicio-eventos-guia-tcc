import test from 'node:test';
import assert from 'node:assert/strict';

import { createRegisterWaybillEvent } from '../src/application/registerWaybillEvent.ts';
import { createEventStore } from '../src/store.ts';
import { createInMemoryPublisher } from '../src/publisher/inMemory.ts';

/**
 * Pruebas del caso de uso sin HTTP: no se levanta ningun servidor.
 * Esto es lo que se gana al sacar la logica del manejador de Express.
 */
function buildUseCase() {
  const publisher = createInMemoryPublisher();
  const store = createEventStore();
  const registerWaybillEvent = createRegisterWaybillEvent({ store, publisher });
  return { publisher, store, registerWaybillEvent };
}

const baseCommand = {
  waybillNumber: 'TCC00918273',
  idempotencyKey: 'key-1',
  body: {
    status: 'EN_TRANSITO',
    occurredAt: '2026-07-14T09:12:33-05:00',
    sequence: 1,
    operationCenter: 'MDE-01'
  }
};

test('un evento valido devuelve ACCEPTED y se publica', async () => {
  const { publisher, registerWaybillEvent } = buildUseCase();

  const result = await registerWaybillEvent(baseCommand);

  assert.equal(result.outcome, 'ACCEPTED');
  assert.equal(publisher.published.length, 1);
});

test('la misma clave dos veces devuelve DUPLICATE y publica una sola vez', async () => {
  const { publisher, registerWaybillEvent } = buildUseCase();

  const first = await registerWaybillEvent(baseCommand);
  const second = await registerWaybillEvent(baseCommand);

  assert.equal(first.outcome, 'ACCEPTED');
  assert.equal(second.outcome, 'DUPLICATE');
  assert.equal(publisher.published.length, 1);
  // El identificador que se devuelve es el del evento original.
  if (first.outcome === 'ACCEPTED' && second.outcome === 'DUPLICATE') {
    assert.equal(second.eventId, first.eventId);
  }
});

test('una transicion invalida devuelve INVALID_TRANSITION con el estado de origen y destino', async () => {
  const { publisher, registerWaybillEvent } = buildUseCase();

  await registerWaybillEvent({ ...baseCommand, body: { ...baseCommand.body, status: 'ENTREGADA' } });

  const result = await registerWaybillEvent({
    ...baseCommand,
    idempotencyKey: 'key-2',
    body: { ...baseCommand.body, status: 'EN_TRANSITO', occurredAt: '2026-07-14T10:00:00-05:00', sequence: 2 }
  });

  assert.equal(result.outcome, 'INVALID_TRANSITION');
  if (result.outcome === 'INVALID_TRANSITION') {
    assert.equal(result.from, 'ENTREGADA');
    assert.equal(result.to, 'EN_TRANSITO');
  }
  assert.equal(publisher.published.length, 1);
});

test('un evento atrasado devuelve DISCARDED_AS_STALE y no cambia el estado actual', async () => {
  const { publisher, store, registerWaybillEvent } = buildUseCase();

  await registerWaybillEvent({
    ...baseCommand,
    body: { ...baseCommand.body, status: 'EN_REPARTO', occurredAt: '2026-07-14T10:00:00-05:00', sequence: 5 }
  });

  const result = await registerWaybillEvent({
    ...baseCommand,
    idempotencyKey: 'key-2',
    body: { ...baseCommand.body, status: 'EN_TRANSITO', occurredAt: '2026-07-14T09:00:00-05:00', sequence: 4 }
  });

  assert.equal(result.outcome, 'DISCARDED_AS_STALE');
  assert.equal(store.statusOf('TCC00918273')?.status, 'EN_REPARTO');
  assert.equal(publisher.published.length, 1);
});

test('si falla la publicacion devuelve PUBLISH_FAILED y libera la clave', async () => {
  const { publisher, registerWaybillEvent } = buildUseCase();

  publisher.failNextCall();
  const failed = await registerWaybillEvent(baseCommand);

  assert.equal(failed.outcome, 'PUBLISH_FAILED');
  assert.equal(publisher.published.length, 0);

  // La clave quedo libre: el reintento con la misma clave si publica.
  const retry = await registerWaybillEvent(baseCommand);

  assert.equal(retry.outcome, 'ACCEPTED');
  assert.equal(publisher.published.length, 1);
});

test('un cuerpo invalido devuelve INVALID_BODY con la lista de errores', async () => {
  const { publisher, registerWaybillEvent } = buildUseCase();

  const result = await registerWaybillEvent({
    ...baseCommand,
    body: { ...baseCommand.body, status: 'VOLANDO', sequence: -3 }
  });

  assert.equal(result.outcome, 'INVALID_BODY');
  if (result.outcome === 'INVALID_BODY') {
    assert.equal(result.errors.length, 2);
  }
  assert.equal(publisher.published.length, 0);
});
