FROM node:22-alpine AS build
WORKDIR /app
COPY ./package.json /app/package.json
RUN corepack enable
COPY ./ /app
RUN yarn install --immutable
RUN yarn run build

FROM node:22-alpine AS runtime
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY --from=build /app/build/client /app/dist
RUN npm add -g serve

EXPOSE 8080
CMD ["serve", "-s", "-n", "dist", "-l", "8080"]
