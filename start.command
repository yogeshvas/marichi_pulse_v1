#!/bin/bash
# Double-click this file (or run ./start.command) to start Marichi Pulse and open it in your browser.
cd "$(dirname "$0")"
[ -d node_modules ] || npm install
lsof -ti :3000 | xargs kill 2>/dev/null
( sleep 2; open http://localhost:3000/console/ ) &
npm start
