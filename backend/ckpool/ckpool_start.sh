#!/bin/bash

#clear old log files
rm /opt/apolloapi/backend/ckpool/logs/ckpool.log

screen -dmS ckpool /opt/apolloapi/backend/ckpool/ckpool -B -c /opt/apolloapi/backend/ckpool/ckpool.conf

