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

## Production build

You can't build this on a low-resources MCU (<= 512MB ram), so there is a script to run the builder in a docker that simulates an OrangePI with Armbian and create a file with all the `node_modules` compiled.

```sh
$ ./scripts/build
```

It will generate the file `build//futurebit.tar.gz`

Next step required:

* scp `futurebit.tar.gz` to the MCU
* extract it in a tmp directory
* copy (overwrite) `node_modules` to `/opt/apolloapi` directory
* pull changes
* restart `apollo` service

## Production usage

In the system MCU there are several commands built-in:

Apollo API manager:

```sh
$ sudo systemctl start|stop|restart|status|... apollo
```

Miner manager:

```sh
$ sudo systemctl start|stop|restart|status|... bfgminer
```

Wifi manager:

```sh
$ nmcli help
```
