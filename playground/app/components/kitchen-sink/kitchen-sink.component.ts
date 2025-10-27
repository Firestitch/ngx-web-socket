import { Component } from '@angular/core';
import { FsExampleComponent } from '@firestitch/example';
import { FsMessage } from '@firestitch/message';
import { FsWebSocket } from '@firestitch/web-socket';
import { MatButton } from '@angular/material/button';

@Component({
    selector: 'app-kitchen-sink',
    templateUrl: 'kitchen-sink.component.html',
    styleUrls: ['kitchen-sink.component.scss'],
    standalone: true,
    imports: [MatButton]
})
export class KitchenSinkComponent {

  public config = {};

  constructor(
    private exampleComponent: FsExampleComponent,
    private message: FsMessage,
    private _webSocket: FsWebSocket,
  ) {

    this._webSocket.routeObservable('test')
      .subscribe((message) => {
        console.log(message);
      })
  }

  public connect() {
    this._webSocket.setPort(9501).connect();
  }

  public sendMessage() {
    this._webSocket.send('test', 'hello');
  }
}
