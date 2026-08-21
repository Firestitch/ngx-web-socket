import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';

import { FS_WEB_SOCKET_CONFIG } from '../consts';
import { FsWebSocketConfig } from '../interfaces';


/**
 * Configure the socket for this application.
 *
 * Optional: without it the service dials the same-origin `/ws` every normal
 * deployment serves. Call it when the frontend is served from a different host
 * than the API, or to change the reconnection behaviour.
 */
export function provideFsWebSocket(config: FsWebSocketConfig = {}): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: FS_WEB_SOCKET_CONFIG,
      useValue: config,
    },
  ]);
}
