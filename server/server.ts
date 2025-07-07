/* eslint-disable @typescript-eslint/no-explicit-any */
import { serveStatic } from "hono/bun";
import { Hono } from "hono";
import {
  SmartClient,
  type SmartClientConfiguration,
  type SmartStorage,
} from "@navikt/smart-on-fhir/client";
import { getCookie, setCookie } from "hono/cookie";
import { v4 as uuidv4 } from "uuid";

const app = new Hono();

export function createInMemStorage(): SmartStorage {
  const inMem = new Map();

  return {
    set: async (sessionId, values) => {
      inMem.set(sessionId, values);
    },
    get: async (sessionId) => inMem.get(sessionId),
  };
}

const SESSION_COOKIE_NAME = "test_app_session_id";

const serverUrl =
  Bun.env.NODE_ENV === "production"
    ? "https://nav-on-fhir.ekstern.dev.nav.no"
    : "http://localhost:3000";

const smartClientConfig: SmartClientConfiguration = {
  client_id: "NAV_SMART_on_FHIR_example",
  scope: "openid profile launch fhirUser patient/*.* user/*.* offline_access",
  redirect_url: `${serverUrl}/`,
  callback_url: `${serverUrl}/`,
};

const smartStorage = createInMemStorage();
const createSmartClient = (sessionId: string): SmartClient => {
  return new SmartClient(sessionId, smartStorage, smartClientConfig, {
    autoRefresh: false,
  });
};

/** Ensure we have a cookie */
app.use(async (c, next) => {
  const sessionId = getCookie(c, SESSION_COOKIE_NAME);
  if (sessionId != null) return await next();

  const newId = uuidv4();

  setCookie(c, SESSION_COOKIE_NAME, newId);

  await next();
});

app.get("/launch", async (c) => {
  const sessionId = getCookie(c, SESSION_COOKIE_NAME);
  if (sessionId == null) {
    return c.text("No session ID found", 400);
  }

  const issuer = c.req.query("iss");
  const launch = c.req.query("launch");

  if (issuer == null || launch == null) {
    return c.text("Missing required parameters: iss and launch", 400);
  }

  const launchResult = await createSmartClient(sessionId).launch({
    iss: issuer,
    launch,
  });

  if ("error" in launchResult) {
    return c.text(`Launch error: ${launchResult.error}`, 500);
  }

  return c.redirect(launchResult.redirect_url);
});

// Test app ends up on / after launch, so we need to handle callback before we serve static files
app.get("/", async (c, next) => {
  const sessionId = getCookie(c, SESSION_COOKIE_NAME);
  if (sessionId == null) {
    return c.text("No session ID found", 400);
  }

  const code = c.req.query("code");
  const state = c.req.query("state");

  // No code or state, not part of the launch, just serve the static files
  if (code == null || state == null) {
    await next();
    return;
  }

  const smartClient = createSmartClient(sessionId);
  const callback = smartClient.callback({
    code: code,
    state: state,
  });

  if ("error" in callback) {
    return c.text(`Callback error: ${callback.error}`, 500);
  }

  await next();
});

// Proxy for FHIR requests
app.use("/fhir/*", async (c) => {
  const sessionId = getCookie(c, SESSION_COOKIE_NAME);
  if (sessionId == null) {
    return c.text("No session ID found", 400);
  }

  const readyClient = await createSmartClient(sessionId).ready();
  if ("error" in readyClient) {
    return c.text(`Ready client error: ${readyClient.error}`, 500);
  }

  if (c.req.path === "/fhir/hack-meta") {
    return c.json({
      patientId: readyClient.patient.id,
      encounterId: readyClient.encounter.id,
      fhirUser: readyClient.user.fhirUser,
      fhirUserType: "Practitioner",
    });
  }

  const actualPath = c.req.path.replace("/fhir/", "");
  console.info(`Proxying FHIR request to: ${actualPath}`);
  return c.json(await readyClient.request(actualPath as any));
});

app.use("*", serveStatic({ root: "./server/dist" }));

export default app;
