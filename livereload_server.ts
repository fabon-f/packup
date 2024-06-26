import { logger } from "./logger_util.ts";

function livereloadScript(port: number) {
  return `window.onload = () => {
  new WebSocket("ws://localhost:${port}/livereload").onmessage = () => location.reload();
};`;
}

function handleWs(sock: WebSocket, eventtarget: EventTarget): void {
  logger.debug("socket connected!");
  sock.onmessage = (ev) => {
    logger.debug("ws:Message", ev.data);
    sock.send(ev.data);
  };
  sock.onopen = () => logger.debug("ws:Open");
  sock.onclose = (ev) => {
    const { code, reason } = ev;
    logger.debug("ws:Close", code, reason);
  };
  sock.onerror = (ev) => {
    logger.error("failed to receive frame:", ev);
    if (canCloseSocket(sock)) {
      sock.close(1000);
    }
  };
  eventtarget.addEventListener("built", () => {
    logger.debug("got reload event!");
    if (canCloseSocket(sock)) {
      sock.send(JSON.stringify({ type: "reload" }));
      sock.close(1000);
    }
  }, { once: true });
}

function canCloseSocket(socket: WebSocket): boolean {
  return socket.readyState === socket.OPEN;
}

async function serve(
  httpConn: Deno.HttpConn,
  eventtarget: EventTarget,
  port: number,
): Promise<void> {
  const requestEvent = await httpConn.nextRequest();
  if (requestEvent == null) {
    return;
  }

  const { request, respondWith } = requestEvent;
  const url = new URL(request.url);
  switch (url.pathname) {
    case "/livereload.js":
      try {
        await respondWith(
          new Response(livereloadScript(port), {
            headers: { connection: "close" },
          }),
        );
        const nr = await httpConn.nextRequest();
        if (nr !== null) {
          logger.error("Error: something's wrong with livereload server.");
        }
        httpConn.close();
      } catch (e) {
        httpConn.close();
        logger.error(e);
      }
      break;
    case "/livereload": {
      const { response, socket } = Deno.upgradeWebSocket(request);
      handleWs(socket, eventtarget);
      respondWith(response);
      break;
    }
    default:
      httpConn.close();
      break;
  }
}

interface LivereloadServer {
  close(): Promise<void>;
}

export function livereloadServer(
  port = 35729,
  eventtarget: EventTarget,
): LivereloadServer {
  logger.debug(`livereload websocket server is running on port=${port}`);
  const listener = Deno.listen({ port });
  const done = (async () => {
    for await (const conn of listener) {
      // TODO: migrate to Deno.serve
      // deno-lint-ignore no-deprecated-deno-api
      const httpConn = Deno.serveHttp(conn);
      serve(httpConn, eventtarget, port).catch(logger.error);
    }
  })();

  return {
    async close() {
      listener.close();
      await done;
    },
  };
}
