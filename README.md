# Waybill Events Service

Prueba técnica — Desarrollador Advance · Grupo TCC · Proceso SEL20260703

API REST que recibe un evento de estado de una guía, lo valida y lo publica a una cola SQS.
Es el ejercicio previo de la prueba, así que está pensado para ser corto y para poder
explicar cada decisión, no para ser completo.

---

## Requisitos

- Node.js 22.18 o superior (probado en 24)
- No hace falta cuenta de AWS ni base de datos para ejecutarlo o correr las pruebas

La versión mínima no es un capricho: el proyecto ejecuta TypeScript sin paso de compilación y
eso depende del *type stripping* que Node trae activo desde la 22.18. En una versión anterior el
servicio no arranca y `npm test` reporta cero pruebas sin dar error.

Está escrito en TypeScript **sin paso de compilación**: desde la 22.18 Node ejecuta archivos
`.ts` directamente, quitando los tipos al cargarlos. No hay `dist/`, ni `ts-node`, ni un
`build` antes de arrancar. TypeScript queda solo como dependencia de desarrollo, para el
editor y para `npm run typecheck`.

## Cómo ejecutarlo

```bash
npm install
npm start
```

Arranca en `http://localhost:3000`. Si no hay una cola configurada, el servicio usa un
publicador en memoria que escribe el evento en consola. Eso permite levantarlo y probarlo
sin infraestructura.

Para publicar contra SQS de verdad, se define la variable y se reinicia:

```bash
export SQS_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/123456789012/waybill-events.fifo
export AWS_REGION=us-east-1
npm start
```

## Cómo probarlo

```bash
# Registrar un evento
curl -i -X POST http://localhost:3000/api/v1/waybills/TCC00918273/events \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: key-001" \
  -d '{
        "status": "EN_TRANSITO",
        "occurredAt": "2026-07-14T09:12:33-05:00",
        "sequence": 1,
        "operationCenter": "MDE-01"
      }'
# → 202 { "eventId": "...", "result": "ACCEPTED" }

# El mismo evento otra vez, con la misma clave
# → 200 { "eventId": "...(el mismo)", "result": "DUPLICATE" }

# Consultar el estado actual de la guía
curl http://localhost:3000/api/v1/waybills/TCC00918273/status
```

## Pruebas y revisión de tipos

```bash
npm test            # 14 pruebas
npm run typecheck   # tsc --noEmit
```

Catorce pruebas con el runner que trae Node, sin librerías adicionales, en dos niveles.

**Seis sobre el caso de uso** (`registerWaybillEvent.test.ts`), sin levantar servidor. Son
las que cubren las reglas:

| Prueba | Qué protege |
|---|---|
| Evento válido devuelve `ACCEPTED` y publica | El camino feliz |
| Misma clave dos veces devuelve `DUPLICATE` | Que un reintento del cliente no genere un duplicado |
| Transición inválida, con estado de origen y destino | Que una guía entregada no vuelva a "en tránsito" |
| Evento atrasado no cambia el estado actual | El caso del mensajero que sincroniza tarde |
| Si falla la publicación, libera la clave | Que un fallo de la cola no pierda el evento |
| Cuerpo inválido devuelve la lista de errores | Validación |

**Ocho sobre la API** (`events.test.ts`), que levantan el servicio en un puerto libre y le
pegan por HTTP. Verifican el contrato: que cada resultado del caso de uso salga con el
código correcto (202, 200, 400, 422, 502), que falte la cabecera dé 400, que un JSON roto dé
400 y no un HTML, y que una guía sin eventos dé 404.

La división no es casual: las reglas se prueban donde viven, y por HTTP solo se prueba lo
que es responsabilidad de HTTP.

---

## Convención de idioma

El código está en inglés —nombres de archivos, carpetas, variables, funciones, campos del
JSON— y los **valores del dominio quedan en español**: `ADMITIDA`, `EN_TRANSITO`,
`EN_REPARTO`, `NOVEDAD`, `ENTREGADA`, `DEVUELTA`.

La razón es que esos valores son el vocabulario que usa la operación. Si un analista o
alguien de negocio lee un log o el contenido de un mensaje en la cola, tiene que reconocer
lo que ve sin traducir. Los comentarios y los mensajes de error legibles también van en
español; los códigos de error (`INVALID_TRANSITION`, `PUBLISH_FAILED`) van en inglés porque
son vocabulario técnico, no de negocio.

Glosario: guía → *waybill*, novedad → *exception code*, centro operativo → *operation center*.

---

## El contrato

**`POST /api/v1/waybills/{waybillNumber}/events`**

Cabecera obligatoria: `Idempotency-Key`. La genera el cliente y debe ser la misma en todos
los reintentos del mismo evento.

```json
{
  "eventId": "018f3c...",
  "status": "EN_REPARTO",
  "exceptionCode": null,
  "occurredAt": "2026-07-14T09:12:33-05:00",
  "sequence": 42,
  "operationCenter": "MDE-01"
}
```

| Campo | Obligatorio | Notas |
|---|---|---|
| `eventId` | no | Si no viene, el servicio lo genera |
| `status` | sí | `ADMITIDA`, `EN_TRANSITO`, `EN_REPARTO`, `NOVEDAD`, `ENTREGADA`, `DEVUELTA` |
| `exceptionCode` | no | Código de novedad cuando aplica |
| `occurredAt` | sí | Fecha ISO 8601 **con zona horaria**. Es la hora del hecho, no la de llegada |
| `sequence` | sí | Contador del dispositivo. Sirve para desempatar dos eventos con la misma hora |
| `operationCenter` | no | |

Respuestas:

| Código | Cuándo |
|---|---|
| `202` con `ACCEPTED` | Evento aceptado y publicado |
| `202` con `DISCARDED_AS_STALE` | Llegó tarde, se guarda pero no cambia el estado |
| `200` con `DUPLICATE` | Ya se había procesado esa clave de idempotencia |
| `400` | Falta la cabecera (`MISSING_HEADER`), o el cuerpo no valida (`INVALID_BODY`) |
| `422` | La transición de estado no es válida (`INVALID_TRANSITION`) |
| `502` | No se pudo publicar en la cola. El cliente debe reintentar con la misma clave |

**`GET /api/v1/waybills/{waybillNumber}/status`** devuelve el estado actual de la guía.
**`GET /health`** para chequeo de vida.

---

## Cómo está organizado

```
src/
├── server.ts                       arranque y elección del publicador
├── app.ts                          arma las piezas y monta las rutas
├── logger.ts                       log estructurado en JSON
│
├── http/                           traduce HTTP <-> caso de uso
│   ├── waybillsRouter.ts             rutas y mapeo de resultado a código de respuesta
│   └── errorHandler.ts
│
├── application/                    los casos de uso
│   ├── registerWaybillEvent.ts       el flujo completo, sin saber qué es HTTP
│   └── ports.ts                      lo que el caso de uso necesita: Publisher, EventStore
│
├── domain/                         las reglas, sin dependencias de framework
│   ├── waybillStatus.ts              estados y transiciones; no depende de nada
│   ├── waybillEvent.ts               el evento, el estado actual, la regla del atrasado
│   └── validate.ts                   validación del cuerpo
│
├── store.ts                        memoria: claves usadas, estado por guía, histórico
└── publisher/
    ├── sqs.ts                        publicador real
    └── inMemory.ts                   publicador falso para pruebas y para correr sin AWS

test/
├── registerWaybillEvent.test.ts    el caso de uso, sin levantar servidor
└── events.test.ts                  la API por HTTP
```

Tres capas, y la regla es que cada una solo mira hacia adentro:

**`http/`** extrae la cabecera, arma el comando y traduce el resultado a un código de
respuesta. No decide nada de negocio.

**`application/`** tiene el flujo: deduplicar, validar, descartar atrasados, comprobar la
transición, publicar. Devuelve un resultado, no una respuesta HTTP:

```ts
export type RegisterWaybillEventResult =
  | { outcome: 'ACCEPTED'; eventId: string }
  | { outcome: 'DUPLICATE'; eventId: string }
  | { outcome: 'DISCARDED_AS_STALE'; eventId: string }
  | { outcome: 'INVALID_BODY'; errors: string[] }
  | { outcome: 'INVALID_TRANSITION'; from: WaybillStatus; to: WaybillStatus }
  | { outcome: 'PUBLISH_FAILED' };
```

Separarlo así responde a algo concreto del escenario: los eventos no llegan solo de la app
del mensajero, también del TMS y de Gestión Internacional. El día que una de esas fuentes
entre por una cola en vez de por REST, el caso de uso se reutiliza tal cual y no hay que
duplicar reglas ni arrastrar Express a donde no pinta nada.

Y trae dos beneficios que se ven en el código: el caso de uso **se puede probar sin levantar
un servidor** (esas seis pruebas corren en menos de un milisegundo cada una), y el mapeo a
códigos HTTP está en un solo `switch` cerrado con `assertNever`, así que si mañana se añade
un resultado nuevo y se olvida mapearlo, **no compila**.

**`domain/`** son funciones puras: no saben que existen Express ni SQS.

La consulta de estado no tiene caso de uso propio, a propósito: hoy sería una función que
solo reenvía la llamada al almacén. Cuando tenga reglas —permisos por cliente, caché— se
extrae. Prefiero una asimetría que pueda explicar a una capa vacía por simetría.

### Dónde viven los tipos

Los tipos no están todos juntos en un archivo, sino donde pertenecen:

- **`domain/waybillEvent.ts`** tiene el modelo: `WaybillEvent` y `CurrentStatus`.
- **`application/ports.ts`** tiene los puertos: `Publisher` y `EventStore`.

La separación no es cosmética. Los puertos no son dominio: son lo que el **caso de uso**
necesita del mundo exterior para trabajar. El dominio no tiene por qué saber que los eventos
"se publican" o "se guardan"; eso es lo que hace que `waybillStatus.ts` y `validate.ts` sean
funciones puras. Y `domain/waybillStatus.ts` no importa nada: es la pieza más interna.

Las dependencias van en una sola dirección: `http/` → `application/` → `domain/`, y quien
implementa los puertos (SQS, memoria) depende de las interfaces, no al revés.

En `application/ports.ts` está el contrato del publicador:

```ts
export interface Publisher {
  name: string;
  publish(event: WaybillEvent): Promise<void>;
}
```

Es una interfaz de dos líneas y hace bastante: el publicador de SQS y el de memoria la
cumplen los dos, así que cambiar de uno a otro es cambiar una línea en `server.ts`. Si
mañana esto fuera Kafka o RabbitMQ, sería un archivo nuevo en `publisher/` y nada más.

---

## Decisiones que tomé, y lo que cuestan

**TypeScript, pero sin paso de compilación.**
Los tipos aquí no son decoración: el resultado de validar es un tipo unión (`{ valid: true,
event }` o `{ valid: false, errors }`), así que el compilador me obliga a revisar el caso de
error antes de poder tocar el evento. No se puede seguir adelante con un evento a medio
validar aunque se me olvide. Y como Node ya ejecuta `.ts` directamente, no pago el costo
habitual: no hay carpeta de compilados ni un `build` que se pueda olvidar. Lo que cuesta es
que sube el mínimo de versión de Node a 22.18.

**Express, no `node:http` a pelo ni un framework más nuevo.**
Con `node:http` tendría que escribir a mano el enrutado, los parámetros de ruta y el parseo
del cuerpo: código que no aporta nada al ejercicio y sí introduce errores. Express es lo más
conocido y quería que este código se leyera rápido. La alternativa que consideré es Fastify,
que es más rápido y trae validación por esquema integrada; no la tomé porque no la he usado
y no quería entregar algo que no pudiera explicar.

**Tres capas, no una ni cinco.**
Empecé con todo el flujo dentro del manejador de Express y lo saqué, porque tenía una regla
de negocio —"un evento atrasado se acepta pero no se publica"— viviendo al lado de un
`response.status(202)`. Con la separación gano dos cosas concretas: puedo probar el flujo sin
levantar un servidor, y el día que los eventos entren también por una cola el caso de uso se
reutiliza sin tocar nada. Lo que cuesta es un salto más al leer el código y el riesgo de
sobreestructurar; por eso no le puse caso de uso a la consulta de estado, que hoy no tiene
reglas.

**La clave de idempotencia la manda el cliente, no la calcula el servicio.**
Si yo la calculara con un hash del cuerpo, un reintento con un `receivedAt` distinto daría
otra clave y no serviría de nada. El costo es que dependo de que el cliente la mande bien;
por eso la hice obligatoria y respondo `400` si no viene.

**Un duplicado responde `200`, no `409`.**
El cliente reintentó, no se equivocó. Devolverle un error lo empujaría a reintentar otra vez.

**Reservo la clave antes de publicar y la libero si la publicación falla.**
Así dos peticiones simultáneas con la misma clave no publican las dos, y si la cola está
caída el cliente puede reintentar con la misma clave sin que le diga "duplicado".

**Si la cola es FIFO, el `MessageGroupId` es el número de guía.**
SQS garantiza el orden dentro de un mismo grupo, así que los eventos de una guía se procesan
en orden, y guías distintas siguen yendo en paralelo. El costo es que las colas FIFO tienen
menos rendimiento que las estándar; si eso llegara a ser un problema, usaría cola estándar
y resolvería el orden comparando `occurredAt` en el consumidor, que es justamente lo que ya
hace este servicio.

**Un evento que llega tarde no es un evento inválido.**
Este es el caso que más me interesó del dominio: el mensajero pierde cobertura y sincroniza
sus eventos una hora después. Ese evento ocurrió antes que el estado que ya tengo, así que
lo acepto y lo guardo en el histórico, pero no cambia el estado actual ni se publica —no
quiero mandarle al cliente una notificación de un estado viejo. Por eso comparo por
`occurredAt` y no por el orden de llegada.

**Publico directo a la cola, sin base de datos.**
Es la decisión más discutible del ejercicio y prefiero decirlo yo: hoy, entre aceptar el
evento y publicarlo hay una ventana en la que se puede perder si el proceso se cae. La forma
correcta de resolverlo es guardar el evento y el mensaje en la misma transacción de base de
datos y que otro proceso lea esa tabla y publique (patrón *outbox*). No lo implementé porque
sin base de datos no tenía sentido y porque no lo he usado en producción; prefiero explicarlo
en la entrevista antes que entregar una versión a medias.

---

## Qué dejé fuera a propósito

- **Base de datos.** Todo está en memoria: al reiniciar se pierde. En producción sería una
  tabla en Postgres con un índice `UNIQUE` sobre la clave de idempotencia, que es lo que de
  verdad resuelve la carrera entre varias instancias del servicio.
- **Autenticación.** No hay ninguna. Iría un token OAuth2 o mTLS entre servicios.
- **El consumidor.** El servicio publica; quien lee la cola y notifica al cliente no está.
  Ahí es donde irían los reintentos y la cola de mensajes fallidos (DLQ).
- **Métricas.** Solo hay log estructurado en JSON con el número de guía y el id del evento
  como campos, para poder rastrear una guía. Faltarían contadores de eventos aceptados,
  duplicados y descartados.
- **Docker y despliegue.**

Nada de esto es olvido: son las cosas que no cabían en el tiempo del ejercicio y que
tengo claras como siguiente paso.

---

## Sobre el stack

La prueba menciona Java Spring Boot y Angular como tecnologías principales, y también
servicios en Node.js. Elegí Node con TypeScript porque es donde tengo más profundidad hoy y
quería poder defender cada línea de este código en la conversación, que entendí que es el
objetivo del ejercicio. TypeScript además me deja escribir el contrato de los datos como
tipos, que es la misma idea de trabajar con un modelo tipado en Java o en Angular.

Sobre la cola: usé SQS porque es lo que he tocado en AWS. No he trabajado con Kafka ni con
RabbitMQ en producción. Entiendo la diferencia principal para un caso como este —Kafka
guarda el histórico y permite reprocesar desde el principio, mientras que SQS borra el
mensaje cuando se confirma— y es un tema que me interesa aprender.

## Cómo usé IA

Usé un asistente para el andamiaje del proyecto y para revisar casos que se me podían pasar
en las pruebas, sobre todo el del evento atrasado y el del fallo al publicar. Las decisiones
de diseño y el recorte de alcance son míos, y revisé y ejecuté todo antes de entregarlo:
las catorce pruebas pasan, `npm run typecheck` está limpio y el `curl` del README está probado
tal cual está escrito.
