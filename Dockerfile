FROM gcr.io/distroless/nodejs24-debian13@sha256:85482a8359e1524bd1278f5b418bb397bbebbf2b5ceeea7ec13a9e640e2c1911

WORKDIR /app

COPY next-logger.config.cjs /app/
COPY .next/standalone /app/
COPY .next/static /app/.next/static
COPY public /app/public

EXPOSE 3000

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0

CMD ["server.js"]
