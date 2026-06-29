# Graph Report - cricket-motion-game  (2026-06-29)

## Corpus Check
- 16 files · ~14,341 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 172 nodes · 220 edges · 12 communities (11 shown, 1 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 11|Community 11]]

## God Nodes (most connected - your core abstractions)
1. `GameEngine` - 34 edges
2. `Scorecard` - 8 edges
3. `Cricket Motion Game` - 8 edges
4. `boot()` - 6 edges
5. `BowlerAI` - 5 edges
6. `TweenManager` - 5 edges
7. `scripts` - 5 edges
8. `scripts` - 4 edges
9. `scripts` - 4 edges
10. `detectSwing()` - 4 edges

## Surprising Connections (you probably didn't know these)
- `boot()` --calls--> `io`  [INFERRED]
  mobile/src/main.js → server/index.js
- `boot()` --calls--> `captureBaseline()`  [EXTRACTED]
  mobile/src/main.js → mobile/src/motion.js
- `boot()` --calls--> `startListening()`  [EXTRACTED]
  mobile/src/main.js → mobile/src/motion.js
- `boot()` --calls--> `mountUI()`  [EXTRACTED]
  mobile/src/main.js → mobile/src/ui.js
- `onDesktopConnect()` --calls--> `createRoom()`  [EXTRACTED]
  server/index.js → server/rooms.js

## Import Cycles
- None detected.

## Communities (12 total, 1 thin omitted)

### Community 1 - "Community 1"
Cohesion: 0.13
Nodes (6): BowlerAI, bowlerAI, scorecard, socket, LABELS, Scorecard

### Community 2 - "Community 2"
Cohesion: 0.10
Nodes (19): author, dependencies, cors, express, qrcode, socket.io, uuid, description (+11 more)

### Community 3 - "Community 3"
Cohesion: 0.18
Nodes (16): ALLOWED_ORIGINS, app, buildQrUrl(), httpServer, io, LAN_IP, onDesktopConnect(), onDisconnect() (+8 more)

### Community 4 - "Community 4"
Cohesion: 0.16
Nodes (15): boot(), getRoomId(), _baseline, calculatePower(), captureBaseline(), classifyShot(), detectSwing(), getRelative() (+7 more)

### Community 5 - "Community 5"
Cohesion: 0.14
Nodes (13): dependencies, socket.io-client, three, devDependencies, vite, name, private, scripts (+5 more)

### Community 6 - "Community 6"
Cohesion: 0.15
Nodes (12): dependencies, socket.io-client, devDependencies, vite, name, private, scripts, build (+4 more)

### Community 7 - "Community 7"
Cohesion: 0.17
Nodes (11): description, devDependencies, concurrently, name, private, scripts, dev, dev:desktop (+3 more)

### Community 8 - "Community 8"
Cohesion: 0.20
Nodes (9): Cricket Motion Game, Dev keyboard shortcuts (no phone needed), Playing, Prerequisites, Project structure, Run, Scoring, Setup (+1 more)

### Community 11 - "Community 11"
Cohesion: 0.22
Nodes (3): createBatsman(), DELIVERY, TweenManager

## Knowledge Gaps
- **67 isolated node(s):** `name`, `version`, `private`, `type`, `dev` (+62 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `GameEngine` connect `Community 0` to `Community 1`, `Community 11`?**
  _High betweenness centrality (0.092) - this node is a cross-community bridge._
- **Why does `boot()` connect `Community 4` to `Community 3`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **Why does `io` connect `Community 3` to `Community 4`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _67 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.11397849462365592 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.12631578947368421 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._