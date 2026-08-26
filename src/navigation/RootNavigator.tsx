import { BottomTabBarProps, createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AlertsScreen } from '../screens/AlertsScreen';
import { CarDetailScreen } from '../screens/CarDetailScreen';
import { LookupScreen } from '../screens/LookupScreen';
import { ManageCarsScreen } from '../screens/ManageCarsScreen';
import { MyCarsScreen } from '../screens/MyCarsScreen';
import { ParkScreen } from '../screens/ParkScreen';
import { ReminderEditorScreen } from '../screens/ReminderEditorScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { useTheme } from '../theme/ThemeContext';
import { CarsStackParamList, RootTabParamList } from './types';

const Tab = createBottomTabNavigator<RootTabParamList>();
const CarsStack = createNativeStackNavigator<CarsStackParamList>();

function CarsNavigator() {
  return (
    <CarsStack.Navigator screenOptions={{ headerShown: false }}>
      <CarsStack.Screen name="MyCars" component={MyCarsScreen} />
      <CarsStack.Screen name="CarDetail" component={CarDetailScreen} />
      <CarsStack.Screen name="ReminderEditor" component={ReminderEditorScreen} />
      <CarsStack.Screen name="ManageCars" component={ManageCarsScreen} />
    </CarsStack.Navigator>
  );
}

/** Custom rounded pill tab bar, matching the SweepAlert design. */
function TabBar({ state, navigation }: BottomTabBarProps) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const labels: Record<string, string> = { Cars: 'Cars', Park: 'Park', Lookup: 'Lookup', Alerts: 'Alerts', Settings: 'Settings' };

  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 6,
        paddingHorizontal: 14,
        paddingTop: 10,
        paddingBottom: insets.bottom + 10,
        backgroundColor: c.card,
        borderTopWidth: 1,
        borderTopColor: c.line,
      }}
    >
      {state.routes.map((route, i) => {
        const focused = state.index === i;
        return (
          <Pressable
            key={route.key}
            onPress={() => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
            }}
            style={{
              flex: 1,
              paddingVertical: 11,
              borderRadius: 14,
              alignItems: 'center',
              backgroundColor: focused ? c.accentT : 'transparent',
            }}
          >
            <Text style={{ fontWeight: '700', fontSize: 12.5, color: focused ? c.accent : c.dim }}>
              {labels[route.name] ?? route.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function RootNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <TabBar {...props} />}
    >
      <Tab.Screen name="Cars" component={CarsNavigator} />
      <Tab.Screen name="Park" component={ParkScreen} />
      <Tab.Screen name="Lookup" component={LookupScreen} />
      <Tab.Screen name="Alerts" component={AlertsScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}
