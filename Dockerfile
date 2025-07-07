FROM node:22-alpine AS build
WORKDIR /app
COPY ./package.json /app/package.json
RUN corepack enable
COPY ./ /app
RUN yarn install --immutable
RUN yarn run build

FROM oven/bun:latest AS runtime

WORKDIR /app

COPY --from=build /app/build/client /app/server/dist
COPY /server/server.ts /app/server.ts
COPY /server/package.json /app/package.json
COPY /server/bun.lock /app/bun.lock
COPY /server/bunfig.toml /app/bunfig.toml

ARG NPM_AUTH_TOKEN
RUN bun install --production

# Trick the @navikt/smart-on-fhir lib into logging to team logs
ENV NEXT_PUBLIC_RUNTIME_ENV=dev-gcp
ENV NODE_ENV=production

CMD ["bun", "run", "server.ts"]
