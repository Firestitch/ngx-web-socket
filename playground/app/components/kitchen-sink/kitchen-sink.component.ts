import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import { FsWebSocket } from '@firestitch/web-socket';

interface Message {
  data: any;
  timestamp: Date;
  route?: string;
}

@Component({
    selector: 'app-kitchen-sink',
    templateUrl: 'kitchen-sink.component.html',
    styleUrls: ['kitchen-sink.component.scss'],
    standalone: true,
    imports: [
      CommonModule,
      MatButton
    ]
})
export class KitchenSinkComponent implements OnInit {

  private _webSocket = inject(FsWebSocket);
  private _destroyRef = inject(DestroyRef);

  public config = {};
  public receivedMessages: Message[] = [];
  public sentMessages: Message[] = [];
  public isConnected = false;

  ngOnInit() {
    // Subscribe to route observable
    this._webSocket.routeObservable('test')
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((message) => {
        console.log('Route message:', message);
      });

    // Subscribe to generic receive observable
    this._webSocket.receive()
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((message) => {
        this.receivedMessages.unshift({
          data: message,
          timestamp: new Date(),
          route: message.route
        });
        // Keep only last 50 messages
        if (this.receivedMessages.length > 50) {
          this.receivedMessages = this.receivedMessages.slice(0, 50);
        }
      });

    // Subscribe to connection status
    this._webSocket.connectionStatus$
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((connected) => {
        this.isConnected = connected;
      });
  }

  public connect() {
    this._webSocket.setPort(9501).connect();
  }

  public disconnect() {
    this._webSocket.disconnect();
  }

  public echoMessage() {
    const message = {
      type: 'echo',
      message: `hello-${Date.now()}`,
      timestamp: new Date().toISOString()
    };
    
    // Track sent message
    this.sentMessages.unshift({
      data: message,
      timestamp: new Date(),
      route: undefined
    });
    // Keep only last 50 messages
    if (this.sentMessages.length > 50) {
      this.sentMessages = this.sentMessages.slice(0, 50);
    }
    
    this._webSocket.send(message);
  }

  public clearMessages() {
    this.receivedMessages = [];
    this.sentMessages = [];
  }

  public formatMessage(message: any): string {
    return JSON.stringify(message, null, 2);
  }
}
