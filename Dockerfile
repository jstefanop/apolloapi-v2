FROM arm32v7/node:8
WORKDIR /app
RUN npm --version
RUN npm install yarn
COPY . /app
ENV NODE_ENV=production
RUN ./node_modules/.bin/yarn
