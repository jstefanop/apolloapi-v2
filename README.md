# apolloapi

## Install

```sh
$ yarn
```

## Run dev

```sh
$ yarn dev
```

It will:

1) Create .env file in app directory with following variables
  * DATABASE_URL=
  * APP_SECRET
2) Create sqlite database `futurebit.sqlite` in app directory and run pending migrations
3) Start GraphQL API on http://localhost:5000/graphql
