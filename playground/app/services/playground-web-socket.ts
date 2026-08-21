import { Injectable } from '@angular/core';

import { Subject } from 'rxjs';

import { FsWebSocket, FsWebSocketMessage } from '@firestitch/web-socket';


/**
 * The real service, plus the two buttons a demo needs and a browser cannot
 * provide for itself.
 *
 * Deliberately thin. The transport is the one the library builds — a genuine
 * `WebSocket` to the server hosted inside `ng serve` (see
 * `playground/socket-server.js`), so every frame on this page is a real frame
 * and shows up in DevTools under Network → WS. Overriding
 * {@link FsWebSocket._createTransport} here only keeps a reference to it, so
 * the playground can put a frame of its own on the wire; it does not replace
 * anything.
 *
 * Both extra frames are answered by the playground server and by nothing else.
 * A deployment serves neither, which is the point: they are how the page asks
 * the server to do something no client can make it do, and they travel over the
 * same socket as everything else rather than short-circuiting it.
 */
@Injectable()
export class PlaygroundWebSocket extends FsWebSocket {

  public static readonly kitchenSinkTopic = 'playground:kitchen-sink';
  public static readonly secondaryTopic = 'playground:secondary';
  public static readonly event = 'playground.message';

  private _transport: Subject<FsWebSocketMessage> | null = null;

  /**
   * Ask the server to hang up.
   *
   * The interesting half of a socket client is what it does afterwards: the
   * service waits out its reconnect delay, dials again, and re-declares every
   * topic still being watched. Server-side subscriptions do not survive a
   * dropped connection, and a client that assumes they do goes quiet after the
   * first network blip with the socket open and apparently healthy.
   */
  public dropConnection(): void {
    this._transport?.next({ event: 'disconnect', data: {} });
  }

  /**
   * Ask the server to publish something nobody requested — the case a socket
   * exists for, and the one a request/response API cannot cover.
   */
  public serverPush(topic: string, event: string, data: Record<string, unknown> = {}): void {
    this._transport?.next({ event: 'push', data: { ...data, topic, event } });
  }

  protected override _createTransport(): Subject<FsWebSocketMessage> {
    this._transport = super._createTransport();

    return this._transport;
  }

}
