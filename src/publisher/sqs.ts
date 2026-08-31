import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

import type { Publisher } from '../application/ports.ts';

export interface SqsPublisherOptions {
  queueUrl: string | undefined;
  region?: string | undefined;
  endpoint?: string | undefined;
}

/**
 * Publicador real contra SQS.
 *
 * Si la cola es FIFO (termina en .fifo) uso dos campos que importan aqui:
 *   - MessageGroupId = numero de guia: SQS garantiza el orden dentro de un mismo grupo,
 *     asi que los eventos de una guia se procesan en orden, y guias distintas van en paralelo.
 *   - MessageDeduplicationId = id del evento: si el mismo evento se envia dos veces
 *     dentro de la ventana de 5 minutos, SQS lo descarta. Es una red de seguridad extra,
 *     la deduplicacion de verdad la hace el servicio con la clave de idempotencia.
 */
export function createSqsPublisher({ queueUrl, region = 'us-east-1', endpoint }: SqsPublisherOptions): Publisher {
  if (!queueUrl) {
    throw new Error('Falta SQS_QUEUE_URL');
  }

  const client = new SQSClient({
    region,
    // Solo para desarrollo local contra ElasticMQ o LocalStack.
    ...(endpoint ? { endpoint, credentials: { accessKeyId: 'local', secretAccessKey: 'local' } } : {})
  });

  const isFifoQueue = queueUrl.endsWith('.fifo');

  return {
    name: 'sqs',

    async publish(event) {
      await client.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(event),
        ...(isFifoQueue
          ? {
              MessageGroupId: event.waybillNumber,
              MessageDeduplicationId: event.eventId
            }
          : {})
      }));
    }
  };
}
