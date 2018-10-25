FROM arm32v7/node:8
WORKDIR /app
RUN npm --version
RUN npm install yarn
COPY ./package.json /app/package.json
COPY ./yarn.lock /app/yarn.lock
ENV NODE_ENV=production
RUN ./node_modules/.bin/yarn --production
COPY . /app
RUN tar -zcvf futurebit.tar.gz .
