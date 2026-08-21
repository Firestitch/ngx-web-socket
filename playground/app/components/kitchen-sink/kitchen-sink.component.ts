import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';

import { Observable, Subscription, map, merge } from 'rxjs';

import { FsWebSocket, FsWebSocketTopic } from '@firestitch/web-socket';

import { PlaygroundWebSocket } from '../../services';


interface Entry {
  event?: string;
  data: unknown;
  timestamp: Date;
}

/**
 * Every piece of the public API, driven against a real WebSocket server hosted
 * inside the `ng serve` process — see `playground/socket-server.js`. Nothing to
 * start and nothing to configure, and nothing faked either: open DevTools →
 * Network → WS and every frame below is listed there.
 */
@Component({
  selector: 'app-kitchen-sink',
  templateUrl: 'kitchen-sink.component.html',
  styleUrls: ['kitchen-sink.component.scss'],
  standalone: true,
  imports: [
    DatePipe,
    MatButton,
  ],
})
export class KitchenSinkComponent implements OnInit {

  public readonly primaryTopic = PlaygroundWebSocket.kitchenSinkTopic;
  public readonly secondaryTopic = PlaygroundWebSocket.secondaryTopic;
  public readonly event = PlaygroundWebSocket.event;

  /** A topic the server has no handler for, to show what refusal looks like. */
  public readonly forbiddenTopic = 'playground:forbidden';

  public readonly host = window.location.hostname;

  public connected = false;
  public connectionId = '';

  public primaryMessages: Entry[] = [];
  public secondaryMessages: Entry[] = [];
  public serverEvents: Entry[] = [];

  public watcherCount = 0;
  public secondaryWatching = false;

  private readonly _webSocket = inject(FsWebSocket);

  /** Playground-only: the frames that ask the server to hang up or to push. */
  private readonly _playground = inject(PlaygroundWebSocket);

  private readonly _destroyRef = inject(DestroyRef);

  /**
   * A handle on one topic, which is how a feature is meant to reach the socket
   * — no topic string at the call sites and no plumbing to assemble.
   */
  private readonly _topic: FsWebSocketTopic = this._webSocket.topic(this.primaryTopic);

  private readonly _watchers: Subscription[] = [];

  private _secondary: Subscription | null = null;

  public ngOnInit(): void {
    // Subscribing to connected$ is what opens the socket, and it reports the
    // server having accepted the connection rather than merely the transport
    // opening. The server authenticates before it will listen, and anything
    // sent before that is dropped by a connection it has not identified yet.
    this._webSocket.connected$
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((connected) => this.connected = connected);

    // The raw on(), which hears an event across every topic. Everything the
    // server says about the connection itself arrives this way — including
    // denied, which is how a refused topic comes back: as a message, so one
    // screen asking for something it may not see never costs the others their
    // connection.
    merge(
      this._named('connected'),
      this._named('subscribed'),
      this._named('unsubscribed'),
      this._named('denied'),
    )
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((entry) => {
        if (entry.event === 'connected') {
          this.connectionId = String((entry.data as Record<string, unknown>)['connectionId'] ?? '');
        }

        this.serverEvents = [entry, ...this.serverEvents].slice(0, 40);
      });

    this.addWatcher();
  }

  public get topicName(): string {
    return this._topic.name;
  }

  /**
   * Another stream on the same topic. Each sends its own subscribe, which the
   * server treats as a no-op — but the topic is released only when the last of
   * them goes, which is what stops one screen closing from silencing the others.
   */
  public addWatcher(): void {
    this._watchers.push(
      this._topic.on<Record<string, unknown>>(this.event)
        .subscribe((data) => this.primaryMessages = this._prepend(this.primaryMessages, data)),
    );

    this.watcherCount = this._watchers.length;
  }

  public removeWatcher(): void {
    this._watchers.pop()?.unsubscribe();
    this.watcherCount = this._watchers.length;
  }

  /** A second topic, to show that one socket carries several and filters them. */
  public toggleSecondary(): void {
    if (this._secondary) {
      this._secondary.unsubscribe();
      this._secondary = null;
      this.secondaryWatching = false;

      return;
    }

    this._secondary = this._webSocket.watch<Record<string, unknown>>(this.secondaryTopic, this.event)
      .subscribe((data) => this.secondaryMessages = this._prepend(this.secondaryMessages, data));

    this.secondaryWatching = true;
  }

  /** Publish through the topic handle. */
  public publishPrimary(): void {
    this._topic.publish(this.event, { message: 'from the topic handle' });
  }

  /** Publish through the service, naming the topic. The primitive behind the handle. */
  public publishSecondary(): void {
    this._webSocket.publish(this.secondaryTopic, this.event, { message: 'from the service' });
  }

  /** Ask for a topic nobody serves. Answered with denied, not a closed socket. */
  public requestForbidden(): void {
    this._webSocket.subscribe(this.forbiddenTopic);
  }

  public serverPush(): void {
    this._playground.serverPush(this.primaryTopic, this.event, { message: 'unsolicited server push' });
  }

  public dropConnection(): void {
    this._playground.dropConnection();
  }

  public clear(): void {
    this.primaryMessages = [];
    this.secondaryMessages = [];
    this.serverEvents = [];
  }

  public format(data: unknown): string {
    return JSON.stringify(data);
  }

  private _named(event: string): Observable<Entry> {
    return this._webSocket.on<unknown>(event)
      .pipe(
        map((data) => ({ event, data, timestamp: new Date() })),
      );
  }

  private _prepend(entries: Entry[], data: unknown): Entry[] {
    return [{ data, timestamp: new Date() }, ...entries].slice(0, 25);
  }

}
