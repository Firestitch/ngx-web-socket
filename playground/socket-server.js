'use strict';

/**
 * A real WebSocket server, hosted inside the `ng serve` process.
 *
 * Started as a side effect of loading `proxy.conf.js`, which the Angular dev
 * server requires at startup — so there is one command, one process, and
 * nothing for a developer to set up or remember. It lives and dies with
 * `npm run serve`.
 *
 * Real matters here: the browser does a genuine HTTP upgrade handshake against
 * this and exchanges genuine frames, which show up in DevTools under Network →
 * WS with every frame listed. A fake transport inside the tab would exercise
 * the library's logic but prove nothing about the protocol, and the protocol is
 * the part worth proving.
 *
 * It implements the same envelope the backend's WebSocket layer does, and
 * nothing else. A topic is an opaque string, the server decides who may watch
 * one, and a payload is a signal rather than the thing that changed.
 *
 *   client -> server   { event: 'subscribe',   data: { topic } }
 *                      { event: 'unsubscribe', data: { topic } }
 *                      { event: 'publish',     data: { ...payload, topic, event } }
 *                      { event: 'push',        data: { ...payload, topic, event } }
 *                      { event: 'disconnect',  data: {} }
 *
 *   server -> client   { event: 'connected',    data: { connectionId } }
 *                      { event: 'subscribed',   data: { topic } }
 *                      { event: 'unsubscribed', data: { topic } }
 *                      { event: 'denied',       data: { topic, reason } }
 *                      { event: <name>,         data: { ...payload, topic } }
 *
 * `push` and `disconnect` exist only so the playground can ask for the two
 * things a browser cannot make a server do on its own — send something nobody
 * asked for, and hang up. A real deployment serves neither.
 */

const { WebSocketServer } = require('ws');

const PORT = Number(process.env.FS_WEB_SOCKET_PORT || 9501);

/**
 * Delay before `connected` goes out.
 *
 * The real server authenticates the handshake cookie against the database
 * first, and a client that starts talking the moment the transport opens gets
 * its subscribe dropped by a connection the server has not identified yet —
 * invisibly, with the socket open and apparently healthy. Reproducing the
 * window is what makes the service's "wait for connected$ before subscribing"
 * worth watching rather than taking on faith.
 */
const CONNECT_DELAY = 250;

const HEARTBEAT = 30000;

/** Topics this build serves. Anything else is refused. */
const TOPICS = [
  'playground:kitchen-sink',
  'playground:secondary',
];

/** Per-connection state. Subscriptions live here and die with the socket. */
const connections = new Map();

let nextConnectionId = 1;
let server = null;

const log = (message) => console.log(`[socket] ${message}`);

const send = (socket, event, data) => {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify({ event, data }));
  }
};

/**
 * Deliver to everyone holding the topic, the sender included — a publisher
 * hears its own signal come back, which is why callers filter themselves out.
 */
const broadcast = (topic, event, data) => {
  for (const [socket, state] of connections) {
    if (state.topics.has(topic)) {
      send(socket, event, data);
    }
  }
};

/**
 * What goes on the wire is built here, from what the server knows. The client's
 * payload is a hint about what happened, never a claim about who.
 */
const stamp = (topic, payload, from) => ({
  ...payload,
  topic,
  from,
  at: new Date().toISOString(),
});

const onSubscribe = (socket, state, topic) => {
  if (!TOPICS.includes(topic)) {
    // Refused with a message rather than a closed socket: one screen asking for
    // something it may not see must never cost the others their connection.
    send(socket, 'denied', { topic, reason: 'No handler is registered for this topic' });

    return;
  }

  // Repeating a subscribe is a no-op: the server holds a set, and clients
  // re-declare their topics on every reconnect.
  state.topics.add(topic);
  send(socket, 'subscribed', { topic });
};

const onPublish = (socket, state, data, from) => {
  const { topic, event, ...payload } = data || {};

  if (!state.topics.has(topic)) {
    send(socket, 'denied', { topic, reason: 'Not subscribed to this topic' });

    return;
  }

  broadcast(topic, event, stamp(topic, payload, from));
};

const onMessage = (socket, state, raw) => {
  let message;

  try {
    message = JSON.parse(raw.toString());
  } catch {
    log(`#${state.id} unparseable frame`);

    return;
  }

  const data = message.data || {};

  switch (message.event) {
    case 'subscribe':
      onSubscribe(socket, state, data.topic);
      break;

    case 'unsubscribe':
      state.topics.delete(data.topic);
      send(socket, 'unsubscribed', { topic: data.topic });
      break;

    case 'publish':
      onPublish(socket, state, data, `client-${state.id}`);
      break;

    // Playground-only. Lets the page ask for the two things a browser cannot
    // make a server do by itself.
    case 'push':
      onPublish(socket, state, data, 'server');
      break;

    case 'disconnect':
      socket.close(1012, 'Asked to disconnect');
      break;
  }
};

/**
 * Idempotent, because the dev server can load its proxy config more than once
 * and a second listen would take the process down with EADDRINUSE.
 */
const start = () => {
  if (server) {
    return server;
  }

  server = new WebSocketServer({ port: PORT });

  server.on('listening', () => {
    log(`listening on ws://localhost:${PORT} — topics: ${TOPICS.join(', ')}`);
  });

  // A port already taken means somebody is already serving the playground.
  // That is not worth taking the dev server down for.
  server.on('error', (error) => {
    log(error.code === 'EADDRINUSE'
      ? `port ${PORT} is already in use — leaving the existing server alone`
      : `error: ${error.message}`);
  });

  server.on('connection', (socket) => {
    const state = { id: nextConnectionId++, topics: new Set(), alive: true };

    connections.set(socket, state);
    log(`#${state.id} connected`);

    setTimeout(() => send(socket, 'connected', { connectionId: `server-${state.id}` }), CONNECT_DELAY);

    socket.on('message', (raw) => onMessage(socket, state, raw));
    socket.on('pong', () => { state.alive = true; });
    socket.on('error', () => socket.terminate());

    socket.on('close', () => {
      connections.delete(socket);
      log(`#${state.id} disconnected`);
    });
  });

  // A socket whose other end vanished without a close frame stays open forever
  // otherwise, and its subscriptions with it.
  const heartbeat = setInterval(() => {
    for (const [socket, state] of connections) {
      if (!state.alive) {
        socket.terminate();

        continue;
      }

      state.alive = false;
      socket.ping();
    }
  }, HEARTBEAT);

  heartbeat.unref();

  return server;
};

module.exports = { start, PORT, TOPICS };
