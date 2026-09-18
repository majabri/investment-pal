import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { isIncomingRequestAbort } from "./lib/error-capture";
// Replaces generated attachSupabaseAuth: waits for the session to hydrate.
import { attachSupabaseAuthResilient } from "./lib/supabaseAuthAttacher";

const errorMiddleware = createMiddleware().server(async ({ next, request }) => {
  try {
    return await next();
  } catch (error) {
    // A client disconnect is a transport event, not an application failure.
    // Treat it as 499 so h3 does not serialize it as a generic 500 blank screen.
    if (
      request.signal.aborted ||
      isIncomingRequestAbort(error)
    ) {
      return new Response(null, { status: 499 });
    }
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuthResilient],
  requestMiddleware: [errorMiddleware],
}));
