# Using X-Lite (or any SIP softphone) with X Frontline / ViciDial

Short answer: **yes, X-Lite works with this system with no code changes.**
ViciDial does not ship its own phone. Every agent needs *some* SIP (or IAX2)
endpoint registered to the Asterisk server, and X-Lite is simply one such
endpoint. The web agent screen (`www/agc/vicidial.php`) only controls the call
flow through Asterisk; the audio always travels through the softphone.

## How the pieces fit together

```
 Agent browser  ──HTTP──▶  Apache/PHP (agent screen, admin)  ──MySQL──▶  asterisk DB
                                                 │
                                                 │ Asterisk Manager (AMI)
                                                 ▼
 X-Lite (SIP)  ──SIP/RTP──▶  Asterisk  ◀──────  dialer / carrier trunks
```

1. The agent logs into the web screen with a **user login** and a **phone login**.
2. ViciDial originates a call from Asterisk to the agent's phone (the X-Lite
   registration) and parks the agent in a MeetMe conference room for the
   duration of the session.
3. Every customer call is bridged into that conference. The agent never
   dials from X-Lite; the web screen drives everything.

## Requirements

| Item | Requirement |
|------|-------------|
| Softphone | X-Lite 4/5, Bria, Zoiper, MicroSIP, Linphone... anything standards-based SIP. X-Lite is end-of-life (CounterPath replaced it with Bria Solo), so expect to migrate eventually, but it still works. |
| Protocol | SIP over UDP (port 5060 by default) to the Asterisk server. |
| Codecs | `ulaw` (G.711u) is the safe default in North America. X-Lite also supports `alaw`, `gsm`, `iLBC`, `speex`. The phone entry's codec list must overlap with the softphone's enabled codecs. |
| RTP | UDP 10000-20000 (Asterisk `rtp.conf` default) must be reachable from the agent's PC. |
| Network | On a LAN nothing special is needed. For remote agents use a VPN, or configure `nat=yes` / `externip` on the Asterisk side and STUN or "use outbound proxy" in X-Lite. |
| Auto-answer | Recommended. ViciDial rings the softphone once at login; with auto-answer the agent is placed into their session without clicking. (X-Lite: *Softphone → Preferences → Calls → Auto answer*.) |
| Audio devices | Use a USB headset. Disable "ring on speaker" so hold music does not leak. |

## Step by step

### 1. Create the phone in the admin interface

**Administration → Admin → Phones → Add a new phone**

| Field | Value |
|-------|-------|
| Phone extension | e.g. `1001` (this is the SIP username) |
| Dialplan number | `1001` |
| Voicemail box | `1001` |
| Server IP | the Asterisk server this phone registers to |
| Login (phone login) | e.g. `1001` — what the agent types into the "Extension" box on the login screen |
| Password (phone pass) | the phone's password |
| Registration password | the SIP secret X-Lite will use |
| Protocol | `SIP` |
| Client type | `SIP` (not "webphone") |
| Phone type | `X-Lite` (free-text, informational) |
| Codecs list | `ulaw,alaw,gsm` or whatever your trunk uses |
| Active | `Y` |

Save, then wait for the ViciDial keep-alive scripts to regenerate the
`sip-vicidial.conf` include and reload Asterisk (about one minute), or run
`/usr/share/astguiclient/ADMIN_update_server_conf.pl` and `asterisk -rx "sip reload"`
manually.

> Set **Is Webphone** to `N`. The webphone option embeds a browser phone;
> with X-Lite you do not want that.

### 2. Configure X-Lite

*Softphone → Account Settings*

| Field | Value |
|-------|-------|
| Account name | anything, e.g. `X Frontline` |
| User ID | the phone extension (`1001`) |
| Domain | Asterisk server IP or hostname |
| Password | the **registration password** from the phone record |
| Display name | agent name |
| Register with domain and receive calls | checked |
| Send outbound via | Domain |

Under *Topology*: on a LAN choose "None (use local IP address)". For remote
agents use STUN or the server's public IP and make sure the RTP range is
open on the firewall.

Under *Preferences → Devices*: pick the headset for speaker, microphone and
ring device. Enable **Auto answer**.

X-Lite should now show the account as "Ready" (registered). You can also
confirm on the server with `asterisk -rx "sip show peers"`.

### 3. Log the agent in

Open `/agc/vicidial.php`, enter the ViciDial **user** login and password,
the **phone login** (`1001`) and the campaign. Asterisk rings X-Lite; it
auto-answers and the agent hears the "you are now entering a conference" tone.
The agent then clicks **Ready** and works entirely from the browser.

### 4. Optional: one-click agent login from the phone record

If the same person always uses the same seat, fill **Login user / Login
pass / Login campaign** on the phone record. The agent screen then needs only
the phone login to start.

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| X-Lite stays "Registering" | Wrong secret, wrong server IP, or the phone's SIP peer was not generated yet. Check `sip show peers` and `/etc/asterisk/sip-vicidial.conf`. |
| Login succeeds but the phone never rings | Phone login/pass on the login screen do not match the phone record, or the phone is registered to a different server IP than the one in the record. |
| One-way or no audio | RTP range blocked, NAT. Use a VPN or set `nat=yes`, `externip`, `localnet` in `sip.conf` and enable STUN in X-Lite. |
| Choppy audio | Codec mismatch forcing transcoding (set `ulaw` only on both sides), or Wi-Fi. |
| Agent hears nothing after answering | Auto-answer plus "ring on speaker only" settings in X-Lite; double-check the audio device selection. |

No part of the UI revamp in this repository changes the telephony path, so
anything that worked with a SIP phone before still works now.
