import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, TextInput, View } from 'react-native';
import { DateTime } from 'luxon';

import { Card, Mono, MonoLabel, Pill, T } from '../components/primitives';
import { Screen } from '../components/Screen';
import { searchSchedules } from '../data/providers/bostonApi';
import { getNextCleaning } from '../services/scheduling';
import { useTheme } from '../theme/ThemeContext';
import { CleaningSchedule } from '../types';

interface StreetGroup {
  street: string;
  segments: CleaningSchedule[];
}

/** Group per-segment schedules under their street name, preserving order. */
function groupByStreet(list: CleaningSchedule[]): StreetGroup[] {
  const groups: StreetGroup[] = [];
  const index = new Map<string, StreetGroup>();
  for (const s of list) {
    let g = index.get(s.address);
    if (!g) {
      g = { street: s.address, segments: [] };
      index.set(s.address, g);
      groups.push(g);
    }
    g.segments.push(s);
  }
  return groups;
}

function nextLabel(s: CleaningSchedule): string {
  const next = getNextCleaning(s, new Date());
  if (!next) return 'Off-season — no upcoming sweep';
  return DateTime.fromJSDate(next, { zone: s.timezone }).toFormat("ccc, LLL d 'at' h:mma");
}

export function LookupScreen() {
  const { c, mono } = useTheme();
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<CleaningSchedule[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done'>('idle');
  const reqId = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(async (q: string) => {
    const id = ++reqId.current;
    if (q.trim().length < 2) {
      setResults([]);
      setStatus('idle');
      return;
    }
    setStatus('loading');
    const found = await searchSchedules(q);
    if (id !== reqId.current) return; // a newer keystroke superseded this one
    setResults(found);
    setStatus('done');
  }, []);

  const onChange = (t: string) => {
    setTerm(t);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => runSearch(t), 250);
  };

  const groups = useMemo(() => groupByStreet(results), [results]);

  return (
    <Screen>
      <View style={{ gap: 4 }}>
        <T style={{ fontSize: 26, fontWeight: '800', letterSpacing: -0.7 }}>Street lookup</T>
        <T style={{ fontSize: 13, color: c.dim }}>
          Search any Boston street to see its cleaning schedule — both sides.
        </T>
      </View>

      <View style={{ position: 'relative' }}>
        <TextInput
          value={term}
          onChangeText={onChange}
          placeholder="e.g. Marlborough, Hanover, Boylston…"
          placeholderTextColor={c.dim}
          autoCorrect={false}
          autoCapitalize="words"
          returnKeyType="search"
          style={{
            backgroundColor: c.card,
            borderColor: c.line,
            borderWidth: 1,
            borderRadius: 16,
            paddingVertical: 14,
            paddingHorizontal: 16,
            fontSize: 16,
            color: c.ink,
          }}
        />
        {status === 'loading' && (
          <ActivityIndicator
            color={c.accent}
            style={{ position: 'absolute', right: 16, top: 15 }}
          />
        )}
      </View>

      {status === 'idle' && (
        <Card style={{ alignItems: 'center', gap: 8, paddingVertical: 34 }}>
          <Mono style={{ fontSize: 12, color: c.dim }}>1,523 streets · 3,758 blocks</Mono>
          <T style={{ fontSize: 14, color: c.dim, textAlign: 'center' }}>
            Type a street name to look up its street-sweeping days and times.
          </T>
        </Card>
      )}

      {status === 'done' && groups.length === 0 && (
        <Card style={{ alignItems: 'center', gap: 6, paddingVertical: 30 }}>
          <T style={{ fontSize: 15, fontWeight: '700' }}>No match for “{term.trim()}”</T>
          <T style={{ fontSize: 13, color: c.dim, textAlign: 'center' }}>
            Try a shorter or differently spelled street name. Private ways and alleys aren’t swept.
          </T>
        </Card>
      )}

      {groups.length > 0 && (
        <Mono style={{ fontSize: 12, color: c.dim }}>
          {results.length} block{results.length === 1 ? '' : 's'} · {groups.length} street
          {groups.length === 1 ? '' : 's'}
        </Mono>
      )}

      {groups.map((g) => (
        <Card key={g.street} style={{ gap: 14 }}>
          <T style={{ fontSize: 18, fontWeight: '800', letterSpacing: -0.3 }}>{g.street}</T>
          {g.segments.map((s, i) => {
            const yearRound = s.seasonLabel.toUpperCase().includes('YEAR-ROUND');
            return (
              <View
                key={`${s.blockId}-${i}`}
                style={{
                  gap: 8,
                  paddingTop: i === 0 ? 0 : 12,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: c.line,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Pill color={sideColor(s.side, c)} tint={sideTint(s.side, c)}>
                    {sideLabel(s.side)}
                  </Pill>
                  <Mono style={{ fontSize: 11.5, color: c.dim, flexShrink: 1 }}>
                    {segmentLabel(s)}
                  </Mono>
                </View>
                <T style={{ fontSize: 14.5, fontWeight: '700' }}>{s.scheduleLabel}</T>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <View
                    style={{
                      paddingVertical: 3,
                      paddingHorizontal: 9,
                      borderRadius: 999,
                      backgroundColor: yearRound ? c.okT : c.warnT,
                    }}
                  >
                    <Mono style={{ fontSize: 10.5, color: yearRound ? c.ok : c.warn }}>
                      {yearRound ? 'YEAR-ROUND' : 'APR 1 – NOV 30'}
                    </Mono>
                  </View>
                  <MonoLabel style={{ fontFamily: mono }}>NEXT · {nextLabel(s).toUpperCase()}</MonoLabel>
                </View>
              </View>
            );
          })}
        </Card>
      ))}
    </Screen>
  );
}

// ---- side presentation -----------------------------------------------------

function sideLabel(side: string): string {
  if (side === 'even') return 'EVEN';
  if (side === 'odd') return 'ODD';
  return 'BOTH';
}
function sideColor(side: string, c: ReturnType<typeof useTheme>['c']): string {
  if (side === 'even') return c.accent;
  if (side === 'odd') return c.warn;
  return c.dim;
}
function sideTint(side: string, c: ReturnType<typeof useTheme>['c']): string {
  if (side === 'even') return c.accentT;
  if (side === 'odd') return c.warnT;
  return c.card2;
}
function segmentLabel(s: CleaningSchedule): string {
  // blockLabel is "Neighborhood · side side, From → To"; show the segment part.
  const parts = s.blockLabel.split(' · ');
  return parts[parts.length - 1] || s.blockLabel;
}
