import { createApp } from './app.ts';
import { createEventStore } from './store.ts';
import { createInMemoryPublisher } from './publisher/inMemory.ts';
import { createSqsPublisher } from './publisher/sqs.ts';
import type { Publisher } from './application/ports.ts';

const port = Number(process.env.PORT ?? 3000);

// Si no hay cola configurada, arranca con el publicador en memoria.
// Asi el servicio se puede levantar y probar sin cuenta de AWS.
const publisher: Publisher = process.env.SQS_QUEUE_URL
  ? createSqsPublisher({
      queueUrl: process.env.SQS_QUEUE_URL,
      region: process.env.AWS_REGION,
      endpoint: process.env.SQS_ENDPOINT
    })
  : createInMemoryPublisher({ logToConsole: true });

const app = createApp({ publisher, store: createEventStore() });

app.listen(port, () => {
  console.log(JSON.stringify({
    level: 'info',
    message: 'servicio arriba',
    port,
    publisher: publisher.name
  }));
});
