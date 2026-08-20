#!/bin/sh
# Live progress for the bge-m3 re-index.
#
# Rows are counted in the database, not read from the log: the log's counter
# restarts from whatever was left to do each time the job resumes, so after a
# resume its numbers are not comparable with the ones above them. The rate is
# sampled from the row delta over a few seconds rather than taken from the log,
# which only prints every 500 rows (~15 minutes apart).
cd /var/www/html/project-data-strategis/backend || exit 1
SAMPLE=${1:-8}

count() {
  node -e "
require('dotenv').config();const{Sequelize}=require('sequelize');
const s=new Sequelize(process.env.DB_NAME,process.env.DB_USER,process.env.DB_PASS,{host:process.env.DB_HOST,dialect:'mysql',logging:false});
(async()=>{const[a]=await s.query('SELECT COUNT(*) n FROM retrieval_chunks');
const[b]=await s.query('SELECT COUNT(*) n FROM retrieval_chunks_bge');
console.log(b[0].n+' '+a[0].n);await s.close();})().catch(()=>console.log('0 0'))" 2>/dev/null | grep -E '^[0-9]+ [0-9]+$'
}

A=$(count); sleep "$SAMPLE"; B=$(count)
D1=$(echo "$A" | cut -d' ' -f1); D2=$(echo "$B" | cut -d' ' -f1)
TOTAL=$(echo "$B" | cut -d' ' -f2)
[ -z "$D2" ] && { echo "could not read progress"; exit 1; }

pgrep -f "[n]ode scripts/reindex-embeddings" >/dev/null && STATE=RUNNING || STATE=STOPPED
RATE=$(awk "BEGIN{printf \"%.0f\", ($D2-$D1)*60/$SAMPLE}")
PCT=$(awk "BEGIN{printf \"%.1f\", $TOTAL?100*$D2/$TOTAL:0}")
if [ "$RATE" -gt 0 ]; then ETA=$(awk "BEGIN{printf \"%.1fh\", ($TOTAL-$D2)/$RATE/60}"); else ETA="—"; fi

printf 'bge-m3 re-index  %s/%s (%s%%)  %s rows/min  ETA %s  [%s]\n' "$D2" "$TOTAL" "$PCT" "$RATE" "$ETA" "$STATE"
printf 'live index untouched (%s rows) · nothing switches until an explicit cutover\n' "$TOTAL"
