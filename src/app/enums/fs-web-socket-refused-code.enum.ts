/**
 * Why the server refused what was asked of it, delivered as the `data.code` of
 * a `refused` frame.
 *
 * The distinction that earns its keep is Unavailable. Everything else is the
 * server working correctly and saying no, and retrying is pointless; that one
 * is a failure to decide, and retrying is exactly right.
 *
 * Mirrors Framework\WebSocket\Enum\WebSocketRefusedCodeEnum.
 */
export enum FsWebSocketRefusedCode {

  /** A handler claims the topic and its read rule said no. */
  Forbidden = 'forbidden',

  /** No registered handler claims the topic — a stale client, or a typo. */
  Unknown = 'unknown',

  /** Authorization could not be evaluated. Transient; retry is worthwhile. */
  Unavailable = 'unavailable',

  /** The topic may be read but does not accept what was published to it. */
  Readonly = 'readonly',

}
