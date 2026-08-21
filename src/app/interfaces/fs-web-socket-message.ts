/**
 * The frame both directions travel in.
 *
 * Routing lives at the root and the payload lives in `data`. That split is the
 * whole shape of the protocol: `event` and `topic` are how a frame is routed
 * and are the framework's, while `data` belongs entirely to whatever raised the
 * event — this package never looks inside it.
 *
 * `topic` is absent on the frames that concern the connection rather than any
 * topic (`connected`, `ping`, `pong`, `error`), and `data` is absent on the
 * frames that carry nothing but routing.
 *
 * A client publishes by naming the event it is raising rather than wrapping it
 * in a verb, so a publish and a delivery are the same frame seen from two ends.
 * Protocol events are bare words; application events contain a dot.
 */
export interface FsWebSocketMessage<T = unknown> {
  event: string;
  topic?: string;
  data?: T;
}
