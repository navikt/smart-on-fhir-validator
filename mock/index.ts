import { logger } from "@navikt/pino-logger";

import {
  createMockFhirApp,
  setConfig,
  type FhirMockConfig,
} from "@navikt/fhir-mock-server/router";

const port = process.env.PORT ?? 5000;

const config: FhirMockConfig = {
  fhirPath: "",
  baseUrl: `http://localhost:${port}`,
};

setConfig(config);

const app = createMockFhirApp(config);

Bun.serve({
  port,
  fetch: app.fetch,
  idleTimeout: 10,
});

logger.info(
  `FHIR Mock server running at ${config.baseUrl}${config.fhirPath}\n\tVisit well-known: ${config.baseUrl}${config.fhirPath}/.well-known/smart-configuration`,
);
