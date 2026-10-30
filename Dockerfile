FROM gcr.io/distroless/nodejs24-debian13@sha256:bd9e0df8099c872d37e590e4fc8c815e02e6a3048bf012081f5cee160cf893d6

WORKDIR /app

COPY next-logger.config.cjs /app/
COPY .next/standalone /app/
COPY .next/static /app/.next/static
COPY public /app/public

EXPOSE 3000

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0

CMD ["server.js"]
