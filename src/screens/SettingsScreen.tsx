import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Mono, MonoLabel, T, Toggle } from '../components/primitives';
import { Screen } from '../components/Screen';
import { ACTIVE_PROVIDER_ID, getProvider } from '../data/providers';
import * as loc from '../services/location';
import * as notifications from '../services/notifications';
import * as nfc from '../services/nfc';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeContext';

interface Tag {
  name: string;
  id: string;
  battery: string;
}

const SEED_TAGS: Tag[] = [
  { name: 'Subaru dash tag', id: 'SA-4F21', battery: 'no battery · NFC' },
  { name: 'Work van tag', id: 'SA-9C07', battery: 'no battery · NFC' },
];

export function SettingsScreen() {
  const { c } = useTheme();
  const isDark = useStore((s) => s.theme === 'dark');
  const toggleTheme = useStore((s) => s.toggleTheme);
  const showEmpty = useStore((s) => s.showEmpty);
  const toggleEmpty = useStore((s) => s.toggleEmpty);

  const [tags, setTags] = useState<Tag[]>(SEED_TAGS);
  const [nfcOk, setNfcOk] = useState<boolean | null>(null);
  const [notifPerm, setNotifPerm] = useState<string>('…');
  const [locPerm, setLocPerm] = useState<string>('…');

  useEffect(() => {
    nfc.isSupported().then(setNfcOk);
    notifications.getPermissionState().then(setNotifPerm);
    loc.getPermissionState().then(setLocPerm);
  }, []);

  const addTag = async () => {
    if (tags.length >= 3) return;
    const supported = await nfc.isSupported();
    if (supported) {
      const t = await nfc.readTag();
      if (t) {
        setTags((prev) => [...prev, { name: 'New tag', id: t.id.slice(0, 8).toUpperCase(), battery: 'no battery · NFC' }]);
        return;
      }
    }
    setTags((prev) => [...prev, { name: 'New tag', id: 'SA-0000', battery: supported ? 'pairing…' : 'NFC unavailable' }]);
  };

  return (
    <Screen>
      <T style={{ fontSize: 26, fontWeight: '800', letterSpacing: -0.7 }}>Settings</T>

      {/* NFC */}
      <View style={{ padding: 18, borderRadius: 22, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, gap: 14 }}>
        <MonoLabel>NFC TAGS {nfcOk === false ? '· UNAVAILABLE ON THIS DEVICE' : ''}</MonoLabel>
        <T style={{ fontSize: 13, color: c.dim, lineHeight: 19 }}>
          Stick a tag on the dash. Tap your phone to it when you park and the spot saves without opening the app.
        </T>
        {tags.map((t) => (
          <View key={t.id + t.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12, paddingHorizontal: 14, borderRadius: 15, backgroundColor: c.card2 }}>
            <View style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 3, borderColor: c.ok }} />
            <View style={{ flex: 1, gap: 2 }}>
              <T style={{ fontSize: 13.5, fontWeight: '700' }}>{t.name}</T>
              <Mono style={{ fontSize: 11, color: c.dim }}>{t.id} · {t.battery}</Mono>
            </View>
            <T style={{ fontSize: 11.5, fontWeight: '600', color: c.ok }}>Paired</T>
          </View>
        ))}
        <Pressable
          onPress={addTag}
          style={{ padding: 14, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: c.accent, backgroundColor: c.accentT, alignItems: 'center' }}
        >
          <T style={{ fontSize: 13.5, fontWeight: '700', color: c.accent }}>＋  Add SweepAlert tag</T>
        </Pressable>
      </View>

      {/* Permissions */}
      <View style={{ padding: 18, borderRadius: 22, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, gap: 15 }}>
        <MonoLabel>PERMISSIONS</MonoLabel>
        <PermRow
          label="Notifications"
          state={notifPerm}
          onRequest={async () => setNotifPerm(await notifications.requestPermission())}
        />
        <View style={{ height: 1, backgroundColor: c.line }} />
        <PermRow
          label="Location"
          state={locPerm}
          onRequest={async () => setLocPerm(await loc.requestPermission())}
        />
      </View>

      {/* Defaults */}
      <View style={{ padding: 18, borderRadius: 22, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, gap: 15 }}>
        <MonoLabel>DEFAULTS</MonoLabel>
        <Row title="Dark mode" sub={isDark ? 'Dark' : 'Light'}>
          <Toggle on={isDark} onPress={toggleTheme} />
        </Row>
        <View style={{ height: 1, backgroundColor: c.line }} />
        <Row title="Season awareness" sub="Boston sweeps April 1 – Nov 30">
          <Mono style={{ fontSize: 12, color: c.ok }}>ON</Mono>
        </Row>
        <View style={{ height: 1, backgroundColor: c.line }} />
        <Row title="Start with no cars" sub="Preview the first-run state">
          <Pressable
            onPress={toggleEmpty}
            style={{ paddingVertical: 9, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: c.line, backgroundColor: c.card2 }}
          >
            <T style={{ fontSize: 12, fontWeight: '600' }}>{showEmpty ? 'Show cars' : 'Empty state'}</T>
          </Pressable>
        </Row>
        <View style={{ height: 1, backgroundColor: c.line }} />
        <Row title="Schedule provider" sub={getProvider(ACTIVE_PROVIDER_ID).name}>
          <Mono style={{ fontSize: 11, color: c.dim }}>{ACTIVE_PROVIDER_ID}</Mono>
        </Row>
      </View>
    </Screen>
  );
}

function Row({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
      <View style={{ gap: 2, flex: 1 }}>
        <T style={{ fontSize: 14, fontWeight: '600' }}>{title}</T>
        <T style={{ fontSize: 11.5, color: c.dim }}>{sub}</T>
      </View>
      {children}
    </View>
  );
}

function PermRow({ label, state, onRequest }: { label: string; state: string; onRequest: () => void }) {
  const { c } = useTheme();
  const granted = state === 'granted';
  const color = granted ? c.ok : state === 'denied' ? c.bad : c.dim;
  return (
    <Row title={label} sub={granted ? 'Allowed' : state === 'denied' ? 'Denied — enable in system settings' : 'Not requested yet'}>
      {granted ? (
        <Mono style={{ fontSize: 12, color }}>ON</Mono>
      ) : (
        <Pressable
          onPress={onRequest}
          style={{ paddingVertical: 9, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: c.accent, backgroundColor: c.accentT }}
        >
          <T style={{ fontSize: 12, fontWeight: '600', color: c.accent }}>Enable</T>
        </Pressable>
      )}
    </Row>
  );
}
