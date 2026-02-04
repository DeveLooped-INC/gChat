# HUMBLE BEGINNINGS

## The initial prompt
```Could a chat app (win, Linux, osx, termux) be created that would at install automatically set up tor a suitable headless browser, create and launch a relay with an onion address and launch a local back-end and UI, where the user can set up their local account which when shared along with the corresponding relay address, all packaged in a QR code, another user on their own setup could load the QR code and the same app is then capable to connect to the included relay and then be able to send the inviting user account connection request as well. Once connected all data does through the onion relay and enables all app functions like direct chat, group chat, broadcasting posts, any media, up and down votes, comments etc all synced up via the onion network. Connecting other devices to the user's own relay creates their own mesh network where the localhost address is used, unless unavailable (eg: user is away and on mobile device) at which point the onion address is used. What do you think? What exact packages would be best to make sure it is a robust chat / social / media all in one, all using locally installed and running packages and send / receive ALL data via the onion network, enabling secure node connections from behind any complicated routing like CGNAT and it's friends... so yeah. I'd call it gChat, as in "global chat".```

## Response removed

## Clarifications
```"Complex Implementation - Significant engineering effort required"
The install process MUST install everything, and set up everything automatically, prompting the user for whatever it needs user decision. The key is Easy!

As to "Challenges to Address
Bootstrap problem - First connection needs QR/manual entry"

Its okay, EVERY install will set up one onion relay and the initial system that is installed on the same device just  eed to connect to the relay via the localhost address while also saving the relay's onion address to be able to generate QR codes for all local users. As this system receives QR codes from other systems, all will have an onnion address to the inviter person's system's active relay, and the person's unique 'node_ID:username'. All these are saved locally and used by the system to maintain connectiin to the wider network. User account privacy is completelly under the user's control (public, friends only, private) as well as the privacy setting of their broadcasts (posts, media, comments, etc). So via the tor network with the help of their local and learned remote relay's, these nodes connect but all data still remains under the encrypted protection of the user account it belongs to.

Availability - Users offline = messages delayed

Not neccessarily, a local shared store needs to be live on the user's devices that is actively synced with nodes locally and depending on privacy settings with external nodes, for the public, social media aspects.
Users will be encuraged to install gChat on their home computer or as many devices as possible, and connect th3m under his user account which shares both the localhost, and onnion addresses of the relay running on each device, and gChat intelligently connects them together always using the local ip's while on the same local network, and the onnion address when the particular device is used remotely.

Metadata - Timing correlation attacks (mitigate with dummy traffic)

Well... not sure... maybe the nodes can run a lightweight media hash+time blockchain too? Hash+sharetime could be a truth store 🤷‍♂️ maybe with enough milliseconds...

Storage - Each node stores full history (implement pruning)

Yes! Pruning is paramount, like all downloaded large media files should get deleted offten, at least once every few days, and re downloaded when needed. Feeds always must default to compressed version and only downloading larger version once user engages with it.

Tor performance - Latency for media-heavy content"

Its okay. Freedome for little slower social vibe is ok.
Please add all that you find useful and then creat a detailed project plan that encapsulates it all. Thanks!!```
