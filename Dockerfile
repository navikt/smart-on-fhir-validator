FROM gcr.io/distroless/nodejs24-debian13@sha256:bd115a43df5995afd383edf789ac805a231437b1b290228e0ebdcd0436de5676

WORKDIR /app

COPY next-logger.config.cjs /app/
COPY .next/standalone /app/
COPY .next/static /app/.next/static
COPY public /app/public

EXPOSE 3000

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0

CMD ["server.js"]
