/**
 * Strips iOS entitlements that Apple's free "Personal Team" provisioning does
 * not support, so `npx expo run:ios` can sign a development build with a plain
 * Apple ID (no paid Developer Program membership).
 *
 * Personal Teams cannot issue profiles carrying:
 *  - com.apple.developer.nfc.readersession.formats  (Core NFC — added by the
 *    react-native-nfc-manager plugin)
 *  - aps-environment                                (Push Notifications — added
 *    by the expo-notifications plugin, which Expo AUTOLINKS, so it applies even
 *    if that plugin is not listed in app.json)
 *
 * Neither is needed by this app's shipping behaviour on a free account:
 *  - Reminders use LOCAL notifications only (no push tokens anywhere in src/),
 *    and local notifications require no entitlement.
 *  - NFC tag reading cannot work on a Personal Team regardless; src/services/nfc.ts
 *    already feature-detects and degrades to the GPS capture path.
 *
 * ORDERING: this must be listed FIRST in app.json's "plugins" array. Expo runs
 * mods in REVERSE registration order, so the first-listed plugin's mod runs
 * LAST -- which is what lets this delete keys the other plugins added. Moving it
 * to the end of the array silently stops it working (it runs before the others
 * and deletes nothing).
 *
 * TO RE-ENABLE on a paid Apple Developer Program membership: delete this plugin
 * from the "plugins" array in app.json (and delete this file). Nothing else
 * needs to change — the NFC and notification plugins stay configured as-is.
 */
const { withEntitlementsPlist } = require('expo/config-plugins');

const UNSUPPORTED_ON_PERSONAL_TEAM = [
  'com.apple.developer.nfc.readersession.formats',
  'aps-environment',
];

module.exports = function withFreeTeamSigning(config) {
  return withEntitlementsPlist(config, (config) => {
    for (const key of UNSUPPORTED_ON_PERSONAL_TEAM) {
      delete config.modResults[key];
    }
    return config;
  });
};
