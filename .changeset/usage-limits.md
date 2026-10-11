---
'@stagegrid/core': minor
---

Add usage ceilings for runners. A runner reports each provider account's 5-hour and weekly usage; above the configured ceiling (default 80% and 70%, up to 100%) new runs stay queued and start by themselves when usage drops or the window resets, while running work is left alone. A run that hits the provider's limit waits in `waiting_for_capacity` and resumes the same session once after the reset; after repeated limit hits in one run a person decides.
