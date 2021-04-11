FROM amd64/node:14-alpine AS base

RUN apk update

RUN apk --no-cache add pkgconfig autoconf automake libtool nasm build-base zlib-dev python py-pip

RUN adduser -S app
RUN mkdir /app
RUN chown -R app /app

USER app

ARG NODE_ENV
ENV NODE_ENV $NODE_ENV

WORKDIR /app

RUN npm --version
RUN npm install yarn

COPY ./package.json /app/package.json
COPY ./yarn.lock /app/yarn.lock

RUN rm -rf /app/package-lock.json

RUN ./node_modules/.bin/yarn