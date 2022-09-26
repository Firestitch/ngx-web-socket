import { Injectable } from '@angular/core';

import { catchError, tap, switchAll, skip, distinctUntilChanged, map, retryWhen, repeat, switchMap, filter, finalize } from 'rxjs/operators';
import { BehaviorSubject, Observable, Subject, timer } from 'rxjs';

import { webSocket } from 'rxjs/webSocket';


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
 */
@Injectable({
  providedIn: 'root',
})
export class FsWebSocket {

  public messages$: Observable<any>;
  private _socket$: any;
  private _messagesSubject$ = new Subject();

  private _status$: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  private _attemptNr: number = 0;
  private _reconnectionDelay = 1000;

  private _routeObservables: { route: string; observable: Subject<any> }[] = [];

  private _protocol: string;
  private _host: string;
  private _port: number;
  private _path: string = '/ws';

  public get connectionStatus$(): Observable<boolean> {
    return this._status$.pipe(distinctUntilChanged());
  }

  constructor() {
    this._protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    this._host = window.location.hostname;
    this._port = parseInt(window.location.port, 10);

    this.connectionStatus$.pipe(
      skip(1),
      filter((status: any) => !status),
      tap(() => this.connect()),
    ).subscribe();

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
        //resubscribe to routes after reconnect
        this._routeObservables.forEach((routeObservable: any) => {
          this._socket$.next({ subscribe: routeObservable.route });
        });
      }),
    ).subscribe(this._status$);

    const closeObserver = new Subject<CloseEvent>();
    closeObserver.pipe(map((_: any) => false)).subscribe(this._status$);

    this._socket$ = webSocket<any>({
      url,
      openObserver,
      closeObserver,
    });

    this._socket$.pipe(retryWhen((errs: any) => errs.pipe(retryConnection, repeat())))
      .subscribe((message: any) => {
        this._routeObservables.forEach((routeObservable: any) => {
          //send messages to appropriate observables based on route
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

    this._socket$.next({ subscribe: route });

    return routeObservable.observable.asObservable().pipe(
      finalize(() => {
        //todo:  is there a better way to kill no longer used observables?
        setTimeout(() => {
          this._cleanupObservables();
        });
      }));
  }


  /**
   * send message to server
   */
  public send(route: string, data?: any): void {
    const message = {
      route,
      data,
    };

    return this._socket$.next(message);
  }


  private _cleanupObservables() {
    this._routeObservables = this._routeObservables.filter((row: any) => {
      return row.observable.observers.length >= 1;
    });
  }


}
