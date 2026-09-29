# Security policy

## Supported versions

Stagegrid is pre-1.0: security fixes go into the latest release only. Upgrade with `npm update @stagegrid/core` (or pull the newest Docker image) to get them.

## Reporting a vulnerability

Please **don't open a public issue**. Report it privately on GitHub:
<https://github.com/stagegrid/stagegrid/security/advisories/new>

Include what an attacker can do, the steps or a proof of concept, and the version you tested. You'll get a reply within a week; once a fix is released, the advisory is published with credit to you unless you'd rather stay anonymous.

## What's in scope

Stagegrid is self-hosted. Reports about the Stagegrid code are in scope: authentication, sessions, invite and password-reset links, API tokens, the OAuth authorization server, project permissions, the MCP endpoint, and document rendering and downloads. Problems caused by how a particular server is deployed (for example a weak `APP_SECRET` or plain HTTP in production) are out of scope, but tell us if the docs make that mistake easy to make.
