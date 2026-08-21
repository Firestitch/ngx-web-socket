/**
 * How this application reaches its socket. Every field is optional: the
 * defaults are the same-origin `/ws` that the backend's WebSocket server
 * reserves, which is what a normal deployment wants.
 */
export interface FsWebSocketConfig {

  /** Path the socket is served on, same origin. Defaults to `/ws`. */
  path?: string;

  /**
   * Full socket URL, for a frontend served from a different host than the API.
   * Overrides `path` when set.
   */
  url?: string;

  /** Milliseconds between reconnection attempts. Defaults to 5000. */
  reconnectDelay?: number;

  /**
   * How many times a socket that has never once connected is dialed before it
   * is written off for the life of the tab. Defaults to 3.
   */
  connectAttempts?: number;

}
