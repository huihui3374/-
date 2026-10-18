# 0.16.2 Windows acceptance — passed

The reviewed public installer is `0.16.2-retail.1`, 116975307 bytes, SHA-256 `c4cd9ef5239127da316799a0be0aa41681046605f8bf55a43ccaeecb93059197`.

Both standard free Windows 2022 and Windows 2025 environments passed:

- [Installation, actual public MCP/tunnel, PowerShell, Edge and cross-PC membership boundaries](https://github.com/huihui3374/-/actions/runs/39101568751).
- [Real 0.14 bootstrap upgrade, in-app HTTPS download/verification, cancel confirmation, silent installation, automatic restart and preserved user data](https://github.com/huihui3374/-/actions/runs/39101568769).

[Machine-readable reports](acceptance.json) include the exact test commit and Windows host evidence. The application source hashes were verified against the installed public package. Both public tunnel checks succeeded. The local component suite passed 55 tests, and each Windows upgrade job passed 17 updater unit checks.

Membership checks use an isolated, temporary protocol simulator and synthetic accounts, not production customer accounts or payments. They verify the client rejects copied DPAPI data, a second bound computer and expired signed leases. Production merchant/backend changes are maintained and tested separately.

For the in-app update branch, the real public 0.16.2 application is bootstrapped over the actual 0.14 installer; only its package version is then lowered on the disposable VM. Its updater code, production URL, downloaded binary, hash checking, installer and relaunch remain real. This avoids publishing a deliberately outdated or broken candidate.

No paid runners, artifact/cache uploads, live purchases or customer-data changes were used. Existing 0.14 users install the new package once; subsequent supported releases can update inside the app. Consumer hardware/antivirus variations and deliberate local code modification are not covered by these cloud Windows tests.
