import { Injectable, inject } from '@angular/core';

import {
  BehaviorSubject, EMPTY, Observable, Subject, catchError, concatWith, defer, distinctUntilChanged,
  filter, finalize, ignoreElements, map, merge, retry, share, switchMap, tap, throwError, timer,
} from 'rxjs';

import { webSocket } from 'rxjs/webSocket';

import { FsWebSocketTopic } from '../classes';
import { FS_WEB_SOCKET_CONFIG } from '../consts';
import { FsWebSocketEvent } from '../enums';
import { FsWebSocketConfig, FsWebSocketMessage } from '../interfaces';


/**
 * Transport for the live-update socket. Carries `{ event, topic, data }` frames
 * and understands nothing about what they mean.
 *
 * The counterpart of the backend's WebSocket layer, and deliberately the same
 * shape: a topic is an opaque string, the server decides who may watch one and
 * what a browser may put on it, and a payload is a signal rather than the thing
 * that changed. Features are built on top of this the way the backend builds
 * them on top of its topic handlers — this package never learns about any of
 * them.
 *
 * The connection is lazy and reference-counted: it opens when something first
 * listens and closes when the last listener goes away, so a screen that does
 * not use live updates costs nothing.
 *
 * Authentication is not handled here. The handshake is a same-origin HTTP
 * request, so the browser attaches the session cookie itself — which is why the
 * token can stay HttpOnly and never be read by JavaScript.
 *
 * Live updates are an enhancement, never a dependency. On a deployment with no
 * socket server this service goes quiet and every consumer simply never hears
 * anything — no errors, no dialogs, no retry storm. Screens keep a refresh
 * timer of their own for exactly that reason.
 */
@Injectable({
  providedIn: 'root',
})
export class FsWebSocket {

  private static readonly _defaultReconnectDelay = 5000;

  /**
   * How many times a socket that has never once connected is dialed before it
   * is written off for the life of the tab.
   *
   * Only reached on a deployment whose socket server is not running. Retrying
   * that forever costs a failed connection every five seconds and a
   * browser-generated console error with each one, for a feature that is not
   * coming back without somebody starting a process.
   */
  private static readonly _defaultConnectAttempts = 3;

  private static readonly _defaultPath = '/ws';

  private readonly _config: FsWebSocketConfig = inject(FS_WEB_SOCKET_CONFIG, { optional: true }) ?? {};

  private readonly _connected$ = new BehaviorSubject<boolean>(false);

  private _socket$: Subject<FsWebSocketMessage> | null = null;

  /** Whether a connection has ever succeeded — see {@link _defaultConnectAttempts}. */
  private _everConnected = false;

  /** Set once the socket is written off, so nothing reopens it later. */
  private _abandoned = false;

  /**
   * How many live streams are holding each topic.
   *
   * A topic carries more than one event and is watched by more than one screen,
   * so the server-side subscription cannot belong to whichever stream happens
   * to be torn down first — without this, closing the typing indicator
   * unsubscribes the topic and silences the messages still being watched on it.
   */
  private readonly _topicRefs = new Map<string, number>();

  private readonly _messages$: Observable<FsWebSocketMessage> = defer(() => {
    if (this._abandoned) {
      return EMPTY;
    }

    this._socket$ = this._createTransport();

    return this._socket$
      .pipe(
        // A socket closing is the connection going away, not the stream being
        // finished with — so it is retry's business, and retry only sees
        // errors. rxjs completes rather than errors on a clean close, which is
        // what a server does when it restarts for a deploy or hangs up
        // politely; without this the tab goes quiet for good in exactly the
        // case the reconnect delay exists for, and only an abrupt drop is ever
        // dialed again.
        concatWith(throwError(() => new Error('Socket closed'))),
      );
  })
    .pipe(
      // Handled here rather than in a separate subscription so the connected
      // state is set before any consumer of on() sees a later message on the
      // same stream.
      tap((message: FsWebSocketMessage) => {
        if (message.event === FsWebSocketEvent.Connected) {
          this._everConnected = true;
          this._setConnected(true);
        }
      }),
      retry({
        delay: (error: unknown, attempt: number) => {
          // A socket that has connected before is recovering from a sleeping
          // laptop or a deploy restarting the server, and both deserve retrying
          // for as long as the tab is open. One that has never connected is
          // talking to a deployment with no socket server, and after a few
          // attempts that is a fact about the deployment, not a blip.
          if (!this._everConnected && attempt >= this._getConnectAttempts()) {
            return throwError(() => error);
          }

          return timer(this._getReconnectDelay());
        },
      }),
      // The socket giving up is not an error anyone should see or handle: live
      // updates are an enhancement over a UI that already works without them.
      // Completing instead of erroring means consumers just stop hearing.
      catchError(() => {
        this._abandoned = true;
        this._setConnected(false);

        return EMPTY;
      }),
      share({ resetOnRefCountZero: true }),
    );

  /**
   * Whether the socket is usable, from the moment it is subscribed to — so a
   * screen can both say so out loud and choose a refresh cadence that matches.
   *
   * "Usable" means the server has said it is connected, not merely that the TCP
   * upgrade succeeded. The server authenticates the handshake cookie against
   * the database, which is asynchronous — so a client that starts talking when
   * the transport opens can get a subscribe in before authentication finishes,
   * and the server drops messages from a connection it has not identified yet.
   * That failure is invisible: the socket stays open and simply never delivers.
   *
   * Subscriptions live on the server, so a dropped connection loses them all. A
   * consumer watches this to re-declare what it cares about on every rise
   * rather than assuming a reconnect restores anything — which is what
   * {@link watch} does for them.
   *
   * Subscribing is what opens the connection, which is why the transport is
   * merged in here rather than only being reached through {@link on}. Nothing
   * dials the socket except a subscription to the message stream, and nothing
   * reports connected except the socket — so a consumer that waits for this
   * before subscribing to messages waits forever, and {@link watch} is exactly
   * that consumer. Merging the stream in with its elements dropped gives this
   * a hold on the connection without it carrying anything of its own.
   *
   * A getter rather than a field: it is built from a private one, and a public
   * field would be initialized before it.
   */
  public get connected$(): Observable<boolean> {
    return merge(
      this._messages$
        .pipe(ignoreElements()),
      this._connected$,
    )
      .pipe(distinctUntilChanged());
  }

  /**
   * A handle on one topic — the way features should reach the socket.
   *
   * Everything a feature needs (listen to an event, publish to it, know whether
   * it is connected) without assembling any plumbing, and without the topic
   * string being rebuilt at each call site. Cheap and stateless: take one per
   * conversation, per screen, per whatever the topic is scoped to.
   */
  public topic(topic: string): FsWebSocketTopic {
    return new FsWebSocketTopic(this, topic);
  }

  /**
   * Everything published on one topic under one event name, for as long as it
   * is subscribed to. The primitive behind {@link topic}; prefer that.
   *
   * It declares the topic on every rise of connected$ rather than once at
   * setup, because server-side
   * subscriptions do not survive a reconnect — a consumer that assumes they do
   * goes quiet after the first network blip, with the socket still open and
   * apparently healthy. Waiting for connected$ is also what keeps a subscribe
   * from being sent before the server has authenticated the connection, which
   * it drops without saying so.
   *
   * Filtered by topic as well as event because one socket carries every topic
   * the tab is watching, and instances of the same feature all publish under
   * the same event name.
   */
  public watch<T>(topic: string, event: string): Observable<T> {
    return defer(() => {
      this._retainTopic(topic);

      return this.connected$
        .pipe(
          filter((connected: boolean) => connected),
          // Re-sent on every rise, and harmless to repeat: the server holds a
          // set per connection, so a duplicate subscribe is a no-op.
          tap(() => this.subscribe(topic)),
          switchMap(() => this._frames$(event)),
          filter((message: FsWebSocketMessage) => message.topic === topic),
          map((message: FsWebSocketMessage) => message.data as T),
        );
    })
      .pipe(
        finalize(() => this._releaseTopic(topic)),
      );
  }

  /**
   * Every payload delivered under `event`, across all topics. Prefer
   * {@link watch}, which also declares the subscription and keeps it declared.
   */
  public on<T>(event: string): Observable<T> {
    return this._frames$(event)
      .pipe(
        map((message: FsWebSocketMessage) => message.data as T),
      );
  }

  /** Whole frames for one event, so watch() can route on the root topic. */
  private _frames$(event: string): Observable<FsWebSocketMessage> {
    return this._messages$
      .pipe(
        filter((message: FsWebSocketMessage) => message.event === event),
      );
  }

  /**
   * Ask the server for a topic. A refused topic is answered with a `denied`
   * message rather than a closed socket, so one screen asking for something it
   * may not see never costs the others their connection.
   */
  public subscribe(topic: string): void {
    this._send(FsWebSocketEvent.Subscribe, topic);
  }

  public unsubscribe(topic: string): void {
    this._send(FsWebSocketEvent.Unsubscribe, topic);
  }

  /**
   * Put something on a topic for the other browsers watching it — the signals
   * too frequent and too short-lived to be worth a database write and a REST
   * round trip each, of which typing is the archetype.
   *
   * `data` is a hint about what happened, never a claim about who it happened
   * to: the server builds what actually goes on the wire from the session
   * behind this socket, so anything identifying here is ignored. The event
   * comes back on {@link watch} like any other, including to this tab, which is
   * why callers filter their own account out.
   */
  public publish(topic: string, event: string, data: Record<string, unknown> = {}): void {
    if (this._connected$.value) {
      this._socket$?.next({ event, topic, data });
    }
  }

  /**
   * Dropping a send while disconnected is deliberate. Every message this
   * carries is a subscription declaration, and consumers re-declare theirs on
   * every rise of connected$ — queuing them here would just deliver duplicates
   * later.
   */
  private _send(event: string, topic: string): void {
    if (this._connected$.value) {
      this._socket$?.next({ event, topic });
    }
  }

  /**
   * The wire, and the one thing a subclass is expected to replace.
   *
   * Both directions at once, the way a socket is: `next()` on it sends, and
   * subscribing to it receives. A test, a demo with no server, or an app on a
   * different transport overrides this and inherits everything above it —
   * subscribe/re-subscribe on reconnect, topic reference counting, the envelope,
   * the topic filtering. That matters more than the convenience: a fake that
   * reimplements those is not exercising this class, it is standing in for it,
   * and the two drift apart without anybody noticing.
   *
   * A subclass supplying its own needs the two halves separate, or everything
   * sent comes straight back to itself. Override `next()` to receive what the
   * browser is sending, and push inbound messages through `super.next()`:
   *
   * ```ts
   * class TransportSubject extends Subject<FsWebSocketMessage> {
   *   constructor(private _onSend: (message: FsWebSocketMessage) => void) {
   *     super();
   *   }
   *
   *   // The browser sending. Deliberately does NOT call super.next().
   *   public override next(message: FsWebSocketMessage): void {
   *     this._onSend(message);
   *   }
   *
   *   // The server pushing.
   *   public deliver(message: FsWebSocketMessage): void {
   *     super.next(message);
   *   }
   * }
   * ```
   *
   * Public rxjs API throughout. `AnonymousSubject(destination, source)` does
   * the same job in fewer lines and is the obvious answer, but it is not on the
   * rxjs root export and its `destination` is marked "Internal implementation
   * detail, do not use directly. Will be made internal in v8" — so it costs a
   * deep import into internals that is scheduled to break.
   */
  protected _createTransport(): Subject<FsWebSocketMessage> {
    return webSocket<FsWebSocketMessage>({
      url: this._getUrl(),
      closeObserver: {
        next: () => this._setConnected(false),
      },
    });
  }

  /**
   * Drive the connected state. A subclass replacing the transport has no
   * closeObserver to fire, so this is how it reports the connection going away
   * — and the only supported way to move the state without reaching into the
   * subject behind it.
   */
  protected _setConnected(connected: boolean): void {
    this._connected$.next(connected);
  }

  /**
   * Drop the connection and everything held on it.
   *
   * For when the session behind the socket changes — signing out and signing
   * in as somebody else in the same tab, which is a router navigation and not a
   * page load, so nothing else tears the socket down. Without this the socket
   * stays open, still authenticated as the account that just left.
   *
   * The server re-checks the session on its own schedule and will eventually
   * close a stale connection by itself; this is the polite half, and the fast
   * one. Clears `_abandoned` too, so a socket written off before a sign-in gets
   * a fresh set of attempts after it.
   */
  public reset(): void {
    this._socket$?.complete();
    this._socket$ = null;
    this._topicRefs.clear();
    this._everConnected = false;
    this._abandoned = false;
    this._setConnected(false);
  }

  private _retainTopic(topic: string): void {
    this._topicRefs.set(topic, (this._topicRefs.get(topic) ?? 0) + 1);
  }

  /**
   * Release one stream's hold, and tell the server only when the last one goes.
   */
  private _releaseTopic(topic: string): void {
    const refs = (this._topicRefs.get(topic) ?? 0) - 1;

    if (refs > 0) {
      this._topicRefs.set(topic, refs);

      return;
    }

    this._topicRefs.delete(topic);
    this.unsubscribe(topic);
  }

  private _getConnectAttempts(): number {
    return this._config.connectAttempts ?? FsWebSocket._defaultConnectAttempts;
  }

  private _getReconnectDelay(): number {
    return this._config.reconnectDelay ?? FsWebSocket._defaultReconnectDelay;
  }

  private _getUrl(): string {
    if (this._config.url) {
      return this._config.url;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const path = this._config.path ?? FsWebSocket._defaultPath;

    return `${protocol}://${window.location.host}${path}`;
  }

}
