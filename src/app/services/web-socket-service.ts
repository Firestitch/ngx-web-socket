import { Injectable } from '@angular/core';

import { BehaviorSubject, Observable, Subject, timer } from 'rxjs';
import { catchError, distinctUntilChanged, finalize, map, repeat, retryWhen, switchAll, switchMap, tap } from 'rxjs/operators';

import { WebSocketSubject, webSocket } from 'rxjs/webSocket';


/**
 * //initialize connection
 * this._websocketService
 *  .setHost('localhost')
 *  .setPort(123)
 *  .connect();
 *
 * //subscribe to a route
 * this._websocketService
 *  .routeObservable('chat/123/message')
 *  .subscribe((message) => {
 *    if(message.messageType=='something') {
 *      //do something
 *    }
 *  });
 *
 * //send a message to route
 * this._websocketService
 *  .send('chat/123/message',{text: 'hello'});
 *
 * //send a generic message (no route)
 * this._websocketService
 *  .send({type: 'ping', timestamp: Date.now()});
 *
 * //receive all messages (generic)
 * this._websocketService
 *  .receive()
 *  .subscribe((message) => {
 *    console.log('Received:', message);
 *  });
 */
@Injectable({
  providedIn: 'root',
})
export class FsWebSocket {

  public messages$: Observable<any>;
  private _socket$: WebSocketSubject<any>;
  private _messagesSubject$ = new Subject();
  private _genericMessagesSubject$ = new Subject<any>();

  private _status$: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  private _attemptNr: number = 0;
  private _reconnectionDelay = 1000;

  private _routeObservables: { route: string; observable: Subject<any> }[] = [];

  private _protocol: string;
  private _host: string;
  private _port: number;
  private _path: string = '/ws';

  public get connectionStatus$(): Observable<boolean> {
    return this._status$.asObservable().pipe(distinctUntilChanged());
  }

  constructor() {
    this._protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    this._host = window.location.hostname;
    this._port = parseInt(window.location.port, 10);

    this.messages$ = this._messagesSubject$.pipe(switchAll(), catchError((e) => {
      throw e;
    }));
  }


  public setHost(host: string): FsWebSocket {
    this._host = host;

    return this;
  }

  public setPort(port: any): FsWebSocket {
    this._port = port;

    return this;
  }

  public setPath(path: any): FsWebSocket {
    this._path = path;

    return this;
  }


  public connect(): FsWebSocket {
    if (this._socket$) {
      this._socket$.unsubscribe();
    }

    let url = `${this._protocol}://${this._host}`;
    if (this._port) {
      url += `:${this._port}`;
    }
    url += `${this._path}`;


    const retryConnection = switchMap(() => {
      this._status$.next(false);
      this._attemptNr = this._attemptNr + 1;

      return timer(this._reconnectionDelay);
    });

    const openObserver = new Subject<Event>();
    openObserver.pipe(
      map((_: any) => true),
      tap(() => {
        // resubscribe to routes after reconnect
        this._routeObservables.forEach((routeObservable: any) => {
          this._socket$.next({ subscribe: routeObservable.route });
        });
      }),
    ).subscribe(this._status$);

    const closeObserver = new Subject<CloseEvent>();
    closeObserver
      .pipe(
        map((_: any) => {
          return false;
        })
      )
      .subscribe((something) => {
        this._status$.next(something);
      });

    this._socket$ = webSocket<any>({
      url,
      openObserver,
      closeObserver,
    });

    this._socket$
      .pipe(
        retryWhen((errs: any) => {
          return errs.pipe(
            retryConnection,
            repeat()
          )
        })
      )
      .subscribe((message: any) => {
        // emit to generic messages observable
        this._genericMessagesSubject$.next(message);
        
        // send messages to appropriate observables based on route
        this._routeObservables.forEach((routeObservable: any) => {
          if (message.route === routeObservable.route) {
            routeObservable.observable.next(message);
          }
        });
      });

    return this;
  }

  public isConnected(): boolean {
    return this._status$.getValue();
  }

  /**
   * disconnect from server
   */
  public disconnect(): FsWebSocket {
    if (this._socket$) {
      this._socket$.complete();
      this._socket$ = null;
    }

    return this;
  }

  /**
   *  subscribe to a 'route' and return an observable that will provide messages from that route
   *
   */
  public routeObservable(route: string): Observable<any> {
    const routeObservable = {
      route,
      observable: new Subject<any>(),
    };

    this._routeObservables.push(routeObservable);

    if (this.isConnected()) {
      this._socket$.next({ subscribe: route });
    }

    return routeObservable.observable.asObservable().pipe(
      finalize(() => {
        setTimeout(() => {
          this._cleanupObservables();
        });
      }));
  }


  /**
   * send message to server
   * Can be called with:
   * - send(route, data) - sends data to a specific route
   * - send(data) - sends generic data without route
   */
  public send(routeOrData: string | any, data?: any): void {
    if (!this._socket$) {
      throw new Error('WebSocket is not initialized. Call connect() first.');
    }

    // If first argument is a string and second argument exists, treat as route + data
    if (typeof routeOrData === 'string' && data !== undefined) {
      this._socket$.next({ route: routeOrData, ...data });
    } else {
      // Otherwise, treat first argument as generic data
      this._socket$.next(routeOrData);
    }
  }


  /**
   * receive all messages from server (generic, non-route-specific)
   * Returns an observable that emits all incoming messages
   */
  public receive(): Observable<any> {
    return this._genericMessagesSubject$.asObservable();
  }


  private _cleanupObservables() {
    this._routeObservables = this._routeObservables.filter((row: any) => {
      return row.observable.observers.length >= 1;
    });
  }


}
