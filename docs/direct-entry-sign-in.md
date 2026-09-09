# Direct EngageAgent entry

Opening `/` or `/dashboard` without a GENIUS token is a normal signed-out
visit. These pages display the EngageAgent sign-in screen with a
"Continue in GENIUS" link, not an "Authentication Required / No SSO token
provided" error. Invalid or expired tokens still fail verification and show
a reauthentication message with the same link.

The link opens `https://learn.ai4genius.org/login` in a new tab. This also
works inside GENIUS's sandboxed task iframe, which does not permit top-level
navigation. It sends no token or referrer, accepts no redirect input, and
lets GENIUS route teachers and students to their respective home pages.

## Current handoff contract

GENIUS issues an SSO token when a user opens an assigned interactive task.
After signing in to GENIUS, a teacher selects the class and opens its
EngageAgent task; a student opens their assigned task. The existing signed
token then authenticates EngageAgent with the user, class and assignment.

This change does not add an automatic round trip from GENIUS login back to
EngageAgent, choose an assignment for the user, or grant access without a
verified token. Such a flow requires a GENIUS-side launcher that selects or
validates task context and issues a token. A plain login redirect back to
EngageAgent would arrive without a token again.

## Verification

- Signed-out home and dashboard offer the GENIUS link without a raw error.
- Invalid sessions offer recovery and never render an authenticated view.
- Teachers, students and guests retain their existing view routing.
- URL tokens are verified, removed from the URL and stored for navigation.
- Stored tokens are verified again; invalid tokens are cleared.
- Teacher, class, assignment and `geniusId` values are preserved.

The deployed site must be checked after release. Passing local tests or
merging a pull request alone does not demonstrate an Amplify deployment.
