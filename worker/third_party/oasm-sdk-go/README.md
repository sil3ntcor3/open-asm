# Local OASM SDK fork

This pinned fork contains only the worker enrollment, heartbeat, job, and tool-download client surface used by Open-ASM. The former remote-execution client was deliberately omitted so the removed RPC contract cannot remain reachable through a transitive SDK dependency.
