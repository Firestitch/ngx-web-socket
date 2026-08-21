/**
 * The protocol's own events — the frames the socket itself sends and
 * understands, as opposed to the ones an application defines.
 *
 * The two namespaces are kept apart by shape rather than by a list: a protocol
 * event is a bare word, an application event contains a dot
 * ("conversation.typing"). That is what lets a client publish by naming its
 * event directly instead of wrapping it in a verb, and it means a new
 * application event can never collide with a protocol one.
 *
 * Mirrors Framework\WebSocket\Enum\WebSocketEventEnum. The two are the same
 * wire contract read from opposite ends, so they change together.
 */
export enum FsWebSocketEvent {
  // Client to server.
  Subscribe = 'subscribe',
  Unsubscribe = 'unsubscribe',
  Ping = 'ping',

  // Server to client.
  Connected = 'connected',
  Subscribed = 'subscribed',
  Refused = 'refused',
  Pong = 'pong',
  Error = 'error',
}

/** Whether `event` belongs to an application rather than to the protocol. */
export function isApplicationEvent(event: string): boolean {
  return event.includes('.');
}
