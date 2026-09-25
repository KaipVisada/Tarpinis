#!/bin/sh
# Builds team-board/index.html (the published page) from src/.
cd "$(dirname "$0")"
{ cat src/1-head.html; echo "<script>"; cat src/2-core.js src/3-auth.js src/4-task.js src/5-views.js src/6-admin.js src/7-main.js; echo "</script>"; } > index.html
