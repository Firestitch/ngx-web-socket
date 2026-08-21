'use strict';

/**
 * Not really a proxy config — it is the only hook the Angular dev server offers
 * for running something of your own inside its process, and the playground uses
 * it to bring up a real WebSocket server alongside `ng serve`.
 *
 * That keeps the whole demo to one command with nothing to configure: no second
 * terminal, no port to remember, no setup step a developer has to be told
 * about. The socket lives exactly as long as the dev server does.
 *
 * The socket is not proxied through the dev server on purpose.
 * webpack-dev-server registers its hot-reload WebSocket with no path, so its
 * `shouldHandle` matches every upgrade request on its port — a proxied `/ws`
 * would be answered by the reload socket instead. Its own port sidesteps that,
 * and the browser is pointed at it by `provideFsWebSocket({ url })` in
 * `main.ts`. A real deployment serves the socket same-origin and needs neither.
 */

require('./socket-server').start();

module.exports = {};
