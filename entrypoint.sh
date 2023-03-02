#!/bin/bash
set -e

if [ $1 = '--run-xvfb' ]; then
    shift
    export DISPLAY=:1.0
    Xvfb $DISPLAY -ac -nocursor -screen 0 1280x720x24 &
fi

if [ $1 = '--run-as-user' ]; then
    shift
    groupadd -g 1000 ubuntu
    useradd -g ubuntu -u 1000 ubuntu
    mkdir -p /home/ubuntu
    chown -R ubuntu.ubuntu /home/ubuntu
    echo "ubuntu ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers
    exec sudo -EH -u ubuntu node app.min.js $@
fi

exec node app.min.js $@
