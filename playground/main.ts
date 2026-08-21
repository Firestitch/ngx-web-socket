import { enableProdMode, importProvidersFrom } from '@angular/core';
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';


import { environment } from './environments/environment';
import { BrowserModule, bootstrapApplication } from '@angular/platform-browser';
import { provideAnimations } from '@angular/platform-browser/animations';
import { FormsModule } from '@angular/forms';
import { FsLabelModule } from '@firestitch/label';
import { FsStoreModule } from '@firestitch/store';
import { FsExampleModule } from '@firestitch/example';
import { FsMessageModule } from '@firestitch/message';
import { provideRouter, Routes } from '@angular/router';
import { FsWebSocket, provideFsWebSocket } from '@firestitch/web-socket';
import { ExamplesComponent } from './app/components';
import { AppComponent } from './app/app.component';
import { PlaygroundWebSocket } from './app/services';

const routes: Routes = [
  { path: '', component: ExamplesComponent },
];



if (environment.production) {
  enableProdMode();
}

bootstrapApplication(AppComponent, {
    providers: [
        importProvidersFrom(BrowserModule, FormsModule, FsLabelModule, FsStoreModule, FsExampleModule.forRoot(), FsMessageModule.forRoot()),
        provideAnimations(),
        provideRouter(routes),

        // Adds two playground-only frames and changes nothing else. The socket
        // underneath is the real one.
        PlaygroundWebSocket,
        { provide: FsWebSocket, useExisting: PlaygroundWebSocket },

        // A real WebSocket server runs inside the `ng serve` process — see
        // playground/proxy.conf.js — so `npm run serve` is the whole setup and
        // every frame on this page is a real frame, visible in DevTools under
        // Network → WS. It gets its own port because webpack-dev-server answers
        // every upgrade request on its own port with the hot-reload socket. A
        // deployment serves the socket same-origin and needs no config at all;
        // url exists for a frontend on a different host than the API, which is
        // what this is. Built from the hostname so serving on 0.0.0.0 still
        // works from another device.
        provideFsWebSocket({
          url: `ws://${window.location.hostname}:9501`,

          // Shorter than the 5s default so a dropped connection comes back
          // while you are still looking at it.
          reconnectDelay: 1500,
        }),
    ]
})
  .catch(err => console.error(err));

