import { Observable } from 'rxjs';

import { FsWebSocket } from '../services';


/**
 * One topic, held so a feature never has to assemble socket plumbing.
 *
 * A topic almost always carries more than one event — a conversation carries
 * both the messages arriving and who is typing — and every feature that watches
 * one needs the same three things: declare it, listen to an event on it, put
 * something on it. Handing those out per topic is what stops each feature
 * rebuilding the subscribe/re-subscribe/filter dance, and getting it subtly
 * wrong in a different way each time.
 *
 * Obtained from {@link FsWebSocket.topic}. Holds no state of its own: the
 * subscription is reference-counted inside the socket, so several handles for
 * the same topic — and several streams from one handle — cost one server-side
 * subscription and release it when the last of them goes away.
 */
export class FsWebSocketTopic {

  public constructor(
    private _webSocket: FsWebSocket,
    private _topic: string,
  ) {}

  /** The topic string, for a feature that has to log or compare it. */
  public get name(): string {
    return this._topic;
  }

  /**
   * Whether live updates are arriving. Screens watch this to choose between
   * being pushed and polling themselves, and to say which they are doing.
   */
  public get connected$(): Observable<boolean> {
    return this._webSocket.connected$;
  }

  /**
   * Everything published on this topic under `event`.
   *
   * The subscription is declared for as long as this is subscribed to, and
   * re-declared on every reconnect — server-side subscriptions do not survive a
   * dropped connection.
   */
  public on<T>(event: string): Observable<T> {
    return this._webSocket.watch<T>(this._topic, event);
  }

  /**
   * Put a short-lived signal on this topic for the other browsers watching it.
   *
   * `data` is a hint about what happened, never a claim about who: the server
   * builds what goes on the wire from the session behind the socket. It comes
   * back on {@link on} like any other event, including to this tab.
   */
  public publish(event: string, data: Record<string, unknown> = {}): void {
    this._webSocket.publish(this._topic, event, data);
  }

}
