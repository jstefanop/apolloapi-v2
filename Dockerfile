FROM ubuntu:20.04

# replace shell with bash so we can source files
RUN rm /bin/sh && ln -s /bin/bash /bin/sh

RUN apt-get update
RUN apt-get -y upgrade

RUN DEBIAN_FRONTEND=noninteractive apt-get -y install htop iputils-ping zip unzip whois traceroute vim openssh-server curl git libssl-dev libxslt-dev libxml2-dev imagemagick libmagickwand-dev libreadline-dev zlib1g-dev libsqlite3-dev libpq-dev build-essential libxml2-dev build-essential libxslt1-dev zlib1g-dev python-dev

# nvm environment variables
RUN mkdir -p /usr/local/nvm
ENV NVM_DIR /usr/local/nvm
ENV NODE_VERSION 14.16.1

# install nvm
# https://github.com/creationix/nvm#install-script
RUN curl --silent -o- https://raw.githubusercontent.com/creationix/nvm/v0.35.3/install.sh | bash

# install node and npm
RUN source $NVM_DIR/nvm.sh \
    && nvm install $NODE_VERSION \
    && nvm alias default $NODE_VERSION \
    && nvm use default

# add node and npm to path so the commands are available
ENV NODE_PATH $NVM_DIR/v$NODE_VERSION/lib/node_modules
ENV PATH $NVM_DIR/versions/node/v$NODE_VERSION/bin:$PATH

RUN adduser --disabled-password app
RUN mkdir /app
RUN chown -R app /app

USER app

ARG NODE_ENV
ENV NODE_ENV $NODE_ENV

WORKDIR /app

RUN npm --version
RUN npm install -g yarn

COPY ./package.json /app/package.json
COPY ./yarn.lock /app/yarn.lock

RUN rm -rf /app/package-lock.json
#RUN ./node_modules/.bin/yarn
RUN yarn

# Copy app files
COPY . .
# Expose port
EXPOSE 5000
# Start the app
CMD [ "yarn", "dev" ]
