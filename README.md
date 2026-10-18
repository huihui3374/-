**Latest completed acceptance:** [0.16.2 passed on both independent Windows environments](results/0.16.2/README.md), including real in-app updates and automatic restart. Earlier 0.14 evidence remains in [the archive](results/README.md).

# 澄镜 — free independent Windows acceptance

This repository contains **only disposable public QA scripts**. It does not contain
the merchant backend, merchant credentials, customer data or production signing keys.
The current public EXE installer is downloaded from its existing public storefront URL using its advertised HTTP byte-range support, then reassembled and checked in full; the detected Inno/NSIS installer is actually run on the disposable VM. It is pinned to
version `0.16.2-retail.1`, SHA-256
`c4cd9ef5239127da316799a0be0aa41681046605f8bf55a43ccaeecb93059197`.

## Zero-cost configuration

The workflow refuses private repositories. It uses only standard public
`windows-2022` and `windows-2025` runners, which GitHub documents as free:
https://docs.github.com/en/billing/concepts/product-billing/github-actions

No paid larger runners, private Actions minutes, artifact uploads, caches, cloud
subscriptions, real payments or purchases are used. Reports go to job logs and
summaries. A small synthetic fixture state travels directly through job outputs;
there is no billable artifact storage. Each job has a 15-minute timeout.

## What the Windows jobs prove

* Current installer integrity, actual silent installation, installed source hashes, packaged Electron launch in a Chinese/spaces path,
  original production-service key self-check and real Windows DPAPI support.
* Renderer isolation, login UI, password field behaviour and member gate.
* Actual bundled MCP listener/tunnel, PowerShell identity, permission enforcement,
  approved file writes, rejected operations, command exit/output, Edge interaction
  and screenshot creation. Public tunnel reachability is reported separately.
* On a genuinely different VM: inability to decrypt the first Windows user's DPAPI
  ciphertext; client response to device-limit and authorized-transfer responses.
* Client enforcement of a signed expiry, including expiry after a job was queued
  but before approval.

Only a temporary extracted test copy's public licensing configuration points to
the simulator; the original executable runs its production self-check first, and
the original configuration is restored afterward. The simulator's generated keys
are never trusted by the published app or production service. All accounts use
`example.invalid`. This fixture is NOT a payment service or a replacement for
production licensing, and is NOT proof of production server policy by itself.

The earlier 0.14 backend policy was checked separately against its recovered source in private (40 backend and 3 cross-device tests). Current merchant backend changes are maintained separately. The current client component suite passed 55 local tests; Windows compatibility and actual update results are recorded separately above.

Cloud Windows VMs do not cover every consumer Windows version, antivirus warning,
home network, external AI frontend or deliberate editing of locally accessible JS.
The existing one-hour offline lease can outlive an online revocation until the
client reconnects or the lease expires. No absolute anti-sharing claim is made.
