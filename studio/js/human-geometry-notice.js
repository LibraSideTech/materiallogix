// Plain-language boundary shown near the separate Review people action.
// Ordinary Photo and Video quality checks never analyze a person or skin.
// The dedicated flow opens the versioned direct-subject release before any
// mapping model is loaded or any source pixels are read for that purpose.

export const NOTICE_VERSION = '2026-09-11.1';

export const NOTICE_TEXT = [
  'Ordinary Photo and Video checks do not analyze a person or skin.',
  'Choose Review people for a separate local face, hand, or body reference. The person using the flow must confirm they are the pictured adult and sign the purpose-specific release before mapping starts; Studio does not independently verify identity.',
  'The source stays on this device. If the local mapping engine is unavailable, Studio stops and asks for manual review; it does not send the source to a cloud fallback.'
].join('\n');
