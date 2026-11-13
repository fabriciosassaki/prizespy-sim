#!/bin/sh
# Gera o motor.min.js do simulador. Precisa do twinleaf compilado em $OUT (commit 837aebeb + correções do PrizeSpy).
set -e
OUT=/home/claude/motor/twinleafgg/ptcg-server/output
mkdir -p bots
for f in bot-hns bot-plano; do sed -E "s#require\(OUT \+ '([^']+)'\)#require('$OUT\1')#g" src/$f.js > bots/$f.js; done
npx --yes esbuild entrada.js --bundle --platform=node --format=iife --target=es2020 --minify \
  --define:process.env.NODE_ENV='"production"' --external:fs --outfile=motor.min.js --log-level=error
ls -la motor.min.js
