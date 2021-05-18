#!/bin/sh

export DISPLAY=:1.0
Xvfb $DISPLAY -ac -nocursor -screen 0 1280x720x24 &
exec node app.min.js $@