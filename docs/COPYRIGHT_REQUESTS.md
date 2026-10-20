# Copyright requests and removal review

The website's `/copyright` page prepares a private copyright/removal notice.
The hosted installation's owner-approved public address is
`afterparty.affirm544@passmail.net`. Independently hosted copies should set the
website runtime variable `COPYRIGHT_CONTACT_EMAIL` to their operator's public
address. An explicitly empty or invalid override disables the email link and
shows the support fallback. This is website configuration, not a Core secret.
No configuration or deployment has been changed by this source update.

The client form keeps fields in memory, prepares editable plain text, and offers
copying and an encoded `mailto:` draft. The reporter must send the message from
their email application. It does not POST a notice, create a database record,
persist form data in browser storage, send automatic email or claim delivery.
Mail clients may limit draft URL lengths; copying the prepared text into a
message is the fallback. Clearing the form cannot erase an external clipboard
or an email draft the reporter already created.

The notice asks for the claimed work, a sufficiently specific Afterparty
location, contact details, signature, good-faith belief and accuracy/authority
statements. See the [U.S. Copyright Office's Section 512 guidance](https://www.copyright.gov/512/).
The page does not claim that the operator has a registered DMCA agent or meets
safe-harbor requirements. A removal contact does not license a music catalog
or authorize bypassing a media provider's restrictions.

## Operator handling

1. Monitor the published private contact channel. Review received notices,
   identify the affected installation and material, and request missing details
   privately when needed. Do not publish notices or contact details in GitHub.
   Do not automatically fetch reporter-supplied URLs or execute attachments.
2. Review the claimed rights and act on material controlled by this installation
   where appropriate. A source-hosted original requires separate action by that
   source; disabling an Afterparty link cannot remove a third-party upload.
3. For an injected Guess the Song inventory, end affected sessions using the
   authorized game controls, call the trusted inventory's `dispose()`, remove
   the affected records from the trusted inventory source and prepare a new
   reviewed snapshot if needed. Disposal rejects subsequent selection/media
   reads and clears capacity. It cannot retract audio already delivered to a
   participant. These are server integration actions, not a public removal API.
4. Verify affected material is unavailable and retain only correspondence
   needed for the claim, response and relevant obligations. Handle disputes and
   counter-notices privately; do not promise automatic removal or reinstatement.

The form does not add an anonymous deletion endpoint or change ordinary queues,
server permissions, stored settings or production data. Live removal and any
production configuration changes remain operator actions.
