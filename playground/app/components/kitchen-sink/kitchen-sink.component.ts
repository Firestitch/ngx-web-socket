import { Component } from '@angular/core';
import { FsExampleComponent } from '@firestitch/example';
import { FsMessage } from '@firestitch/message';
import { FsWebSocket } from '@firestitch/web-socket';

@Component({
  selector: 'app-kitchen-sink',
  templateUrl: 'kitchen-sink.component.html',
  styleUrls: ['kitchen-sink.component.scss']
})
export class KitchenSinkComponent {

  public config = {};

  constructor(
    private exampleComponent: FsExampleComponent,
    private message: FsMessage,
    private _webSocket: FsWebSocket,
  ) {
  }

  public connect() {
    this._webSocket.connect();
  }
}
